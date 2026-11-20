/**
 * use-attached-pictures.ts -- the pictures a message or a start carries, as an agent's composer and the sheets that start work hold them: picked from the system's photo picker or dropped from Photos or Files, compressed as they are read, named as the panel names them, held to the service's bounds, and taken off on a press; and words pasted long enough to come as a text file of their own.
 *
 * A picture is drawn with its long edge within 2048 pixels and read as a
 * JPEG at `PICTURE_QUALITY`, lower only where it would not stand within the
 * bound for one picture (`@repo/features/picture-fit`); but a PNG picked
 * within that bound, such as a screenshot, is kept as its own PNG so its
 * words and lines stay sharp, as the panel sends one. Each is named "Picture 1",
 * "Picture 2", and on past every picture the holder has, and checked against
 * the service's bounds for one message (`AGENT_BOUNDS`), or the holder's
 * own, such as a note's to the people who make the app, as it is attached
 * and again before it goes, so a refusal is said in the panel's words rather
 * than met on the wire. What the picker or a bound says goes to the
 * holder's `onNote`, which says it over the field.
 *
 * A paste long enough to bury the message (`@repo/features/long-paste`) is
 * held as a text file beside the pictures, "Pasted text 1.txt", numbered
 * one past the highest the holder has used, as the panel's box takes one;
 * the field it was pasted into takes it back out of its words. Words past a
 * text file's bound, or a paste the holder has no room for as a file under
 * its count and its bytes together, stay words, which the field's own bound
 * then cuts. Note that iOS draws no file's chip in the words, so the file
 * stands with the pictures over the field rather than where it was pasted.
 */

import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  type AgentAttachment,
  base64Bytes,
} from "@repo/features/agent-wire";
import { chipSize } from "@repo/features/attachment-model";
import { nextPictureName, pictureName } from "@repo/features/file-marker";
import { PASTED_TEXT_BYTES, pastedFile } from "@repo/features/long-paste";
import { encodeWithin, PICTURE_LONG_EDGE } from "@repo/features/picture-fit";
import type { AttachedPicture } from "@repo/ui-native";
import { Predicate } from "effect";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { type ImagePickerAsset, launchImageLibraryAsync } from "expo-image-picker";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

/** The JPEG quality a message's picture is first read at, once drawn within its long edge, as the panel's feedback form reads a screenshot. */
const PICTURE_QUALITY = 0.8;

/** What a picture the service would refuse says, in the panel's words for a file. */
const PICTURE_REFUSAL = {
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  FULL: (most: number) => `A message can carry up to ${most} files.`,
  TOO_MUCH: "These files are too large to send together.",
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
} as const;

/** What a holder says where the photo picker did not open, as a refusal's note stands beside the box. */
export const PICKER_FAILED = "Photos couldn't be opened. Try again.";

/** How many pictures a holder carries, how large each and all of them may be, how they are compressed as they are read, and what a holder that is full says. */
export interface PictureBounds {
  readonly most: number;
  readonly pictureBytes: number;
  readonly totalBytes: number;
  /** The JPEG quality a picture is first read at, before it steps down to stand within `pictureBytes`. */
  readonly quality: number;
  readonly full: string;
}

/** A message's or a start's bounds, the service's for one message. */
const MESSAGE_PICTURES: PictureBounds = {
  most: AGENT_BOUNDS.MAX_ATTACHMENTS,
  pictureBytes: AGENT_BOUNDS.MAX_IMAGE_BYTES,
  totalBytes: AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES,
  quality: PICTURE_QUALITY,
  full: PICTURE_REFUSAL.FULL(AGENT_BOUNDS.MAX_ATTACHMENTS),
};

/** A picture or a pasted text file attached: the id it is taken off by, the attachment it sends, and, for a picture, the `data:` address its thumbnail draws from, made once so a redraw hands the thumbnail the same string. */
export interface HeldPicture {
  readonly id: string;
  readonly file: AgentAttachment;
  /** None for a pasted text file, which has no thumbnail. */
  readonly address?: string | undefined;
}

