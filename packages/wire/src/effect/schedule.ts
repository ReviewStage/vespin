/**
 * schedule.ts -- the backoff every retry and reconnect loop shares: doubling from a first wait, never past a longest.
 */

import { Duration, Effect, Schedule } from "effect";

/**
 * Waits of `first`, then twice as long each time, held at `longest` once
 * they reach it. A caller adds what its loop needs beside it, such as a
 * bound (`Schedule.upTo`).
 */
export function cappedExponential(first: Duration.Duration, longest: Duration.Duration) {
  return Schedule.exponential(first).pipe(
    Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, longest))),
  );
}
