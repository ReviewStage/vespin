/**
 * use-attached-pictures.ts -- the pictures a message or a start carries, as an agent's composer and the sheets that start work hold them: picked from the system's photo picker, compressed as they are read, named as the panel names them, held to the service's bounds, and taken off on a press.
 *
 * A picture is read as a JPEG at `PICTURE_QUALITY`, named "Picture 1",
 * "Picture 2", and on past every picture the holder has, and checked against
 * the service's bounds for one message (`AGENT_BOUNDS`) as it is attached
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
import { randomUUID } from "expo-crypto";
import { launchImageLibraryAsync } from "expo-image-picker";
import { useState } from "react";

/** How a picture is compressed as it is read from the library: JPEG at this quality keeps a phone's photo under the service's bound for an image. */
const PICTURE_QUALITY = 0.7;

/** What a picture the service would refuse says, in the panel's words for a file. */
const PICTURE_REFUSAL = {
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  FULL: (most: number) => `A message can carry up to ${most} files.`,
  TOO_MUCH: "These files are too large to send together.",
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
} as const;

/** A picture attached: the id it is taken off by, and the attachment it sends. */
export interface HeldPicture {
  readonly id: string;
  readonly file: AgentAttachment;
}

/** The next picture's name, numbered past every picture held. */
function nextName(pictures: readonly HeldPicture[], offset: number): string {
  return pictureName(pictures.length + offset + 1);
}

/** Why the pictures held cannot all go together, in the panel's words; none where they can. */
function pictureRefusal(pictures: readonly HeldPicture[]): string | undefined {
  if (pictures.length > AGENT_BOUNDS.MAX_ATTACHMENTS) {
    return PICTURE_REFUSAL.FULL(AGENT_BOUNDS.MAX_ATTACHMENTS);
  }
  const tooLarge = pictures.find(
    ({ file }) => base64Bytes(file.data) > AGENT_BOUNDS.MAX_IMAGE_BYTES,
  );
  if (tooLarge !== undefined) return PICTURE_REFUSAL.TOO_LARGE(tooLarge.file.name);
  const total = pictures.reduce((sum, { file }) => sum + base64Bytes(file.data), 0);
  return total > AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES ? PICTURE_REFUSAL.TOO_MUCH : undefined;
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
  readonly detach: (id: string) => void;
  /** Takes every picture off, as a send does, answering what was held so a refusal can put it back. */
  readonly take: () => readonly HeldPicture[];
  /** Puts pictures a refused send carried back ahead of any attached since. */
  readonly putBack: (pictures: readonly HeldPicture[]) => void;
}

/**
 * The pictures a composer or a sheet attaches, saying what the picker or a
 * bound refused through `onNote`, and nothing once a picture is taken off.
 */
export function useAttachedPictures(onNote: (note: string | undefined) => void): AttachedPictures {
  const [pictures, setPictures] = useState<readonly HeldPicture[]>([]);
  // Note that the system's photo picker reads only what the member picks, so no permission is asked for first, and that it covers the screen, so the pictures held as it opened are those it adds to.
  const attach = () => {
    launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, AGENT_BOUNDS.MAX_ATTACHMENTS - pictures.length),
      quality: PICTURE_QUALITY,
      base64: true,
    })
      .then((picked) => {
        if (picked.canceled) return;
        const read = picked.assets.map((asset, index): HeldPicture | string => {
          const name = nextName(pictures, index);
          if (asset.base64 === null || asset.base64 === undefined) {
            return PICTURE_REFUSAL.UNREADABLE(name);
          }
          return {
            id: randomUUID(),
            file: { name, mediaType: AGENT_ATTACHMENT_TYPE.JPEG, data: asset.base64 },
          };
        });
        const unread = read.find((each): each is string => typeof each === "string");
        const next = [
          ...pictures,
          ...read.filter((each): each is HeldPicture => typeof each !== "string"),
        ];
        setPictures(next);
        onNote(unread ?? pictureRefusal(next));
      })
      .catch((error: unknown) => console.error("The photo picker did not open.", error));
  };
  return {
    attached: pictures.map(({ id, file }) => ({ id, name: file.name })),
    files: pictures.length === 0 ? undefined : pictures.map(({ file }) => file),
    refusal: pictureRefusal(pictures),
    attach,
    detach: (id) => {
      setPictures((held) => held.filter((picture) => picture.id !== id));
      onNote(undefined);
    },
    take: () => {
      setPictures([]);
      return pictures;
    },
    putBack: (carried) => setPictures((held) => [...carried, ...held]),
  };
}
