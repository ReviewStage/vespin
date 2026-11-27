import assert from "node:assert/strict";
import { afterEach, beforeEach, it, vi } from "vitest";
import { atForeground, foregroundAfter, foregroundClockOver } from "./foreground-clock.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("a deadline on the foreground clock passes only once that much time stood in front, never counting the minutes the app was away", () => {
  const clock = foregroundClockOver(() => Date.now(), true);
  let fired = false;
  atForeground(clock, foregroundAfter(clock.now(), 10_000), () => {
    fired = true;
  });

  vi.advanceTimersByTime(4_000);
  clock.away();
  vi.advanceTimersByTime(300_000);
  clock.back();
  vi.advanceTimersByTime(5_900);
  assert.equal(fired, false, "fired with 9.9 s in front");

  vi.advanceTimersByTime(200);
  assert.equal(fired, true);
});
