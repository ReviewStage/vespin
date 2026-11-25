/**
 * main-loop-stalls.ts -- main's own event loop as a timer ticking in it hears it: the one record of its stalls this process keeps, begun at the entry, which main's requests and the host's transcript reads are measured against.
 */

import { LOOP_TICK_MS, LoopStalls } from "@repo/host";
import type { LoopStallsSeam } from "@repo/host/effect";

/** Main's stalls once the entry began hearing them. */
let heard: LoopStalls | undefined;

/**
 * How many times main has ticked, in memory a worker thread may wait on:
 * each tick adds one and wakes whoever waits, so the stall watch
 * (`src/utility/stall-watch.ts`) hears main stop without a timer of its own.
 */
export const mainTicks = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

/** One tick of main's loop: told to the record, and counted where the stall watch waits on it. */
export function mainLoopTick(): void {
  heard?.heard(Date.now());
  Atomics.add(mainTicks, 0, 1);
  Atomics.notify(mainTicks, 0);
}

/** Begins hearing main's ticks, once; the timer holds no quit. */
export function startMainLoopStalls(): void {
  if (heard !== undefined) return;
  heard = new LoopStalls(Date.now());
  setInterval(mainLoopTick, LOOP_TICK_MS).unref();
}

/** Main's stalls as the host and main's Sentry read them, on main's own clock; none before the entry began hearing them. */
export const mainLoopStalls: LoopStallsSeam = {
  worstWithin: (from, to) => heard?.worstWithin(from, to, Date.now()) ?? 0,
};
