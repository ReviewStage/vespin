// latest-writes-model.ts -- the book of writes a screen sends at once, each on a row of its own: how many each row has sent, and each row's newest refusal.

/**
 * What a screen's writes stand at: how many each row has sent, so an answer to
 * an earlier write is told apart from the row's newest, and why each row's
 * newest write was refused, until that row's next write.
 */
export interface WritesBook<Refusal> {
  readonly sent: ReadonlyMap<string, number>;
  readonly refusals: ReadonlyMap<string, Refusal>;
}

/** A write sent: the book once it is, and the write's number among its row's. */
export interface WriteSent<Refusal> {
  readonly book: WritesBook<Refusal>;
  readonly write: number;
}

/** No write sent yet. */
export const NO_WRITES: WritesBook<never> = {
  sent: new Map<string, number>(),
  refusals: new Map<string, never>(),
};

/** `refusals` with none for `row`, the same map where it had none. */
function withoutRow<Refusal>(
  refusals: ReadonlyMap<string, Refusal>,
  row: string,
): ReadonlyMap<string, Refusal> {
  if (!refusals.has(row)) return refusals;
  const kept = new Map(refusals);
  kept.delete(row);

  return kept;
}

/**
 * The book once `row` sends a write, and that write's number among the row's:
 * the row's last refusal goes, as a press lets the last refusal go.
 */
export function writeSent<Refusal>(book: WritesBook<Refusal>, row: string): WriteSent<Refusal> {
  const write = (book.sent.get(row) ?? 0) + 1;

  return {
    book: { sent: new Map(book.sent).set(row, write), refusals: withoutRow(book.refusals, row) },
    write,
  };
}

/**
 * The book once a row's write is answered, refused with `said` or gone with
 * none. Note that only the row's newest write says its refusal, so writes to
 * one row follow each other, while another row's refusal is its own and stays.
 */
export function writeSettled<Refusal>(
  book: WritesBook<Refusal>,
  row: string,
  write: number,
  said: Refusal | undefined,
): WritesBook<Refusal> {
  if (said === undefined || write !== book.sent.get(row)) return book;

  return { sent: book.sent, refusals: new Map(book.refusals).set(row, said) };
}
