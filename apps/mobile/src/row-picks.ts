// row-picks.ts -- when the latest taps on a list's row reached JavaScript to open it, which `open:drawn` counts beside the touches that led to an open; never which row.

/** How many of the latest picks are kept, enough for a burst of taps on one row and no more. */
const KEPT_PICKS = 16;

/** When each of the latest picks reached JavaScript, on the performance clock, oldest first. */
const pickedAt: number[] = [];

/** Keeps the moment a row's pick reached JavaScript, as `RowPickContext` is told of it. */
export function notePick(): void {
  pickedAt.push(performance.now());

  if (pickedAt.length > KEPT_PICKS) pickedAt.splice(0, pickedAt.length - KEPT_PICKS);
}

/** When each pick kept reached JavaScript after `from` and by `to`, oldest first. */
export function picksBetween(from: number, to: number): readonly number[] {
  return pickedAt.filter((at) => at > from && at <= to);
}
