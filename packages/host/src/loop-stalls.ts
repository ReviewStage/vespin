/**
 * loop-stalls.ts -- how late a process's event loop ran, as a timer ticking in it hears: its stalls of the last few minutes, and the longest of them within a stretch of time.
 *
 * A process that runs one long task holds every callback queued behind it,
 * an answer the network already delivered among them, so a request it timed
 * is as long as the service's work and the stall together. The platform ticks
 * a timer every `LOOP_TICK_MS` and tells each tick here (`heard`); a tick
 * that came `STALL_HEARD_MS` or more after it was due says the loop stood
 * still from when it was due until it ran. Note that a stall is placed from
 * its tick's due time, so one that began between two ticks is heard up to a
 * tick short; the stalls worth seeing run to hundreds of milliseconds.
 *
 * Nothing here reads a clock: the platform hands every time, in the epoch's
 * milliseconds, so a span timed on the same clock can be measured against
 * the stalls within it (`worstWithin`). A stall still under way as it is
 * asked, its tick not yet run, counts as standing until `now`, which is how a
 * span that ends in the very callback a stall held up hears that stall.
 */

/** How often the platform's timer ticks, in milliseconds. */
export const LOOP_TICK_MS = 100;

/** How late a tick must run to be a stall, in milliseconds: a timer's own jitter is a few. */
const STALL_HEARD_MS = 50;

/** How long a stall is kept, in milliseconds: longer than any span measured against it lasts but a held poll's few. */
const STALL_KEPT_MS = 5 * 60 * 1_000;

/** One stall: from when the tick was due to when it ran, in the epoch's milliseconds. */
interface Stall {
  readonly from: number;
  readonly to: number;
}

/** The longest a stall stood within `from` to `to`, in milliseconds; none where it stood apart from them. */
function overlapOf(stall: Stall, from: number, to: number): number {
  return Math.max(0, Math.min(stall.to, to) - Math.max(stall.from, from));
}

/** One process's stalls, told each tick of its timer. */
export class LoopStalls {
  /** When the last tick ran. */
  #ticked: number;
  /** The stalls heard, oldest first, those older than `STALL_KEPT_MS` let go. */
  #stalls: Stall[] = [];

  constructor(startedAt: number) {
    this.#ticked = startedAt;
  }

  /** A tick of the platform's timer, run at `at`. */
  heard(at: number): void {
    const due = this.#ticked + LOOP_TICK_MS;
    this.#ticked = at;

    if (at - due < STALL_HEARD_MS) return;
    this.#stalls.push({ from: due, to: at });
    const keptFrom = at - STALL_KEPT_MS;
    const first = this.#stalls.findIndex((stall) => stall.to >= keptFrom);

    this.#stalls = first <= 0 ? this.#stalls : this.#stalls.slice(first);
  }

  /** The longest the loop stood still within `from` to `to`, in whole milliseconds, a stall whose tick has not run by `now` among them; 0 where none did. */
  worstWithin(from: number, to: number, now: number): number {
    const due = this.#ticked + LOOP_TICK_MS;
    const standing = now - due >= STALL_HEARD_MS ? [{ from: due, to: now }] : [];

    const worst = [...this.#stalls, ...standing].reduce(
      (longest, stall) => Math.max(longest, overlapOf(stall, from, to)),
      0,
    );

    return Math.round(worst);
  }
}
