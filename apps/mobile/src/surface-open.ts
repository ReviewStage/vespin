// surface-open.ts -- counts each surface a screen shows as it opens, once, as the panel's `useSurfaceOpen` counts its own.

import {
  PRODUCT_LAYOUT,
  PRODUCT_SURFACE_EVENT,
  type ProductLayout,
  type ProductSurface,
} from "@repo/features/analytics";
import { useEffect } from "react";
import { Dimensions } from "react-native";
import { useHostCount } from "./host/host-provider.js";
import { WINDOW_SIZE_CLASS, type WindowSizeClass, windowSizeClass } from "./window-size-class.js";

/** The layout a window's size class stands the panel's in: side by side in a regular window, one at a time in a compact one. */
const LAYOUT_OF_SIZE_CLASS = {
  [WINDOW_SIZE_CLASS.REGULAR]: PRODUCT_LAYOUT.WIDE,
  [WINDOW_SIZE_CLASS.COMPACT]: PRODUCT_LAYOUT.NARROW,
} as const satisfies Record<WindowSizeClass, ProductLayout>;

/** An open a screen counted, by what it showed and the layout it stood in. */
type StandingOpen = { readonly of: string | undefined; readonly layout: ProductLayout };

/** Each kind's open as it was last counted, kept while it stands or while a fold hands it to the next screen. */
const standing = new Map<ProductSurface, StandingOpen>();

/** The layout the window stands in now, read live rather than from a render. */
function layoutNow(): ProductLayout {
  return LAYOUT_OF_SIZE_CLASS[windowSizeClass(Dimensions.get("window").width)];
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
 * pushes it back: a surface that closes in another layout than it opened in
 * is held for its next screen, which carries it on rather than counting it,
 * while one that closes in its own layout, such as by Back, is let go.
 */
export function useSurfaceOpen(surface: ProductSurface | undefined, of?: string): void {
  const count = useHostCount();
  useEffect(() => {
    if (surface === undefined) return;

    const layout = layoutNow();
    const held = standing.get(surface);

    // Note that only the same item in another layout is carried on, so a second screen showing it in this layout still counts.
    if (held === undefined || held.of !== of || held.layout === layout) {
      count(PRODUCT_SURFACE_EVENT.SURFACE_OPEN, { surface, layout });
    }

    standing.set(surface, { of, layout });

    return () => {
      const shown = standing.get(surface);

      if (shown !== undefined && shown.of === of && shown.layout === layoutNow()) {
        standing.delete(surface);
      }
    };
  }, [count, surface, of]);
}
