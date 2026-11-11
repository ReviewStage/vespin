import type { FeedbackImage } from "@repo/features/feedback";
import { FEEDBACK_IMAGE_TYPE, FEEDBACK_LIMITS, isFeedbackImageType } from "@repo/features/feedback";
import { ACT_KIND } from "@repo/host/acts";
import { askAct } from "./act.js";
import { isHeicFile, isPictureFile } from "./picture-files.js";
import { base64Of } from "./tasks/attached-files.js";

/**
 * What becomes of a picked file: it rides as it is, it is re-encoded first, or
 * it cannot come. Decided from the type and size alone, before a canvas is
 * reached for.
 */
const IMAGE_INTAKE = {
  KEEP: "keep",
  RECODE: "recode",
  REFUSE: "refuse",
} as const;

type ImageIntake = (typeof IMAGE_INTAKE)[keyof typeof IMAGE_INTAKE];

/**
 * How a re-encode is drawn: scaled to fit the longest edge and written as
 * lossy WebP. Two rounds, because the first is quality worth keeping and the
 * second is the difference between a screenshot arriving smaller and not
 * arriving at all. A screenshot is mostly flat color and text, which WebP
 * holds well at these settings.
 */
const RECODE_ROUNDS = [
  { maxEdge: 2000, quality: 0.82 },
  { maxEdge: 1400, quality: 0.6 },
] as const;

/**
 * Why a picture could not come, where the reason is worth more than the
 * caller's own "couldn't be read": a HEIC photo this window could not
 * decode, which macOS converts on the Mac and Safari decodes itself, so only
 * another browser, or a photo `sips` refused, says it.
 */
const IMAGE_UNREADABLE = {
  HEIC: (name: string) =>
    `${name} is a HEIC photo, which this browser can't read. Export it as JPEG and attach that.`,
} as const;

/**
 * A file read as an image: the image, or, where it cannot come, the words
 * saying why where this module knows better than the caller, who says its
 * own otherwise.
 */
export type ImageRead =
  | { readonly image: FeedbackImage }
  | { readonly unreadable: string | undefined };

function imageIntake(
  file: { type: string; name: string; size: number },
  maxBytes: number,
  square: number | undefined,
): ImageIntake {
  // A square is always drawn, since a file kept as it is keeps its own shape.
  if (square !== undefined) {
    return isPictureFile(file) ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
  }
  // A format the submission carries natively rides untouched while it fits;
  // past the cap it is re-encoded rather than refused, because the cap exists
  // for a request-body limit the user should never have to think about.
  if (isFeedbackImageType(file.type)) {
    return file.size <= maxBytes ? IMAGE_INTAKE.KEEP : IMAGE_INTAKE.RECODE;
  }
  // Anything else the platform can decode — HEIC off a phone, a GIF — still
  // comes, as a re-encode. Only a file that is not an image at all is refused.
  return isPictureFile(file) ? IMAGE_INTAKE.RECODE : IMAGE_INTAKE.REFUSE;
}

/** A picture written again in another format, named for it, so the name stops promising the old one. */
function renamedImage(name: string, extension: string): string {
  const stem = name.replace(/\.[^.]*$/, "");
  return `${stem || "screenshot"}.${extension}`;
}

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (typeof url === "string") resolve(url.slice(url.indexOf(",") + 1));
      else reject(new TypeError("FileReader read a data URL as no string"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The part of the picture a round draws, by its left, top, width, and height, and the canvas it draws on. */
interface RecodeRegion {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What a round draws: the whole picture scaled to fit its longest edge, or,
 * for a square, the picture's center square, its shorter side's length on
 * both, scaled to the square's edge, so a wide or tall picture loses its
 * ends rather than being squashed.
 */
function recodeRegion(
  bitmap: ImageBitmap,
  maxEdge: number,
  square: number | undefined,
): RecodeRegion {
  const { width, height } = bitmap;
  if (square === undefined) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      sourceX: 0,
      sourceY: 0,
      sourceWidth: width,
      sourceHeight: height,
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }
  const shorter = Math.min(width, height);
  return {
    sourceX: (width - shorter) / 2,
    sourceY: (height - shorter) / 2,
    sourceWidth: shorter,
    sourceHeight: shorter,
    width: square,
    height: square,
  };
}

async function recodedImage(
  file: File,
  maxBytes: number,
  square: number | undefined,
): Promise<FeedbackImage | undefined> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const round of RECODE_ROUNDS) {
      const region = recodeRegion(bitmap, round.maxEdge, square);
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(
        bitmap,
        region.sourceX,
        region.sourceY,
        region.sourceWidth,
        region.sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, FEEDBACK_IMAGE_TYPE.WEBP, round.quality),
      );
      if (!blob) return undefined;
      if (blob.size > maxBytes) continue;
      return {
        name: renamedImage(file.name, "webp"),
        mediaType: FEEDBACK_IMAGE_TYPE.WEBP,
        base64: await base64FromBlob(blob),
      };
    }
    return undefined;
  } finally {
    bitmap.close();
  }
}

