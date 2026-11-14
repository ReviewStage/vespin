/**
 * use-attached-pictures.ts -- the pictures a message or a start carries, as an agent's composer and the sheets that start work hold them: picked from the system's photo picker or dropped from Photos or Files, compressed as they are read, named as the panel names them, held to the service's bounds, and taken off on a press.
 *
 * A picture is read as a JPEG at `PICTURE_QUALITY`, but a PNG within the
 * bound for one picture, such as a screenshot, is kept as its own PNG so
 * its words and lines stay sharp, as the panel sends one. Each is named "Picture 1",
 * "Picture 2", and on past every picture the holder has, and checked against
 * the service's bounds for one message (`AGENT_BOUNDS`), or the holder's
 * own, such as a note's to the people who make the app, as it is attached
 * and again before it goes, so a refusal is said in the panel's words rather
 * than met on the wire. What the picker or a bound says goes to the
 * holder's `onNote`, which says it over the field.
 */

import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  type AgentAttachment,
  base64Bytes,
} from "@repo/features/agent-wire";
import { pictureName } from "@repo/features/file-marker";
import type { AttachedPicture } from "@repo/ui-native";
import { Predicate } from "effect";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { type ImagePickerAsset, launchImageLibraryAsync } from "expo-image-picker";
import { useEffect, useEffectEvent, useRef, useState } from "react";

/** How a picture is compressed as it is read from the library: JPEG at this quality keeps a phone's photo under the service's bound for an image. */
const PICTURE_QUALITY = 0.7;

/** What a picture the service would refuse says, in the panel's words for a file. */
const PICTURE_REFUSAL = {
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  FULL: (most: number) => `A message can carry up to ${most} files.`,
  TOO_MUCH: "These files are too large to send together.",
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
} as const;

/** How many pictures a holder carries, how large each and all of them may be, how they are compressed as they are read, and what a holder that is full says. */
export interface PictureBounds {
  readonly most: number;
  readonly pictureBytes: number;
  readonly totalBytes: number;
  /** The JPEG quality a picture is read at. */
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

/** A picture attached: the id it is taken off by, the attachment it sends, and the `data:` address its thumbnail draws from, made once so a redraw hands the thumbnail the same string. */
export interface HeldPicture {
  readonly id: string;
  readonly file: AgentAttachment;
  readonly address: string;
}

/** A picture's bytes as read, in base64, and what they are. */
interface ReadPicture {
  readonly data: string;
  readonly mediaType: typeof AGENT_ATTACHMENT_TYPE.JPEG | typeof AGENT_ATTACHMENT_TYPE.PNG;
}

/** A JPEG read as base64, as the picker and a drop answer one; none for one that could not be read. */
function jpegOf(base64: string | null | undefined): ReadPicture | undefined {
  return base64 === null || base64 === undefined
    ? undefined
    : { data: base64, mediaType: AGENT_ATTACHMENT_TYPE.JPEG };
}

/**
 * A picture the picker answered, as it goes: a PNG within `pictureBytes`
 * read from the file the picker wrote, which keeps it a PNG, and every other
 * picture, or a PNG whose file could not be read, as the JPEG the picker
 * compressed it to. Note that the picker answers base64 as a JPEG whatever
 * the picture was, so its file is the one way to the PNG.
 */
async function pickedPicture(
  asset: ImagePickerAsset,
  pictureBytes: number,
): Promise<ReadPicture | undefined> {
  const keepsPng =
    asset.mimeType === AGENT_ATTACHMENT_TYPE.PNG &&
    asset.fileSize !== undefined &&
    asset.fileSize <= pictureBytes;

  if (!keepsPng) return jpegOf(asset.base64);
  const png = await new File(asset.uri).base64().catch(() => undefined);

  return png === undefined
    ? jpegOf(asset.base64)
    : { data: png, mediaType: AGENT_ATTACHMENT_TYPE.PNG };
}

/** The next picture's name, numbered past every picture held. */
function nextName(pictures: readonly HeldPicture[], offset: number): string {
  return pictureName(pictures.length + offset + 1);
}

/** Why the pictures held cannot all go together, in the panel's words; none where they can. */
function pictureRefusal(
  pictures: readonly HeldPicture[],
  bounds: PictureBounds,
): string | undefined {
  if (pictures.length > bounds.most) return bounds.full;
  const tooLarge = pictures.find(({ file }) => base64Bytes(file.data) > bounds.pictureBytes);

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
  /** Whether pictures dropped on the holder are still being read, while a send would go without them. */
  readonly reading: boolean;
  readonly detach: (id: string) => void;
  /** Takes every picture off, as a send does, answering what was held so a refusal can put it back. */
  readonly take: () => readonly HeldPicture[];
  /** Puts pictures a refused send carried back ahead of any attached since. */
  readonly putBack: (pictures: readonly HeldPicture[]) => void;
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
): AttachedPictures {
  const [pictures, setPictures] = useState<readonly HeldPicture[]>([]);
  // The pictures held now, which a picker answering later adds to, so pictures a refused send put back while it stood open are kept.
  const held = useRef(pictures);
  useEffect(() => {
    held.current = pictures;
  }, [pictures]);

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
      quality: bounds.quality,
      base64: true,
    })
      .then(async (picked) => {
        if (picked.canceled) return;
        add(
          await Promise.all(
            picked.assets.map((asset) => pickedPicture(asset, bounds.pictureBytes)),
          ),
        );
      })
      .catch((cause: unknown) => console.error("The photo picker did not open.", cause));
  };

  // How many drops are still being read.
  const [reads, setReads] = useState(0);

  // Each dropped JPEG is read whole and deleted, since the drop kept it under the app's temporary folder for this alone; a picture the drop could not keep at all is said as unreadable.
  const dropped = (uris: readonly string[], unreadable: number) =>
    Promise.all(
      uris.map((uri) => {
        const file = new File(uri);

        return file
          .base64()
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

  return {
    attached: pictures.map(({ id, file, address }) => ({ id, name: file.name, address })),
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
    take: () => {
      setPictures([]);

      return pictures;
    },
    putBack: (carried) => setPictures((held) => [...carried, ...held]),
  };
}
