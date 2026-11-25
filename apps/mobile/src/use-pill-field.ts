// use-pill-field.ts -- a composer's field of pills as its screen holds it: its door, the `@` word its caret stands in, each mention picked from the `@` offer standing as its pill, and each file attached standing as its marker's pill in the words, a picture's wearing its thumbnail and opening full screen on a press.

import { fileMarker, writtenMarkers } from "@repo/features/file-marker";
import { filePill, mentionPill } from "@repo/features/pill-words";
import {
  type AttachedPicture,
  type CaretAtWord,
  type ComposerPills,
  type PillFieldHandle,
  usePicturesView,
} from "@repo/ui-native";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { useEffect, useMemo, useRef, useState } from "react";
import { cachedPicture } from "./cached-media.js";
import type { AttachedPictures } from "./use-attached-pictures.js";
import type { MentionPills } from "./use-mention-offer.js";

/** What a held picture's file is named with under the app's caches, before the id it was written under. */
const HELD_PICTURE_PREFIX = "held-picture";

/** A picture's bytes as its `data:` address spells them: its type, then its base64. */
const DATA_ADDRESS = /^data:([^;,]+);base64,(.+)$/u;

/** A held picture's file: the address its bytes were held under as it was written, and the file's address. */
interface WrittenPicture {
  readonly address: string;
  readonly file: string;
}

/** Deletes a held picture's file once its picture is taken off; one that stays only costs the cache. */
function deleteWritten(file: string) {
  try {
    const written = new File(file);

    if (written.exists) written.delete();
  } catch (error: unknown) {
    console.error("A held picture's file was not deleted.", error);
  }
}

/**
 * The files the pictures held are written to, by each picture's name: each
 * picture's bytes written once under the app's caches as it is attached, so
 * its pill hands the native field a file's short address on every key
 * rather than its bytes, the field decoding a thumbnail at the pill's size
 * from the file (`PillField`'s `thumbnails`), and its viewer opens the file.
 * A picture whose bytes change under the same id, as a thread's draft names
 * a later picture as an earlier one was named, is written again, and the
 * file of one taken off is deleted.
 */
function useHeldPictureFiles(attached: readonly AttachedPicture[]): ReadonlyMap<string, string> {
  const [written, setWritten] = useState<ReadonlyMap<string, WrittenPicture>>(new Map());
  // The ids being written, by the address each is written from, so a render meanwhile writes none twice.
  const writing = useRef(new Map<string, string>());

  useEffect(() => {
    const held = new Map(attached.map((picture) => [picture.id, picture.address]));

    // Note that a file is let go once its picture is taken off or its bytes change, so the next write of its id lands fresh.
    const stale = [...written].filter(([id, file]) => held.get(id) !== file.address);

    if (stale.length > 0) {
      for (const [, file] of stale) deleteWritten(file.file);
      setWritten(new Map([...written].filter(([id, file]) => held.get(id) === file.address)));

      return;
    }

    for (const { id, address } of attached) {
      const read = address === undefined ? undefined : DATA_ADDRESS.exec(address);

      const settled = writing.current.get(id) === address || written.get(id)?.address === address;

      if (address === undefined || read === null || read === undefined || settled) continue;

      const [, mediaType = "", base64 = ""] = read;
      writing.current.set(id, address);

      // Note that each write is named afresh, so a picture written again under its id never finds the earlier file standing.
      void cachedPicture(HELD_PICTURE_PREFIX, randomUUID(), mediaType, base64)
        .then((file) => {
          if (file === undefined || writing.current.get(id) !== address) return;
          setWritten((now) => new Map(now).set(id, { address, file }));
        })
        .catch((cause: unknown) => console.error("A held picture's file was not written.", cause))
        .finally(() => {
          if (writing.current.get(id) === address) writing.current.delete(id);
        });
    }
  }, [attached, written]);

  return useMemo(
    () =>
      new Map(
        attached.flatMap(({ id, name, address }) => {
          const file = written.get(id);

          return file === undefined || file.address !== address ? [] : [[name, file.file] as const];
        }),
      ),
    [attached, written],
  );
}

/** A composer's field of pills: what its `Composer` or `StartPage` is handed, and what its `@` offer is handed. */
export interface PillFieldHeld {
  readonly pills: ComposerPills;
  readonly mentions: MentionPills;
}

/**
 * The field of pills of a composer whose words are `words` and whose files
 * are `pictures`. A pick from the `@` offer stands as the mention's pill in
 * the `@` word's place. A file attached, picked, dropped, or a long paste
 * taken as a text file, stands as its marker's pill where the caret is, as
 * the panel's box lays in its chip, and a file whose pill is taken out of
 * the words is taken off, as deleting the panel's chip takes it off; a file
 * put back with its words, as a refused send's, finds its marker already
 * there. A file held before the field stands, as a shared draft's pictures
 * are, has its marker written after the words, since there is no caret yet.
 * Note that only a file whose marker the field has written is taken off, so
 * none goes while its pill is on its way into the words. A picture's pill
 * wears its thumbnail once its file is written (`useHeldPictureFiles`), and
 * a press on it opens the picture full screen in the app's viewer, as the
 * panel's chip opens it, its file or, until that is written, its bytes.
 */
export function usePillField(
  words: string,
  onWords: (words: string) => void,
  pictures: Pick<AttachedPictures, "attached" | "detach">,
): PillFieldHeld {
  const field = useRef<PillFieldHandle>(null);
  const [atWord, setAtWord] = useState<CaretAtWord | undefined>(undefined);
  const [focused, setFocused] = useState(false);

  // The names the field draws as pills: each file held, a picture or a pasted text.
  const held = useMemo(
    () => new Set(pictures.attached.map((each) => each.name)),
    [pictures.attached],
  );

  // The files whose markers the field was asked to place and has not yet written, and those whose markers it has written.
  const placing = useRef(new Set<string>());
  const written = useRef(new Set<string>());
  const { attached, detach } = pictures;
  const thumbnails = useHeldPictureFiles(attached);
  const view = usePicturesView();

  useEffect(() => {
    const inWords = new Set(writtenMarkers(words).map((marker) => marker.name));

    for (const { id, name } of attached) {
      if (written.current.has(name) && !inWords.has(name)) detach(id);
    }

    const unplaced = [...held].filter(
      (name) => !inWords.has(name) && !placing.current.has(name) && !written.current.has(name),
    );

    written.current = new Set([...inWords].filter((name) => held.has(name)));
    placing.current = new Set(
      [...placing.current, ...unplaced].filter(
        (name) => held.has(name) && !written.current.has(name),
      ),
    );

    if (unplaced.length === 0) return;

    if (field.current !== null) return field.current.place(unplaced.map(filePill));
    const markers = unplaced.map(fileMarker).join(" ");
    onWords(words.trim() === "" ? `${markers} ` : `${words.trimEnd()} ${markers} `);
  }, [words, onWords, held, attached, detach]);

  return {
    pills: {
      field,
      onAtWord: setAtWord,
      files: held,
      onFocusChange: setFocused,
      thumbnails,
      onPicturePress: (name) => {
        const source = thumbnails.get(name) ?? attached.find((each) => each.name === name)?.address;

        if (source !== undefined) view?.([{ source, title: name, subtitle: undefined }], 0);
      },
    },
    mentions: {
      word: atWord,
      focused,
      pick: (mention) => field.current?.pick(mentionPill(mention.name, mention.target)),
      rewrite: (words) => field.current?.rewrite(words),
    },
  };
}