/** Bytes spelled in base64, as the act port answers them. */
function bytesOfBase64(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/**
 * A HEIC photo written again as a JPEG by the Mac, which Chromium can then
 * decode; none where this window's shell cannot convert one — a browser
 * tab, whose browser may decode HEIC itself, as Safari does — or the Mac
 * could not convert this one.
 */
async function jpegOfHeic(file: File): Promise<File | undefined> {
  try {
    const photo = base64Of(new Uint8Array(await file.arrayBuffer()));
    const { base64 } = await askAct(ACT_KIND.MAC_PHOTO_TO_JPEG, { base64: photo });
    return new File([bytesOfBase64(base64)], renamedImage(file.name, "jpg"), {
      type: FEEDBACK_IMAGE_TYPE.JPEG,
    });
  } catch {
    // Note that a refusal is the shell saying it cannot, not a failure, so the photo goes on to this window's own decoder.
    return undefined;
  }
}

/** One file encoded as an image within its bound, or nothing where it cannot be. */
async function encodedImage(
  file: File,
  maxBytes: number,
  square: number | undefined,
): Promise<FeedbackImage | undefined> {
  const intake = imageIntake(file, maxBytes, square);
  if (intake === IMAGE_INTAKE.REFUSE) return undefined;
  try {
    if (intake === IMAGE_INTAKE.KEEP && isFeedbackImageType(file.type)) {
      return { name: file.name, mediaType: file.type, base64: await base64FromBlob(file) };
    }
    return await recodedImage(file, maxBytes, square);
  } catch {
    // A file the decoder refused — a corrupt image, a format Chromium cannot
    // read — is a refusal for the composer to word, not an error to surface.
    return undefined;
  }
}

/**
 * Turns one picked or pasted file into an image of at most the bytes given,
 * or says it cannot come: a feedback note's screenshot, a file on a coding
 * agent's message, a picture in a description, or, given `square`, a
 * workspace's photo, always re-encoded as WebP to its center square that
 * many pixels a side. A HEIC photo is first written as a JPEG by the Mac,
 * where the window stands on one, and then goes through the same re-encode
 * and bound; where it cannot be, the window's own decoder tries it, and a
 * photo neither could read is said as a HEIC to export. The conversion is
 * the one thing that leaves the window, to this Mac's own `sips`; nothing
 * leaves the machine until the message it belongs to is sent.
 */
export async function encodeImage(
  file: File,
  maxBytes: number = FEEDBACK_LIMITS.IMAGE_MAX_BYTES,
  square?: number,
): Promise<ImageRead> {
  const heic = isHeicFile(file);
  const jpeg = heic ? await jpegOfHeic(file) : undefined;
  const image = await encodedImage(jpeg ?? file, maxBytes, square);
  if (image !== undefined) return { image };
  // Note that a JPEG the Mac wrote is a picture like any other, so one that would not fit is said as the caller says any.
  return { unreadable: heic && jpeg === undefined ? IMAGE_UNREADABLE.HEIC(file.name) : undefined };
}
