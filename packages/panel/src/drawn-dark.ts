/**
 * drawn-dark.ts -- whether the window is drawn dark, kept as its theme flips, for what a render picks by theme.
 *
 * The answer is `@repo/ui/appearance`'s, the root's chosen theme or the
 * machine's where it follows the machine, never the media query alone, so
 * a window drawn in a chosen theme picks for that theme.
 */

import { drawnDark, onDrawnThemeChange } from "@repo/ui/appearance";
import { useSyncExternalStore } from "react";

/** Calls back each time the window's theme may have flipped; answers what stops it. */
function onFlip(changed: () => void): () => void {
  return onDrawnThemeChange(changed);
}

/** Whether the window is drawn dark now. */
function darkNow(): boolean {
  return drawnDark();
}

/** Whether the window is drawn dark, drawn again as its theme flips. */
export function useDrawnDark(): boolean {
  return useSyncExternalStore(onFlip, darkNow, darkNow);
}
