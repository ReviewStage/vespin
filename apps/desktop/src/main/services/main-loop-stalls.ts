/**
 * main-loop-stalls.ts -- main's own event loop as a timer ticking in it hears it: the one record of its stalls this process keeps, begun at the entry, which main's requests and the host's transcript reads are measured against.
 */

import { LOOP_TICK_MS, LoopStalls } from "@repo/host";
import type { LoopStallsSeam } from "@repo/host/effect";

/** Main's stalls once the entry began hearing them. */
let heard: LoopStalls | undefined;

/** Begins hearing main's ticks, once; the timer holds no quit. */
export function startMainLoopStalls(): void {
  if (heard !== undefined) return;
  const stalls = new LoopStalls(Date.now());
  heard = stalls;
  setInterval(() => stalls.heard(Date.now()), LOOP_TICK_MS).unref();
}

/** Main's stalls as the host and main's Sentry read them, on main's own clock; none before the entry began hearing them. */
export const mainLoopStalls: LoopStallsSeam = {
  worstWithin: (from, to) => heard?.worstWithin(from, to, Date.now()) ?? 0,
};
