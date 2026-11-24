// layout-margin.ts -- the system's layout margin for the window the app is drawn in, and where a list row's pieces stand from it.

import { useWindowDimensions } from "react-native";
import { LAYOUT_MARGIN, MARK_SIZE, ROW_INSET, SPACE } from "./tokens/space.js";

/** Where a row's pieces stand from its column's leading edge, in points. */
export type RowInset = {
  /** The layout margin: where a row's content ends on the trailing side, and where the unread dot's trailing edge stands. */
  readonly margin: number;
  /** A row's leading inset where it draws the unread dot: the margin less the dot, so the dot stands in the margin. */
  readonly dotted: number;
  /** Where every row's leading mark starts, a dotted row's past its dot and the gutter, a plain row's (a task's) at once, so the two lists' marks line up. */
  readonly lead: number;
  /** Where a row's words, and the hairline under them, start, beside a lead of its default size; a row whose lead grows with the reader's text, or stands deeper, adds that as its `indent`. */
  readonly text: number;
};

/**
 * The layout margin UIKit stands a window of `width` points on: the wide one
 * from the iPhone Plus's width up, the narrow one under it.
 */
function layoutMargin(width: number): number {
  return width >= LAYOUT_MARGIN.WIDE_MIN_WIDTH ? LAYOUT_MARGIN.WIDE : LAYOUT_MARGIN.NARROW;
}

/**
 * Where a list row's pieces stand in the window the app is drawn in, live
 * across a rotation, a fold, or a resize. Note that the margin is read from
 * the window rather than from SwiftUI's own row insets, because `@expo/ui`'s
 * `listRowInsets` sets all four edges, a missing one as 0, so a row could
 * not keep the system's sides while setting its own top and bottom; and a
 * selected row's fill reaches out into the margin, which only a number can
 * say. Each is unscaled, as the dot's margin always was; a row adds what
 * its marks grow by with the reader's text.
 */
export function useRowInset(): RowInset {
  const { width } = useWindowDimensions();
  const margin = layoutMargin(width);
  const lead = margin + ROW_INSET.GUTTER;

  return {
    margin,
    dotted: margin - MARK_SIZE.UNREAD,
    lead,
    text: lead + MARK_SIZE.LEAD + SPACE.ROW,
  };
}
