/**
 * box-words.ts -- the words a message box holds, as a source the box reads coarse facts of rather than a string its owner draws it with on every key.
 *
 * A box's words change on every key, while what most of the box draws from
 * them changes rarely: whether it is empty, which files its markers name,
 * whether a `/` word leads it. So the words reach the box as a source, and
 * each part selects what it draws (`useWordsOf`), drawn again only as that
 * changes; the field alone reads them whole. An owner that keeps the words
 * in the drafts hands their source (`useDraftWords`), so its own surface is
 * never drawn again on a word typed; one that keeps them as its own state
 * hands the string, which the box reads through `useHandedWords`, drawn as
 * that owner draws it.
 */

import { useSelector } from "@tanstack/react-store";
import { useRef, useState } from "react";

/** The words a box holds: read as they stand, and heard as they change. */
export interface BoxWords {
  readonly get: () => string;
  readonly subscribe: (listener: (words: string) => void) => { readonly unsubscribe: () => void };
}

/** No change ever heard, for words handed as a string, whose owner draws the box anew as they change. */
const NEVER_HEARD = { unsubscribe: () => undefined };

/** What the box's words say through `select`, drawn again only as that changes, by `same` where it answers no primitive. */
export function useWordsOf<Selected>(
  words: BoxWords,
  select: (words: string) => Selected,
  same?: (one: Selected, other: Selected) => boolean,
): Selected {
  return useSelector(words, select, same === undefined ? undefined : { compare: same });
}

/**
 * Words handed as a string, as a source: the same one across draws, reading
 * the string handed last. Note that it hears no change, because its owner
 * draws the box again with each string it hands.
 */
export function useHandedWords(handed: string): BoxWords {
  const latest = useRef(handed);
  latest.current = handed;

  const [words] = useState<BoxWords>(() => ({
    get: () => latest.current,
    subscribe: () => NEVER_HEARD,
  }));

  return words;
}