/** A picture's bytes as read, in base64, and what they are. */
interface ReadPicture {
  readonly data: string;
  readonly mediaType: typeof AGENT_ATTACHMENT_TYPE.JPEG | typeof AGENT_ATTACHMENT_TYPE.PNG;
}

/** A JPEG read as base64, as `readPicture` answers one; none for one that could not be read. */
function jpegOf(base64: string | null | undefined): ReadPicture | undefined {
  return base64 === null || base64 === undefined
    ? undefined
    : { data: base64, mediaType: AGENT_ATTACHMENT_TYPE.JPEG };
}

/** Whether a file held is a pasted text file rather than a picture. */
function isText(file: AgentAttachment): boolean {
  return file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT;
}

/**
 * The files a holder that keeps its pictures itself attached, such as an
 * Inbox thread's draft, as the composer's head draws them: each by its name,
 * a picture with the `data:` address its thumbnail draws from, and a pasted
 * text file with none, which draws as its tile.
 */
export function attachedFiles(files: readonly AgentAttachment[]): readonly AttachedPicture[] {
  return files.map((file) =>
    isText(file)
      ? { id: file.name, name: file.name, detail: fileDetail(file) }
      : { id: file.name, name: file.name, address: `data:${file.mediaType};base64,${file.data}` },
  );
}

/** What a pasted text file's chip says under its name, as the panel's chip says it: how many lines it runs to. */
function fileDetail(file: AgentAttachment): string {
  return chipSize({ name: file.name, mediaType: file.mediaType, url: "" }, file.data);
}

/** The next picture's name, numbered past every picture held, a pasted text file not counted. */
function nextName(pictures: readonly HeldPicture[], offset: number): string {
  return pictureName(pictures.filter(({ file }) => !isText(file)).length + offset + 1);
}

/** Deletes a JPEG the manipulator saved, once its bytes are read; one that stays only costs the cache. */
export function deleteSaved(uri: string) {
  try {
    const file = new File(uri);

    if (file.exists) file.delete();
  } catch (error: unknown) {
    console.error("A resized picture's file was not deleted.", error);
  }
}

/**
 * A picture at `uri` as JPEG base64: decoded with its long edge within
 * `PICTURE_LONG_EDGE`, then encoded at the bounds' quality, stepping down
 * only until it stands within the bound for one picture. Note that the
 * picture is drawn smaller as it is decoded, never after, since the
 * picker's own quality compresses but never resizes, and several
 * full-size camera photos read at once would stand in memory together.
 */
async function readPicture(uri: string, bounds: PictureBounds): Promise<string> {
  const context = ImageManipulator.manipulate(uri, {
    maxWidth: PICTURE_LONG_EDGE,
    maxHeight: PICTURE_LONG_EDGE,
  });

  try {
    const image = await context.renderAsync();

    return await encodeWithin(
      async (quality) => {
        const saved = await image.saveAsync({
          compress: quality,
          format: SaveFormat.JPEG,
          base64: true,
        });

        deleteSaved(saved.uri);

        if (saved.base64 === undefined) throw new Error("The picture was saved without its bytes.");

        return saved.base64;
      },
      bounds.pictureBytes,
      bounds.quality,
    );
  } finally {
    context.release();
  }
}

/**
 * A picture the picker answered, as it goes: a PNG within `bounds`' bytes
 * for one picture, read from the file the picker wrote, which keeps it a PNG
 * so a screenshot's words stay sharp; and every other picture, or a PNG
 * whose file could not be read, drawn within its long edge and read as a
 * JPEG (`readPicture`).
 */
async function pickedPicture(
  asset: ImagePickerAsset,
  bounds: PictureBounds,
): Promise<ReadPicture | undefined> {
  const keepsPng =
    asset.mimeType === AGENT_ATTACHMENT_TYPE.PNG &&
    asset.fileSize !== undefined &&
    asset.fileSize <= bounds.pictureBytes;

  const png = keepsPng ? await new File(asset.uri).base64().catch(() => undefined) : undefined;

  if (png !== undefined) return { data: png, mediaType: AGENT_ATTACHMENT_TYPE.PNG };

  return readPicture(asset.uri, bounds)
    .then(jpegOf)
    .catch(() => undefined);
}

