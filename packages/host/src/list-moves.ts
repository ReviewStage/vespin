/**
 * list-moves.ts -- what moved between two drawings of one listed live query: each row that came, moved, or went, as it stood and as it stands, and whether the order moved, kept for a bounded run of drawings so a reader that skipped some still hears what moved without walking the list.
 *
 * A list a live query draws (`listedOf`, `drawn-rows.ts`) is built again
 * after each change the query hears, and the change names the rows it
 * moved. Each drawing is logged under its own number with the rows that
 * moved since the one before, and the drawing's array is tied to its place
 * in the log, so a reader holding two drawings, the app-state delivery's
 * last sent and next document or the Pull request tabs' last listing and
 * this one, is told what moved between them (`movesBetween`) rather than
 * diffing the two lists. Where it cannot be told, the drawings being of two
 * logs, or one older than the log keeps, or an array no log drew, it is
 * told nothing, and the reader walks the lists as it did before.
 *
 * Note that a list laid anew over the one held (`keepIdentity`) is another
 * array of the same rows, so whoever lays it ties it to the drawing it was
 * laid from (`drawnAs`).
 */

/** How many drawings of one list its log keeps the moves of. */
const LOGGED = 64;

/** One row of a list that moved: as it stood in the earlier drawing and as it stands in the later, none where it was not, or is no longer, listed. */
export interface ListMove<Value> {
  readonly was: Value | undefined;
  readonly now: Value | undefined;
}

/** What moved between two drawings of one list. */
export interface ListMoves<Value> {
  /** Each row that came, moved, or went, once. */
  readonly moves: readonly ListMove<Value>[];
  /** Whether a row came, went, or moved past another, so the order moved with the rows. */
  readonly reordered: boolean;
}

/** One drawing as its log keeps it: its number, the rows that moved since the drawing before, by key, and whether the order did. */
interface Logged {
  readonly at: number;
  readonly moved: ReadonlyMap<string | number, ListMove<unknown>>;
  readonly reordered: boolean;
}

/** One list's log: the newest drawing's number and the drawings kept, oldest first. */
interface Log {
  at: number;
  readonly kept: Logged[];
}

/** Where a drawing's array stands: its log, and its number in it. */
interface Drawing {
  readonly log: Log;
  readonly at: number;
}

/** Each drawing's array, and every array tied to one, by identity. */
const DRAWINGS = new WeakMap<readonly unknown[], Drawing>();

/** The log of one list's drawings, which its drawer writes. */
export interface ListMoveLog<Value> {
  /** Logs `list` as the next drawing: `moved` the rows that moved since the drawing before, by key, and `reordered` whether a row came, went, or moved past another. */
  readonly drawn: (
    list: readonly Value[],
    moved: ReadonlyMap<string | number, ListMove<Value>>,
    reordered: boolean,
  ) => void;
}

/** A new, empty log of one list's drawings. */
export function listMoveLog<Value>(): ListMoveLog<Value> {
  const log: Log = { at: 0, kept: [] };

  return {
    drawn: (list, moved, reordered) => {
      log.at += 1;
      log.kept.push({ at: log.at, moved, reordered });

      if (log.kept.length > LOGGED) log.kept.shift();
      DRAWINGS.set(list, { log, at: log.at });
    },
  };
}

/** Ties `list`, laid anew from the drawing `drawn`, to that drawing, so it is told what moved as `drawn` is; nothing where `drawn` is no drawing. */
export function drawnAs(
  list: readonly unknown[] | undefined,
  drawn: readonly unknown[] | undefined,
): void {
  if (list === undefined || drawn === undefined || list === drawn) return;
  const drawing = DRAWINGS.get(drawn);

  if (drawing !== undefined) DRAWINGS.set(list, drawing);
}

/**
 * What moved from the drawing `before` to the drawing `after` of one list,
 * each row once, as it stood in `before` and stands in `after`; none where
 * they are not two drawings of one log, `before` the earlier, that the log
 * still keeps every drawing between.
 */
export function movesBetween<Value>(
  before: readonly Value[],
  after: readonly Value[],
): ListMoves<Value> | undefined {
  const [from, to] = [DRAWINGS.get(before), DRAWINGS.get(after)];

  if (from === undefined || to === undefined || from.log !== to.log || from.at > to.at) {
    return undefined;
  }

  const kept = to.log.kept;
  const oldest = kept[0]?.at ?? to.log.at + 1;

  if (from.at < to.at && from.at + 1 < oldest) return undefined;
  const moved = new Map<string | number, ListMove<unknown>>();
  let reordered = false;

  for (const logged of kept) {
    if (logged.at <= from.at || logged.at > to.at) continue;
    reordered ||= logged.reordered;

    for (const [key, move] of logged.moved) {
      moved.set(key, { was: moved.get(key)?.was ?? move.was, now: move.now });
    }
  }

  // Note that a row that came and went between the two was in neither, and one drawn again as the very value it was did not move.
  const moves = [...moved.values()].filter((move) => move.was !== move.now);

  // SAFETY: a log is written by one list's drawer alone (`listMoveLog`), so every move in it is of that list's values.
  return { moves: moves as ListMove<Value>[], reordered };
}
