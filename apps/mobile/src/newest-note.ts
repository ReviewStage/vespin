// newest-note.ts -- which of a screen's refusals stands over its composer: the one said last, so an older refusal never hides a newer one.

import { useState } from "react";

/** The notes as last seen, and which of them spoke last. */
interface Heard {
  readonly notes: readonly (string | undefined)[];
  readonly newest: number | undefined;
}

/**
 * The note the newest of `notes` said, each the words why one of a screen's
 * own acts did not take, none while it says nothing: the one that took its
 * words last, and where that one has gone quiet, the first still saying
 * something. Note that a note is newest from the render it changes in, so two
 * acts refused in turn stand in the order they were refused, whatever order
 * the screen lists them in; it is read as the notes change, as React adjusts
 * state to what a render is handed, rather than in an effect a frame later.
 */
export function useNewestNote(notes: readonly (string | undefined)[]): string | undefined {
  const [heard, setHeard] = useState<Heard>({ notes, newest: undefined });
  const moved = notes.some((note, at) => note !== heard.notes[at]);
  let { newest } = heard;

  if (moved) {
    const changed = notes.findLastIndex(
      (note, at) => note !== undefined && note !== heard.notes[at],
    );

    if (changed >= 0) newest = changed;
    setHeard({ notes, newest });
  }

  const standing = newest === undefined ? undefined : notes[newest];

  return standing ?? notes.find((note) => note !== undefined);
}