/** Why the pictures held cannot all go together, in the panel's words; none where they can. */
function pictureRefusal(
  pictures: readonly HeldPicture[],
  bounds: PictureBounds,
): string | undefined {
  if (pictures.length > bounds.most) return bounds.full;

  const tooLarge = pictures.find(
    ({ file }) => base64Bytes(file.data) > (isText(file) ? PASTED_TEXT_BYTES : bounds.pictureBytes),
  );

  if (tooLarge !== undefined) return PICTURE_REFUSAL.TOO_LARGE(tooLarge.file.name);
  const total = pictures.reduce((sum, { file }) => sum + base64Bytes(file.data), 0);

  return total > bounds.totalBytes ? PICTURE_REFUSAL.TOO_MUCH : undefined;
}

/** The pictures a composer or a sheet holds, and what changes them. */
export interface AttachedPictures {
  /** The pictures as the composer's head draws them, by the names they go under. */
  readonly attached: readonly AttachedPicture[];
  /** The attachments a send carries, in the order attached; none while nothing is attached. */
  readonly files: readonly AgentAttachment[] | undefined;
  /** Why the pictures cannot all go together, in the panel's words; none where they can. */
  readonly refusal: string | undefined;
  /** Opens the system's photo picker, adding what is picked. */
  readonly attach: () => void;
  /** Adds pictures dropped on the holder, by the addresses of the JPEGs the drop kept (`dropPictures`), each file deleted once read, and says how many it could not keep. */
  readonly drop: (uris: readonly string[], unreadable: number) => void;
  /** Whether the pictures the holder opened with are still being read, while nothing it sends would carry them. */
  readonly opening: boolean;
  /** Whether pictures picked or dropped on the holder are still being read, while a send would go without them. */
  readonly reading: boolean;
  readonly detach: (id: string) => void;
  /** Takes every picture off, as a send does, answering what was held so a refusal can put it back. */
  readonly take: () => readonly HeldPicture[];
  /** Puts pictures a refused send carried back ahead of any attached since. */
  readonly putBack: (pictures: readonly HeldPicture[]) => void;
  /** Takes pasted words as a text file where they run long and the holder has room for them as one, answering whether it did, so the field takes them out of its words. */
  readonly pasteText: (words: string) => boolean;
}

/** Pictures read from the system's picker, as base64, or none for one the library could not read, not yet named or bounded. */
export type PickedPictures = readonly (string | null | undefined)[];

/** The pictures a holder that keeps its own takes of those picked, and what the library or a bound said of the rest. */
export interface PicturesTaken {
  readonly files: readonly AgentAttachment[];
  readonly note: string | undefined;
}

/**
 * Opens the system's photo picker for a holder that keeps its pictures
 * itself, such as a thread's draft, whose sends and refusals hold them,
 * offering as many as `held` leaves room for: the pictures picked, which
 * `takePictures` names and bounds against what the holder holds once the
 * picker answers, since a refusal may have put pictures back meanwhile.
 */
export async function pickPictures(
  held: number,
  bounds: PictureBounds = MESSAGE_PICTURES,
): Promise<PickedPictures> {
  const picked = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, bounds.most - held),
  });

  if (picked.canceled) return [];

  // Note that each is drawn within its long edge and compressed as the holder's own picks are, since the picker's quality never resizes a camera's photo.
  return Promise.all(
    picked.assets.map((asset) => readPicture(asset.uri, bounds).catch(() => undefined)),
  );
}

/**
 * The pictures picked a holder holding `held` takes: each named past every
 * picture's name it holds, so none takes the name of one still held, and
 * taken while the holder stays within its bounds, one the library could not
 * read, or one past a bound, left out, with what the first left out says.
 */
