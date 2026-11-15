// latest-writes-model.ts -- the book of writes a screen sends at once, each on a row of its own: how many each row has sent, the value each row's newest write carries until it is answered, and each row's newest refusal.

/**
 * What a screen's writes stand at: how many each row has sent, so an answer to
 * an earlier write is told apart from the row's newest; the value the row's
 * newest write carries, until it is answered; and why each row's newest write
 * was refused, until that row's next write.
 */
export interface WritesBook<Refusal, Value> {
  readonly sent: ReadonlyMap<string, number>;
  readonly pending: ReadonlyMap<string, Value>;
  readonly refusals: ReadonlyMap<string, Refusal>;
}

/** A write sent: the book once it is, and the write's number among its row's. */
export interface WriteSent<Refusal, Value> {
  readonly book: WritesBook<Refusal, Value>;
  readonly write: number;
}

/** No write sent yet. */
export const NO_WRITES: WritesBook<never, never> = {
  sent: new Map<string, number>(),
  pending: new Map<string, never>(),
  refusals: new Map<string, never>(),
};

/** `held` with nothing for `row`, the same map where it had nothing. */
function withoutRow<Held>(held: ReadonlyMap<string, Held>, row: string): ReadonlyMap<string, Held> {
  if (!held.has(row)) return held;
  const kept = new Map(held);
  kept.delete(row);

  return kept;
}

/**
 * The book once `row` sends a write carrying `value`, and that write's number
 * among the row's: the row's last refusal goes, as a press lets the last
 * refusal go, and `value` stands as the row's until the write is answered.
 */
export function writeSent<Refusal, Value>(
  book: WritesBook<Refusal, Value>,
  row: string,
  value: Value,
): WriteSent<Refusal, Value> {
  const write = (book.sent.get(row) ?? 0) + 1;

  return {
    book: {
      sent: new Map(book.sent).set(row, write),
      pending: new Map(book.pending).set(row, value),
      refusals: withoutRow(book.refusals, row),
    },
    write,
  };
}

/**
 * What a new pick on `row` is compared with: the value its newest write
 * carries while that write is out, else the value drawn. Note that a pick
 * compared with the value drawn alone was dropped where it went back to that
 * value before the row's newest write was drawn (B, then A again), and the
 * write still out stood with no refusal.
 */
export function newestValue<Value>(
  book: WritesBook<unknown, Value>,
  row: string,
  drawn: Value,
): Value {
  const value = book.pending.get(row);

  return value === undefined ? drawn : value;
}

/**
 * Whether a write's answer takes its row back to what is stored: refused,
 * and still the row's newest write. Note that a refused write a later one on
 * the same row has passed takes nothing back, because the later write's pick
 * is what the row now shows and its own answer decides it.
 */
export function takesRowBack<Refusal, Value>(
  book: WritesBook<Refusal, Value>,
  row: string,
  write: number,
  said: Refusal | undefined,
): boolean {
  return said !== undefined && write === book.sent.get(row);
}

/**
 * The book once a row's write is answered, refused with `said` or gone with
 * none. Note that only the row's newest write says its refusal and gives up
 * its value, so writes to one row follow each other, while another row's
 * refusal is its own and stays.
 */
export function writeSettled<Refusal, Value>(
  book: WritesBook<Refusal, Value>,
  row: string,
  write: number,
  said: Refusal | undefined,
): WritesBook<Refusal, Value> {
  if (write !== book.sent.get(row)) return book;

  return {
    sent: book.sent,
    pending: withoutRow(book.pending, row),
    refusals: said === undefined ? book.refusals : new Map(book.refusals).set(row, said),
  };
}
