import { Schema as EffectSchema, Result } from "effect";
import { Base64 } from "effect/encoding";
import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS } from "./agent-wire.js";
import { startsLikePdf } from "./media-signature.js";
import {
  PICTURE_MEDIA_TYPE,
  type Picture,
  pictureDataUrlSchema,
  pictureOfDataUrl,
} from "./picture-wire.js";
import { wireUuidSchema } from "./service-wire.js";
import { WEBM_TYPE } from "./video-signature.js";

/**
 * description-attachment-wire.ts -- a description's files on the wire: how many a description may hold, what an upload carries, and what it answers.
 *
 * A picture is pasted, dropped, or chosen into a description's text on the Mac and
 * sent as one picture (`picture-wire.ts`), as is a video an agent recorded,
 * added from the file viewer. A PDF is laid in the same way and sent as a
 * `data:` URL of its own type, its bytes opening as every PDF's do. The
 * service keeps its bytes beside the description and answers the id the text
 * then names it by (`description-attachment-link.ts`), where a PDF stands
 * as a picture's line does and is drawn as a file rather than a picture.
 */

export const DESCRIPTION_ATTACHMENT_BOUNDS = {
  /** The most pictures one description may hold, saved or not, so a description's pictures stay a few dozen megabytes at most. */
  MAX_PER_DESCRIPTION: 100,
  /** The most of those that may be videos, each up to four times a picture's bytes, so a description's videos stay a few dozen megabytes too. */
  MAX_VIDEOS_PER_DESCRIPTION: 10,
} as const;

/** The types a description's attachment is served as: a picture's or a video's its text names, or any a comment's file may be. */
const DESCRIPTION_ATTACHMENT_TYPE = {
  ...AGENT_ATTACHMENT_TYPE,
  WEBM: WEBM_TYPE,
} as const;

/** A description's attachment's media type as the wire carries it. */
export const descriptionAttachmentTypeSchema = EffectSchema.Literals(
  Object.values(DESCRIPTION_ATTACHMENT_TYPE),
);

/** The types a description's own file may be kept as: a picture's or a video's, or a PDF's. */
export const DESCRIPTION_FILE_TYPE = {
  ...PICTURE_MEDIA_TYPE,
  PDF: AGENT_ATTACHMENT_TYPE.PDF,
} as const;

export type DescriptionFileType =
  (typeof DESCRIPTION_FILE_TYPE)[keyof typeof DESCRIPTION_FILE_TYPE];

/** A description's own file's media type as the wire carries it. */
export const descriptionFileTypeSchema = EffectSchema.Literals(
  Object.values(DESCRIPTION_FILE_TYPE),
);

/** A description's own file, as its bytes under its media type: a picture, a video, or a PDF. */
export interface DescriptionFile {
  readonly contentType: DescriptionFileType;
  readonly bytes: Uint8Array;
}

/** Whether a description's file is a PDF, drawn as a file rather than a picture. */
export function isPdfFile(file: { readonly contentType: string }): boolean {
  return file.contentType === DESCRIPTION_FILE_TYPE.PDF;
}

/** A PDF's `data:` URL up to its bytes. */
const PDF_DATA_URL_HEAD = `data:${DESCRIPTION_FILE_TYPE.PDF};base64,`;

/** The PDF a `data:` URL holds, where it is labeled a PDF and its bytes open as one; nothing otherwise. */
function pdfOfDataUrl(text: string): DescriptionFile | undefined {
  if (!text.startsWith(PDF_DATA_URL_HEAD)) return undefined;
  const bytes = Base64.decode(text.slice(PDF_DATA_URL_HEAD.length));

  if (Result.isFailure(bytes) || !startsLikePdf(bytes.success)) return undefined;

  return { contentType: DESCRIPTION_FILE_TYPE.PDF, bytes: bytes.success };
}

/** The file a `data:` URL holds: a picture as `pictureOfDataUrl` reads one, or a PDF; nothing for any other text. */
export function descriptionFileOfDataUrl(text: string): DescriptionFile | Picture | undefined {
  return pictureOfDataUrl(text) ?? pdfOfDataUrl(text);
}

/** A file to keep on a description, as the `data:` URL it is sent as: a picture `pictureDataUrlSchema` takes, or a PDF within a PDF's bound. */
export const descriptionFileDataUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    if (EffectSchema.is(pictureDataUrlSchema)(text)) return true;
    const pdf = pdfOfDataUrl(text);

    return pdf !== undefined && pdf.bytes.length <= AGENT_BOUNDS.MAX_PDF_BYTES;
  }),
);

/** An upload (POST): the one picture, video, or PDF, as a `data:` URL; the key keeps the name it shipped with. */
export const descriptionAttachmentRequestSchema = EffectSchema.Struct({
  picture: descriptionFileDataUrlSchema,
});

/** Why an upload kept nothing, answered in band. */
export const DESCRIPTION_ATTACHMENT_REFUSAL = {
  /** The description already holds `DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION` pictures. */
  TOO_MANY: "too-many",
  /** The upload is a video, and the description already holds `DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION` videos. */
  TOO_MANY_VIDEOS: "too-many-videos",
} as const;

/** The status an upload is answered with: 201 where it kept the picture, 200 where it refused in band. */
export const DESCRIPTION_ATTACHMENT_STATUS = {
  KEPT: 201,
  REFUSED: 200,
} as const;

/** What an upload answers: the kept picture's id, which the text then names, or why nothing was kept. */
export const descriptionAttachmentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: wireUuidSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(DESCRIPTION_ATTACHMENT_REFUSAL)),
  }),
]);