export function takePictures(
  held: readonly AgentAttachment[],
  picked: PickedPictures,
  bounds: PictureBounds = MESSAGE_PICTURES,
): PicturesTaken {
  const names = held.map((file) => file.name);
  const files: AgentAttachment[] = [];
  let note: string | undefined;

  for (const base64 of picked) {
    const name = nextPictureName(names);
    names.push(name);

    if (base64 === null || base64 === undefined) {
      note ??= PICTURE_REFUSAL.UNREADABLE(name);
      continue;
    }

    const file = { name, mediaType: AGENT_ATTACHMENT_TYPE.JPEG, data: base64 };

    const refused = pictureRefusal(
      [...held, ...files, file].map((each) => ({ id: each.name, file: each })),
      bounds,
    );

    if (refused === undefined) files.push(file);
    else note ??= refused;
  }

  return { files, note };
}

/** Where a holder's pictures are kept beyond its screen, such as a comment's draft: the pictures it opens on, and where each change goes. */
export interface KeptPictures {
  readonly held: readonly HeldPicture[];
  readonly keep: (pictures: readonly HeldPicture[]) => void;
}

/**
 * The pictures a composer or a sheet attaches, saying what the picker or a
 * bound refused through `onNote`, and nothing once a picture is taken off.
 * `opensWith` names JPEGs the holder opens holding, such as a share sheet
 * draft's, read and deleted as a drop's are, once, as it mounts.
 */
