/**
 * scroll-log.ts -- a development log of what moves a run's scroll, switched on from the console, to find what makes a long log jump.
 *
 * Off unless the window's console sets `vespinScrollLog = true`, which takes
 * effect at once and lasts until the window reloads, so nothing is read or
 * kept in storage and a window nobody asks of logs nothing. Each entry goes
 * to the console's debug level under one label (`[scroll]`), as an object
 * of numbers and the row keys a run already names its rows by, never a
 * row's words.
 *
 * A run logs each batch of rows resized in one pass (`noteResize`): every row
 * that changed, where it stood against the view's top (wholly above it,
 * across it, below it), whether it was its first measure, the direction the
 * reader was scrolling and whether they still were, and, once the pass's
 * own scroll correction has been written, how far the scroll moved. What the
 * rows wholly above the view grew by, less what the scroll moved, is how far
 * the reader's words moved on the screen (`shift`): zero where the
 * correction held them. A run logs too each change of its first or last
 * key (`noteEdges`), a page of older rows landing among them, with where the
 * scroll stood before and after the virtualizer anchored it, and a log logs
 * each ask for older rows with where its scroll stood (`noteScrollLog`).
 */

/** Where a resized row stood against the view's top as it was measured. */
export const SCROLL_LOG_PLACE = {
  ABOVE: "above",
  ACROSS: "across",
  BELOW: "below",
} as const;

export type ScrollLogPlace = (typeof SCROLL_LOG_PLACE)[keyof typeof SCROLL_LOG_PLACE];

/** One row's resize, as the run measured it. */
export interface ScrollLogResize {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly first: boolean;
  readonly place: ScrollLogPlace;
}

/** What a reader scrolling the run was doing as a row resized. */
export interface ScrollLogMotion {
  readonly direction: "forward" | "backward" | null;
  readonly scrolling: boolean;
}

/** The label every entry is logged under. */
const LABEL = "[scroll]";

/** The rows resized in the pass under way, by scroller, flushed once the pass's corrections are written. */
const passes = new WeakMap<
  HTMLElement,
  { readonly top: number; readonly motion: ScrollLogMotion; readonly rows: ScrollLogResize[] }
>();

/** Whether the console asked for the log. */
export function scrollLogging(): boolean {
  return (globalThis as { vespinScrollLog?: unknown }).vespinScrollLog === true;
}

/** Logs `what` with its numbers, where the console asked for the log. */
export function noteScrollLog(what: string, fields: Readonly<Record<string, unknown>>): void {
  if (!scrollLogging()) return;
  // biome-ignore lint/suspicious/noConsole: the log is the console's, asked for there.
  console.debug(LABEL, what, fields);
}

/**
 * Notes one row's resize in the pass under way over `scroller`, the pass
 * being logged once the virtualizer has written its correction for every row
 * of it: after the measuring callback, which writes the scroll synchronously,
 * returns.
 */
export function noteResize(
  scroller: HTMLElement,
  resize: ScrollLogResize,
  motion: ScrollLogMotion,
): void {
  if (!scrollLogging()) return;
  const open = passes.get(scroller);
  if (open !== undefined) {
    open.rows.push(resize);
    return;
  }
  passes.set(scroller, { top: scroller.scrollTop, motion, rows: [resize] });
  // Note that a microtask runs once the ResizeObserver's callback has measured every entry and written the scroll, so the move it reads is the pass's own.
  queueMicrotask(() => {
    const pass = passes.get(scroller);
    passes.delete(scroller);
    if (pass === undefined) return;
    const moved = scroller.scrollTop - pass.top;
    const grewAbove = pass.rows
      .filter((row) => row.place === SCROLL_LOG_PLACE.ABOVE)
      .reduce((sum, row) => sum + row.to - row.from, 0);
    noteScrollLog("resize", {
      shift: Math.round(grewAbove - moved),
      grewAbove: Math.round(grewAbove),
      moved: Math.round(moved),
      top: Math.round(pass.top),
      ...pass.motion,
      rows: pass.rows,
    });
  });
}
