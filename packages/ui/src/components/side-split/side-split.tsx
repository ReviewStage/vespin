/**
 * side-split.tsx -- a view and a pane opened beside it inside the same column, parted by a resize edge, the pane standing alone the column's whole width where the column is too narrow for both.
 *
 * A Manager's chat opens a thread beside its messages as Slack opens one:
 * the chat keeps the room the pane leaves it, the pane as wide as it was
 * last dragged (`width`), held between its bounds and never so wide the
 * view beside it drops under `mainMin`. Narrower than the view's least and
 * the pane's least together, the view hides, kept drawn beneath so its
 * scroll stands where it was, and the pane fills the column with no edge.
 * The owner holds the split (`useSideSplit`) and hands it to the
 * `SideSplit` it draws, as a pane's owner holds its `ResizeEdge`, so it
 * knows whether the pane stands alone and draws its heads to match: the
 * pane's way back, and where the view's own head stands. Note that the
 * split measures its own width rather than the window's, since the column
 * it stands in shares the window with a sidebar and a side panel.
 */

import { type ReactNode, useCallback, useState } from "react";
import {
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  type ResizeEdgeHandle,
  useResizeEdge,
} from "../resize-edge/resize-edge.js";

/** A pane's widths, in CSS pixels: the least and greatest it is dragged to, and the one a reset gives it. */
export interface SideSplitBounds {
  readonly MIN: number;
  readonly MAX: number;
  readonly DEFAULT: number;
}

export interface SideSplitOptions {
  /** Whether the pane is open. */
  open: boolean;
  /** The pane's width as its owner keeps it. */
  width: number;
  bounds: SideSplitBounds;
  /** The least the view keeps beside the pane before it hides. */
  mainMin: number;
  /** What the edge is called. */
  label: string;
  onResize: (width: number) => void;
}

/** A split as measured: the ref its root takes, whether the pane stands alone, the width it is drawn at, and its edge. */
export interface SideSplitHandle {
  readonly ref: (element: HTMLElement | null) => (() => void) | undefined;
  readonly open: boolean;
  readonly alone: boolean;
  readonly drawn: number;
  readonly edge: ResizeEdgeHandle;
}

/** The split, measured as its root resizes. Note that it is held by the owner, which outlives the pane, as a drag outlives the edge it began on. */
export function useSideSplit(options: SideSplitOptions): SideSplitHandle {
  const { open, width, bounds, mainMin, label, onResize } = options;
  const [room, setRoom] = useState(0);

  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => setRoom(element.getBoundingClientRect().width));
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.LEFT,
    width,
    bounds,
    reserve: () => mainMin,
    label,
    onResize,
  });

  // A split not yet measured stands both, as it starts.
  const alone = open && room > 0 && room < mainMin + bounds.MIN;
  const drawn = room > 0 ? Math.max(bounds.MIN, Math.min(width, room - mainMin)) : width;

  return { ref, open, alone, drawn, edge };
}

/** A view with a pane opened beside it, or alone while the split is shut. */
export function SideSplit({
  split,
  main,
  side,
}: {
  split: SideSplitHandle;
  /** The view the pane opens beside, kept drawn while the pane stands alone. */
  main: ReactNode;
  /** The pane, drawn while the split is open. */
  side: ReactNode;
}): React.JSX.Element {
  const { alone } = split;

  return (
    <div
      ref={split.ref}
      className="ui-side-split relative flex min-h-0 min-w-0 flex-1 [&>[hidden]]:hidden"
      data-alone={alone ? "" : undefined}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" hidden={alone}>
        {main}
      </div>
      {split.open ? (
        <div
          className="relative flex min-h-0 min-w-0 flex-col border-border data-[alone]:flex-1 not-data-[alone]:flex-none not-data-[alone]:border-l"
          data-alone={alone ? "" : undefined}
          style={alone ? undefined : { width: split.drawn }}
        >
          {alone ? null : <ResizeEdge edge={split.edge} />}
          {side}
        </div>
      ) : null}
    </div>
  );
}
