// kept.ts -- a value built afresh on each render, kept as the one it stood as while it is the same, so what reads it by identity draws again only as it moves.

import { useMemo, useState } from "react";

/**
 * `built`, or the value this hook answered last where `keep` answers it in
 * `built`'s place: the last itself where the two are the same, or one made
 * of the last's parts where they are partly so (`shareAppState`). Note that
 * the last answer is held in a box the memo writes, rather than in state,
 * since a state set while drawing would draw the caller twice for each
 * move; a draw React throws away may leave its answer there, which is safe
 * because every answer `keep` gives is the same as what was built.
 */
export function useKept<T>(built: T, keep: (held: T, built: T) => T): T {
  const [box] = useState(() => ({ held: built }));

  return useMemo(() => {
    box.held = keep(box.held, built);

    return box.held;
  }, [box, built, keep]);
}
