// minute-clock.ts -- the minute a row's times are said from, one clock every reader shares, so a row drawn once still moves its "5m" and Remind me's times as the minute turns.

import { useSyncExternalStore } from "react";

/** A minute, in milliseconds. */
const MINUTE_MS = 60_000;

/** Whoever reads the minute now. */
const readers = new Set<() => void>();

/** The wait to the next minute's turn, while anyone reads it. */
let turn: ReturnType<typeof setTimeout> | undefined;

/** The start of the minute it is now. */
function minuteNow(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

/** Tells every reader the minute turned, and waits for the next turn. Note that it waits to the turn itself rather than a whole minute, so a late wake never drifts the next. */
function tick(): void {
  for (const reader of readers) reader();
  turn = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
}

/** Adds a reader, starting the clock for the first and stopping it after the last. */
function subscribe(reader: () => void): () => void {
  readers.add(reader);

  if (turn === undefined) turn = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));

  return () => {
    readers.delete(reader);

    if (readers.size > 0 || turn === undefined) return;
    clearTimeout(turn);
    turn = undefined;
  };
}

/** The start of the current minute, drawn again as each minute turns. */
export function useMinute(): number {
  return useSyncExternalStore(subscribe, minuteNow);
}
