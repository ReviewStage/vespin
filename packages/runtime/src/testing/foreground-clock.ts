/**
 * foreground-clock.ts -- a foreground clock that runs on the test's own clock, which a test sends away and brings back.
 */

import { Effect } from "effect";
import { foregroundClockOver, type StoppingForegroundClock } from "../effect/foreground-clock.js";

/** A foreground clock over the running test's `TestClock`, in the front, so `TestClock.adjust` moves it while it runs and not while it is away. */
export const testForegroundClock: Effect.Effect<StoppingForegroundClock> = Effect.clockWith(
  (clock) =>
    Effect.sync(() =>
      foregroundClockOver(() => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000, true),
    ),
);
