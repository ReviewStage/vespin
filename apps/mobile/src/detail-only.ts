// detail-only.ts -- whether a window wide enough for three columns stands its detail alone, as Mail's expand button stands a message, one answer for the detail bar's button and the menu bar's ⌃⌘F.

import { useSyncExternalStore } from "react";
import { useThreeColumns } from "./use-window-size-class.js";

/** Whether the detail stands alone, for this launch. */
let held = false;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function choose(alone: boolean): void {
  held = alone;

  for (const listener of listeners) listener();
}

type UseDetailOnlyResult = {
  readonly alone: boolean;
  readonly setAlone: (alone: boolean) => void;
  readonly toggle: () => void;
};

/**
 * Whether the detail stands alone across the window, and how to set or
 * toggle it. Note that only a window wide enough for three columns stands it
 * so, since a narrower one already gives its list and detail the system's own
 * sidebar button, so it reads as not alone there.
 */
export function useDetailOnly(): UseDetailOnlyResult {
  const threeColumns = useThreeColumns();
  const alone = useSyncExternalStore(subscribe, () => held) && threeColumns;

  return { alone, setAlone: choose, toggle: () => choose(!alone) };
}
