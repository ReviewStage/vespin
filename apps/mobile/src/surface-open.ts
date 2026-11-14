// surface-open.ts -- counts each surface a screen shows as it opens, once, as the panel's `useSurfaceOpen` counts its own.

import {
  PRODUCT_LAYOUT,
  PRODUCT_SURFACE_EVENT,
  type ProductLayout,
  type ProductSurface,
} from "@repo/features/analytics";
import { useEffect, useRef } from "react";
import { Dimensions } from "react-native";
import { useHostCount } from "./host/host-provider.js";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS, type WindowSizeClass, windowSizeClass } from "./window-size-class.js";

/** The layout a window's size class stands the panel's in: side by side in a regular window, one at a time in a compact one. */
const LAYOUT_OF_SIZE_CLASS = {
  [WINDOW_SIZE_CLASS.REGULAR]: PRODUCT_LAYOUT.WIDE,
  [WINDOW_SIZE_CLASS.COMPACT]: PRODUCT_LAYOUT.NARROW,
} as const satisfies Record<WindowSizeClass, ProductLayout>;

/**
 * How long, in milliseconds, an open a layout change closed waits for the
 * screen that takes it over, as an unfold's split view selects the thread a
 * pushed page handed it, a few renders and a navigation later.
 */
const HAND_OFF_MS = 2000;

/** An open a layout change closed, by what it showed, kept for the screen that takes it over. */
type HandedOpen = { readonly of: string | undefined; readonly at: number };

/** Each kind's opens a layout change closed, waiting to be carried on. */
const handed = new Map<ProductSurface, readonly HandedOpen[]>();

/** The layout the window stands in now, read live rather than from a render. */
function layoutNow(): ProductLayout {
  return LAYOUT_OF_SIZE_CLASS[windowSizeClass(Dimensions.get("window").width)];
}

/** Takes the open of `surface` and `of` a layout change closed lately, if one waits, so it is carried on rather than counted. */
function takeHanded(surface: ProductSurface, of: string | undefined, now: number): boolean {
  const waiting = (handed.get(surface) ?? []).filter((open) => now - open.at < HAND_OFF_MS);
  const index = waiting.findIndex((open) => open.of === of);
  handed.set(
    surface,
    waiting.filter((_, at) => at !== index),
  );

  return index !== -1;
}

/**
 * Counts `surface` as it opens, through the host's bridge, which sends it
 * on the panel's own wire (`/api/events`, under the event's allowlist) as
 * `surface:open` with the kind and the layout alone, never which thread,
 * task, or agent it showed. `of` is what tells two opens of one kind apart,
 * so opening another thread is another open, and it never leaves this
 * module. An undefined `surface` counts nothing, for a screen that stands
 * but shows none, such as one handing its item to the split view beside the
 * list. Note that a window that folds or turns while the surface stands
 * counts nothing, even where another screen takes the surface over, as an
 * unfold hands a pushed thread to the split view beside the list and a fold
 * pushes it back: a screen that a layout change closes hands its open on,
 * and the screen that opens the same item within `HAND_OFF_MS` carries it
 * rather than counting it. A screen that stands through the change and
 * closes later, such as by Back, hands nothing on.
 */
export function useSurfaceOpen(surface: ProductSurface | undefined, of?: string): void {
  const count = useHostCount();
  const layout = LAYOUT_OF_SIZE_CLASS[useWindowSizeClass()];
  // Note that the layout this screen last drew in is kept apart from the open, so a change it stood through isn't taken for one that closed it.
  const drawnIn = useRef(layout);
  useEffect(() => {
    drawnIn.current = layout;
  }, [layout]);
  useEffect(() => {
    if (surface === undefined) return;

    if (!takeHanded(surface, of, Date.now())) {
      count(PRODUCT_SURFACE_EVENT.SURFACE_OPEN, { surface, layout: layoutNow() });
    }

    // Note that a close in a commit whose layout moved is that change's doing, since a commit's cleanups run before its effects mark the new layout drawn.
    return () => {
      if (drawnIn.current === layoutNow()) return;
      handed.set(surface, [...(handed.get(surface) ?? []), { of, at: Date.now() }]);
    };
  }, [count, surface, of]);
}
