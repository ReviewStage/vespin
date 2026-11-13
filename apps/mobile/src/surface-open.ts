// surface-open.ts -- counts each surface a screen shows as it opens, once, as the panel's `useSurfaceOpen` counts its own.

import {
  PRODUCT_LAYOUT,
  PRODUCT_SURFACE_EVENT,
  type ProductLayout,
  type ProductSurface,
} from "@repo/features/analytics";
import { useWindowSizeClass, WINDOW_SIZE_CLASS, type WindowSizeClass } from "@repo/ui-native";
import { useEffect, useRef } from "react";
import { useHostCount } from "./host/host-provider.js";

/** The layout a window's size class stands the panel's in: side by side in a regular window, one at a time in a compact one. */
const LAYOUT_OF_SIZE_CLASS = {
  [WINDOW_SIZE_CLASS.REGULAR]: PRODUCT_LAYOUT.WIDE,
  [WINDOW_SIZE_CLASS.COMPACT]: PRODUCT_LAYOUT.NARROW,
} as const satisfies Record<WindowSizeClass, ProductLayout>;

/**
 * Counts `surface` as it opens, through the host's bridge, which sends it
 * on the panel's own wire (`/api/events`, under the event's allowlist) as
 * `surface:open` with the kind and the layout alone, never which thread,
 * task, or agent it showed. `of` is what tells two opens of one kind apart,
 * so opening another thread is another open, and it never leaves this hook;
 * a window that folds or turns while the surface stands counts nothing. An
 * undefined `surface` counts nothing, for a screen that stands but shows
 * none, such as one handing its item to the split view beside the list.
 */
export function useSurfaceOpen(surface: ProductSurface | undefined, of?: string): void {
  const count = useHostCount();
  const layout = LAYOUT_OF_SIZE_CLASS[useWindowSizeClass()];
  // Note that the layout is read as the surface opens, rather than being a reason to count it again.
  const layoutNow = useRef(layout);
  useEffect(() => {
    layoutNow.current = layout;
  }, [layout]);
  useEffect(() => {
    if (surface === undefined) return;
    count(PRODUCT_SURFACE_EVENT.SURFACE_OPEN, { surface, layout: layoutNow.current });
  }, [count, surface, of]);
}
