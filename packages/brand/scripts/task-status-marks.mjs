// task-status-marks.mjs -- a task's status and priority as their marks draw them, the one table the panel's SVG and the iOS app's custom symbols both read.
//
// A status is a ring that fills as work moves through it: dashed while it is
// filed for later, an empty ring to do, a half disc inside the ring under
// way, and a filled disc once settled, with a check cut out of it for done
// and a cross for canceled. Each part is an SVG element on a 14-unit square
// in one of three roles: a line stroked at `TASK_MARK_LINE_WIDTH`, a fill,
// or a cut, the stroke the panel draws in the ground's ink over a fill and
// the iOS symbol cuts out of it.

/** The square a mark is drawn on. */
export const TASK_MARK_BOX = 14;

/** How wide a line or a cut is drawn, as `@repo/ui`'s `task-marks.css` strokes it. */
export const TASK_MARK_LINE_WIDTH = 1.5;

/** What a part of a mark is: a stroked line, a fill, or a stroke cut out of the fill beneath it. */
export const TASK_MARK_ROLE = { LINE: "line", FILL: "fill", CUT: "cut" };

/** The SVG element a part is drawn as. */
export const TASK_MARK_ELEMENT = { CIRCLE: "circle", PATH: "path", RECT: "rect" };

/**
 * The layer a priority's bar stands on: lit in the mark's own ink, or unlit,
 * the same ink at `TASK_PRIORITY_UNLIT_OPACITY`, as `@repo/ui`'s
 * `task-marks.css` draws a bar the priority doesn't reach. The iOS symbol
 * draws the unlit layer as its secondary, which the app's palette paints.
 */
export const TASK_MARK_LAYER = { LIT: "lit", UNLIT: "unlit" };

/** How strongly an unlit bar is drawn against a lit one. */
export const TASK_PRIORITY_UNLIT_OPACITY = 0.25;

/** The ring every status but the settled ones draws. */
const RING = { role: TASK_MARK_ROLE.LINE, element: TASK_MARK_ELEMENT.CIRCLE, cx: 7, cy: 7, r: 5.5 };

/** The disc a settled status fills, out to the ring's outer edge. */
const DISC = {
  role: TASK_MARK_ROLE.FILL,
  element: TASK_MARK_ELEMENT.CIRCLE,
  cx: 7,
  cy: 7,
  r: 6.25,
};

/** Each status's mark, by `TASK_STATUS`'s key, its parts in drawing order. */
export const TASK_STATUS_MARK = {
  BACKLOG: [{ ...RING, dash: [2, 1.8] }],
  TODO: [RING],
  IN_PROGRESS: [
    RING,
    { role: TASK_MARK_ROLE.FILL, element: TASK_MARK_ELEMENT.PATH, d: "M7 3.5a3.5 3.5 0 0 1 0 7Z" },
  ],
  DONE: [
    DISC,
    { role: TASK_MARK_ROLE.CUT, element: TASK_MARK_ELEMENT.PATH, d: "M4.4 7.2l1.8 1.8 3.5-3.6" },
  ],
  CANCELED: [
    DISC,
    { role: TASK_MARK_ROLE.CUT, element: TASK_MARK_ELEMENT.PATH, d: "M5 5l4 4M9 5l-4 4" },
  ],
};

/**
 * The square a priority's mark spans within its 14 units: about the area of
 * a status's disc (0.75 to 13.25), centered on it, rather than its width,
 * because a square as wide as a circle reads larger beside it. So a
 * priority stands inside the same room around it a status does.
 */
const MARK_EDGE = { start: 1.5, end: 12.5 };

/** How wide each of a priority's bars is drawn. */
const BAR_WIDTH = 2.6;

/** The three bars, rising left to right across the mark's square to its foot. */
const BARS = [
  { x: MARK_EDGE.start, y: 8.5, height: 4 },
  { x: 7 - BAR_WIDTH / 2, y: 5, height: 7.5 },
  { x: MARK_EDGE.end - BAR_WIDTH, y: MARK_EDGE.start, height: 11 },
];

/** A priority's bars, the first `lit` of them on the lit layer and the rest unlit. */
const bars = (lit) =>
  BARS.map(({ x, y, height }, index) => ({
    role: TASK_MARK_ROLE.FILL,
    element: TASK_MARK_ELEMENT.RECT,
    x,
    y,
    width: BAR_WIDTH,
    height,
    rx: 0.75,
    layer: index < lit ? TASK_MARK_LAYER.LIT : TASK_MARK_LAYER.UNLIT,
  }));

/**
 * Each priority's mark, by `TASK_PRIORITY`'s key: three bars, as many lit as
 * it matters; urgent a filled square with a "!" cut from it; and three short
 * dashes for a task no one weighed.
 */
export const TASK_PRIORITY_MARK = {
  NONE: BARS.map(({ x }) => ({
    role: TASK_MARK_ROLE.FILL,
    element: TASK_MARK_ELEMENT.RECT,
    x,
    y: 6.25,
    width: BAR_WIDTH,
    height: 1.5,
    rx: 0.6,
  })),
  URGENT: [
    {
      role: TASK_MARK_ROLE.FILL,
      element: TASK_MARK_ELEMENT.RECT,
      x: MARK_EDGE.start,
      y: MARK_EDGE.start,
      width: MARK_EDGE.end - MARK_EDGE.start,
      height: MARK_EDGE.end - MARK_EDGE.start,
      rx: 2.5,
    },
    { role: TASK_MARK_ROLE.CUT, element: TASK_MARK_ELEMENT.PATH, d: "M7 4v3.6M7 9.6v.2" },
  ],
  HIGH: bars(3),
  MEDIUM: bars(2),
  LOW: bars(1),
};
