import type { ReactNode } from "react";

/**
 * edge-clip.tsx -- the box inside a rounded frame's edge that clips what the frame holds, so nothing drawn to the frame's edge paints over its corners.
 *
 * A frame that draws an edge (a border) and clips what it holds on the same
 * box loses its edge's corners to a video, a canvas, or anything else the
 * window composites apart: Chromium clips such a layer at the frame's outer
 * corner rather than inside its edge, so at each round corner it paints
 * over the inner half of the edge's curve, as a recording playing at a
 * dialog card's foot did. The frame therefore keeps its edge, corner, ground,
 * and shadow and clips nothing, and this box, standing inside the edge with
 * none of its own, clips what it holds at the frame's corner
 * (`rounded-inherit`), which a composited layer cannot reach past.
 * The style guard's `edge-clip` rule refuses a box that rounds, draws an
 * edge, and clips, in a stylesheet or a class list.
 *
 * It fills the frame and lays what it holds out as the frame would have:
 * down a column (`COLUMN`), as a card with a head over a body does, in the
 * flow of a block (`BLOCK`), as a card around one thing does, or laid over
 * a box a shape holds (`FILL`), what it holds centered in it and a layer
 * placed in it clipped with the rest, as a thumb's page is; as a `span`
 * where the frame is one.
 */

/** How the box lays out what it holds: down a column, in a block's flow, or over a shape's box. */
export const EDGE_CLIP_LAYOUT = {
  COLUMN: "column",
  BLOCK: "block",
  FILL: "fill",
} as const;

export type EdgeClipLayout = (typeof EDGE_CLIP_LAYOUT)[keyof typeof EDGE_CLIP_LAYOUT];

/** The element the box is, a `span` inside a frame that is one. */
export const EDGE_CLIP_ELEMENT = {
  DIV: "div",
  SPAN: "span",
} as const;

export type EdgeClipElement = (typeof EDGE_CLIP_ELEMENT)[keyof typeof EDGE_CLIP_ELEMENT];

/**
 * The clip at the frame's corner. Note that it clips without becoming a
 * scroller (`overflow-clip`), so a focus inside never scrolls it.
 */
const CLIP = "ui-edge-clip min-h-0 min-w-0 overflow-clip rounded-inherit";

const LAYOUT_CLASS = {
  [EDGE_CLIP_LAYOUT.COLUMN]: "flex flex-auto flex-col",
  [EDGE_CLIP_LAYOUT.BLOCK]: "block",
  [EDGE_CLIP_LAYOUT.FILL]: "absolute inset-0 flex items-center justify-center",
} as const satisfies Record<EdgeClipLayout, string>;

/** What a frame holds, clipped inside its edge at its corner. */
export function EdgeClip({
  as: Element = EDGE_CLIP_ELEMENT.DIV,
  layout = EDGE_CLIP_LAYOUT.COLUMN,
  children,
}: {
  as?: EdgeClipElement | undefined;
  layout?: EdgeClipLayout | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return <Element className={`${CLIP} ${LAYOUT_CLASS[layout]}`}>{children}</Element>;
}