export function useAttachedPictures(
  onNote: (note: string | undefined) => void,
  opensWith?: readonly string[],
  bounds: PictureBounds = MESSAGE_PICTURES,
  kept?: KeptPictures,
): AttachedPictures {
  const [pictures, setPictures] = useState<readonly HeldPicture[]>(() => kept?.held ?? []);
  // The pictures held now, which a picker answering later adds to, so pictures a refused send put back while it stood open are kept.
  const held = useRef(pictures);
  useEffect(() => {
    held.current = pictures;
  }, [pictures]);

  // Note that the pictures are handed to their keeper as they change, so a screen drawn anew opens on them.
  const keep = useEffectEvent((now: readonly HeldPicture[]) => kept?.keep(now));
  useEffect(() => keep(pictures), [pictures]);

  // Pictures as read, or none for one that could not be, named past every picture held now and added after them, saying the first that could not be read, or else what a bound refuses. Note that the held pictures are written at once, so a second drop landing before the next render adds after this one rather than over it.
  const add = (contents: readonly (ReadPicture | undefined)[], unreadable = 0) => {
    const now = held.current;

    const read = contents.map((picture, index): HeldPicture | string => {
      const name = nextName(now, index);

      if (picture === undefined) return PICTURE_REFUSAL.UNREADABLE(name);

      return {
        id: randomUUID(),
        file: { name, mediaType: picture.mediaType, data: picture.data },
        address: `data:${picture.mediaType};base64,${picture.data}`,
      };
    });

    const unread =
      read.find((each): each is string => Predicate.isString(each)) ??
      (unreadable > 0 ? PICTURE_REFUSAL.UNREADABLE(nextName(now, read.length)) : undefined);

    const next = [...now, ...read.filter((each): each is HeldPicture => !Predicate.isString(each))];
    held.current = next;
    setPictures(next);
    onNote(unread ?? pictureRefusal(next, bounds));
  };

  // How many drops, and picks kept as their own PNG, are still being read.
  const [reads, setReads] = useState(0);

  // Note that the system's photo picker reads only what the member picks, so no permission is asked for first; and a holder already full says so rather than opening it, since a picture past the bound would only be refused.
  const attach = () => {
    const room = bounds.most - held.current.length;

    if (room <= 0) {
      onNote(bounds.full);

      return;
    }

    launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: room,
    })
      .then(async (picked) => {
        if (picked.canceled) return;
        // Note that each picture is read after the picker closes, drawn within its long edge or kept as its PNG, so the holder stands reading until they land, and a send meanwhile waits rather than going without them.
        setReads((count) => count + 1);

        try {
          add(await Promise.all(picked.assets.map((asset) => pickedPicture(asset, bounds))));
        } finally {
          setReads((count) => count - 1);
        }
      })
      .catch((cause: unknown) => {
        console.error("The photo picker did not open.", cause);
        onNote(PICKER_FAILED);
      });
  };

  // Every pasted file's name the holder has handed out, so a file taken off or sent frees no number a later paste reuses.
  const pastedNames = useRef(new Set<string>());

  // Note that the paste is held at once, as `add` holds what it reads, so the field's words and the file change together.
  const pasteText = (words: string): boolean => {
    const now = held.current;
    const file = pastedFile(words, [...now.map((each) => each.file.name), ...pastedNames.current]);

    if (file === undefined) return false;
    const next = [...now, { id: randomUUID(), file }];

    if (pictureRefusal(next, bounds) !== undefined) return false;
    pastedNames.current.add(file.name);
    held.current = next;
    setPictures(next);
    onNote(undefined);

    return true;
  };

  // Each dropped JPEG is read, fit within the bound, and deleted, since the drop kept it under the app's temporary folder for this alone; a picture the drop could not keep at all is said as unreadable.
  const dropped = (uris: readonly string[], unreadable: number) =>
    Promise.all(
      uris.map((uri) => {
        const file = new File(uri);

        return readPicture(uri, bounds)
          .then(jpegOf)
          .catch(() => undefined)
          .finally(() => {
            try {
              if (file.exists) file.delete();
            } catch (error: unknown) {
              console.error("A dropped picture's file was not deleted.", error);
            }
          });
      }),
    )
      .then((contents) => add(contents, unreadable))
      .catch((cause: unknown) => console.error("The dropped pictures were not read.", cause));

  const drop = (uris: readonly string[], unreadable: number) => {
    setReads((count) => count + 1);
    void dropped(uris, unreadable).finally(() => setReads((count) => count - 1));
  };

  // Note that the pictures opened with are being read from the first render, so nothing is sent without them.
  const [opening, setOpening] = useState(opensWith !== undefined && opensWith.length > 0);

  const open = useEffectEvent(() => {
    if (opensWith === undefined || opensWith.length === 0) return;
    void dropped(opensWith, 0).finally(() => setOpening(false));
  });

  useEffect(() => open(), []);

  // Note that what the head draws is read once per change of the files, since a pasted file's lines are counted from its bytes and the composer draws again on every key.
  const attached = useMemo(
    () =>
      pictures.map(({ id, file, address }) =>
        isText(file)
          ? { id, name: file.name, detail: fileDetail(file) }
          : { id, name: file.name, address },
      ),
    [pictures],
  );

  return {
    attached,
    files: pictures.length === 0 ? undefined : pictures.map(({ file }) => file),
    refusal: pictureRefusal(pictures, bounds),
    attach,
    drop,
    opening,
    reading: reads > 0,
    // Note that the held pictures are written at once, as `add` writes them, so a drop landing before the next render adds after what stays rather than bringing back what was taken off.
    detach: (id) => {
      const next = held.current.filter((picture) => picture.id !== id);
      held.current = next;
      setPictures(next);
      onNote(undefined);
    },
    // Note that `take` and `putBack` write the held pictures at once, so a second send before the next render takes none and can't hand them back twice, and a paste landing before the next render builds on what they left.
    take: () => {
      const taken = held.current;
      held.current = [];
      setPictures([]);

      return taken;
    },
    // Note that the pictures are numbered again in order, since a picture attached while the send was out was named from none held, and two of one name would both go; a pasted text file keeps its own name.
    putBack: (carried) => {
      let number = 0;

      const next = [...carried, ...held.current].map((picture) => {
        if (isText(picture.file)) return picture;
        number += 1;

        return { ...picture, file: { ...picture.file, name: pictureName(number) } };
      });

      held.current = next;
      setPictures(next);
    },
    pasteText,
  };
}
