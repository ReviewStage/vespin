// use-window-size-class.ts -- the size class of the window the app is drawn in, live across a fold, a rotation, or a resize, once the window has settled.

import { useSyncExternalStore } from "react";
import { Dimensions, type ScaledSize, useWindowDimensions } from "react-native";
import {
  standsThreeColumns,
  WINDOW_SIZE_CLASS,
  type WindowSizeClass,
  windowSizeClass,
} from "./window-size-class.js";

/**
 * How long a new size class must hold before the app takes it. A fold, an
 * unfold, or a Stage Manager drag passes the window through sizes on either
 * side of the line, and each crossing would swap the layout and hand pages
 * between the stack and the split view; a class that holds this long is the
 * window's own.
 */
const SETTLE_MS = 250;

const listeners = new Set<() => void>();
let settled: WindowSizeClass = sizeClassOf(Dimensions.get("window"));
let settling: ReturnType<typeof setTimeout> | undefined;
let following: { remove(): void } | undefined;

function sizeClassOf(window: ScaledSize): WindowSizeClass {
  return windowSizeClass(window.width, window.height);
}

function onWindowChange({ window }: { readonly window: ScaledSize }) {
  const next = sizeClassOf(window);
  clearTimeout(settling);
  settling = undefined;

  if (next === settled) return;
  settling = setTimeout(() => {
    settling = undefined;
    settled = next;

    for (const listener of listeners) listener();
  }, SETTLE_MS);
}

function subscribe(listener: () => void) {
  // Note that we read the window afresh when the first reader comes, because no change was followed while none read it.
  if (listeners.size === 0) {
    settled = sizeClassOf(Dimensions.get("window"));
    following = Dimensions.addEventListener("change", onWindowChange);
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size > 0) return;
    following?.remove();
    following = undefined;
    clearTimeout(settling);
    settling = undefined;
  };
}

/** The window's size class, which every reader takes in the same render once it has held for `SETTLE_MS`. */
export function useWindowSizeClass(): WindowSizeClass {
  return useSyncExternalStore(subscribe, () => settled);
}

/** Whether the window the app is drawn in stands three columns: a regular window wide enough, live as its width is. */
export function useThreeColumns(): boolean {
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const { width } = useWindowDimensions();

  return regular && standsThreeColumns(width);
}
