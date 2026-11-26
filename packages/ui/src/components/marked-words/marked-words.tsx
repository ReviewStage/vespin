/**
 * marked-words.tsx -- words with a small mark set inside them, right before the part it marks, as a teammate's face stands before their machine's name in "Simulator on Theo's MacBook Pro".
 */

import type { ReactNode } from "react";

/** A mark set inside a name: `mark`, hidden from a screen reader, right before the words from `at` on. */
export interface WordsMark {
  /** Where in the words the marked part starts: the length of the words before it. */
  readonly at: number;
  readonly mark: ReactNode;
}

/** The mark's box: one line's height, centered on the words, a small gap before the words it marks, and nothing where the mark draws nothing. */
const MARK = "ui-words-mark inline-flex empty:hidden h-[1em] items-center align-middle me-icon-gap";

/** Words, with the mark set before the part it marks where one is given and falls inside them; the words alone otherwise. */
export function MarkedWords({
  words,
  mark,
}: {
  words: string;
  mark?: WordsMark | undefined;
}): ReactNode {
  if (mark === undefined || mark.mark === null || mark.at <= 0 || mark.at >= words.length) {
    return words;
  }

  return (
    <>
      {words.slice(0, mark.at)}
      <span className={MARK} aria-hidden="true">
        {mark.mark}
      </span>
      {words.slice(mark.at)}
    </>
  );
}
