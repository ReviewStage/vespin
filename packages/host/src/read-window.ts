/**
 * read-window.ts -- what a screen's read of a window of rows answers: still reading, the rows it found, or refused.
 *
 * A screen reads the rows it shows through a live query over the store,
 * which answers once its rows have loaded. Until the read first answers,
 * the window stands as reading, never as an empty list, so a screen never
 * says it has nothing while what it shows is still loading. Once a read has
 * answered, its rows stand while a read of other rows (a scope switched, a
 * thread chosen) loads, marked not settled, so the list stays drawn rather
 * than dropping back to reading or empty. Only a settled read with no row
 * says a list is empty, or a row is missing.
 */

/** Where a window's read stands: still reading with nothing to show, its rows, or refused. */
export const WINDOW_READ = {
  READING: "reading",
  ROWS: "rows",
  FAILED: "failed",
} as const;

/**
 * A screen's window of rows: still reading, with nothing read yet; the rows,
 * `settled` once the read standing now answered them, and not while they are
 * the last read's rows held over a read still loading; or refused, where the
 * store the rows load from failed.
 */
export type ReadWindow<Row> =
  | { readonly status: typeof WINDOW_READ.READING }
  | {
      readonly status: typeof WINDOW_READ.ROWS;
      readonly rows: readonly Row[];
      readonly settled: boolean;
    }
  | { readonly status: typeof WINDOW_READ.FAILED };

/** What a live query says of its read now: whether it is asked at all, has answered, or failed, and its rows once it answered. */
export interface QueryRead<Row> {
  /** Whether the read is asked; a read nobody asks, as one waiting on an id, stands as reading. */
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly failed: boolean;
  readonly rows: readonly Row[] | undefined;
}

/** No rows, the same array each time, so a reader memoized on its rows holds still while nothing is read. */
const NO_ROWS: readonly never[] = [];

/** Still reading, with nothing read yet. */
const READING: ReadWindow<never> = { status: WINDOW_READ.READING };

/** Refused: the store the rows load from failed. */
const FAILED: ReadWindow<never> = { status: WINDOW_READ.FAILED };

/**
 * The window a live query's read stands as, given `last`, the rows the
 * screen's last settled read answered, or none where none has: the read's
 * own rows once it answered; `last`, not settled, while it is still loading
 * after an earlier read answered; reading before any has, and while nobody
 * asks it; refused where it failed.
 */
export function readWindow<Row>(
  read: QueryRead<Row>,
  last: readonly Row[] | undefined,
): ReadWindow<Row> {
  if (read.failed) return FAILED;

  // Note that a read nobody asks holds no rows over, since what it held was another's, as the last workspace's or the last number's.
  if (!read.enabled) return READING;

  if (read.ready && read.rows !== undefined) {
    return { status: WINDOW_READ.ROWS, rows: read.rows, settled: true };
  }

  return last === undefined ? READING : { status: WINDOW_READ.ROWS, rows: last, settled: false };
}

/** The rows a window draws now: its rows, settled or held over, or none while it reads or was refused. */
export function windowRows<Row>(window: ReadWindow<Row>): readonly Row[] {
  return window.status === WINDOW_READ.ROWS ? window.rows : NO_ROWS;
}
