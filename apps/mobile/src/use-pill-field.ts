// use-pill-field.ts -- a composer's field of pills as its screen holds it: its door, the `@` word its caret stands in, each mention picked from the `@` offer standing as its pill, and each file attached standing as its marker's pill in the words.

import { fileMarker, writtenMarkers } from "@repo/features/file-marker";
import { filePill, mentionPill } from "@repo/features/pill-words";
import type { CaretAtWord, ComposerPills, PillFieldHandle } from "@repo/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AttachedPictures } from "./use-attached-pictures.js";
import type { MentionPills } from "./use-mention-offer.js";

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
 * none goes while its pill is on its way into the words.
 */
export function usePillField(
  words: string,
  onWords: (words: string) => void,
  pictures: Pick<AttachedPictures, "attached" | "detach">,
): PillFieldHeld {
  const field = useRef<PillFieldHandle>(null);
  const [atWord, setAtWord] = useState<CaretAtWord | undefined>(undefined);

  // The names the field draws as pills: each file held, a picture or a pasted text.
  const held = useMemo(
    () => new Set(pictures.attached.map((each) => each.name)),
    [pictures.attached],
  );

  // The files whose markers the field was asked to place and has not yet written, and those whose markers it has written.
  const placing = useRef(new Set<string>());
  const written = useRef(new Set<string>());
  const { attached, detach } = pictures;

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
    pills: { field, onAtWord: setAtWord, files: held },
    mentions: {
      word: atWord,
      pick: (mention) => field.current?.pick(mentionPill(mention.name, mention.target)),
    },
  };
}
