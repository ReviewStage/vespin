// task-status-marks.mjs -- a task's status as its mark draws it, the one table the panel's SVG and the iOS app's custom symbols both read.
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
export const TASK_MARK_ELEMENT = { CIRCLE: "circle", PATH: "path" };

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
