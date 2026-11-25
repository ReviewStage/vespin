import assert from "node:assert/strict";
import { it } from "vitest";
import { LOOP_TICK_MS, LoopStalls } from "./loop-stalls.js";

/** Ticks at 0, 100, 200, then one held 600 ms past due (at 900, due at 300), then 1000 on time. */
function heardWithOneStall(): LoopStalls {
  const stalls = new LoopStalls(0);

  for (const at of [LOOP_TICK_MS, 2 * LOOP_TICK_MS, 900, 1_000]) stalls.heard(at);

  return stalls;
}

it.each([
  // A span holding the whole stall hears all of it: from 300, when the tick was due, to 900.
  { span: [250, 950], now: 1_000, worst: 600 },
  // A span that began while the loop stood still hears only its own share.
  { span: [700, 950], now: 1_000, worst: 200 },
  // A span apart from the stall hears none.
  { span: [920, 990], now: 1_000, worst: 0 },
])("a span from $span.0 to $span.1 hears a stall of $worst ms", ({ span, now, worst }) => {
  const [from = 0, to = 0] = span;

  assert.equal(heardWithOneStall().worstWithin(from, to, now), worst);
});

it("a span that ends in the callback a stall held hears that stall before the next tick runs", () => {
  const stalls = heardWithOneStall();

  // The tick due at 1100 has not run by 1500: the loop stood still from 1100, and the span ends now.
  assert.equal(stalls.worstWithin(1_050, 1_500, 1_500), 400);
});
