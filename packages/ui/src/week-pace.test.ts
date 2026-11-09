import assert from "node:assert/strict";
import { test } from "vitest";
import { WEEK_PACE, weekPace } from "./week-pace.js";

/**
 * A week that started Monday, Nov 9, 2026 at midnight UTC and resets the
 * Monday after. Each expected value is worked by hand: the pace runs from
 * an empty window at the start through the reading, so by the reset it has
 * used `used × 7 days ÷ days in`, and it reaches the whole week `days in ×
 * 100 ÷ used` days after the start.
 */
const STARTS = Date.UTC(2026, 10, 9);
const RESETS = Date.UTC(2026, 10, 16);
const at = (day: number, hour = 0): number => Date.UTC(2026, 10, day, hour);

test.each([
  {
    name: "half the week used two days in runs out four days in, Friday",
    used: 50,
    readAt: at(11),
    expected: { kind: WEEK_PACE.RUNS_OUT, runsOutAt: at(13) },
  },
  {
    name: "a week already spent five days in ran out at the reading",
    used: 100,
    readAt: at(14),
    expected: { kind: WEEK_PACE.RUNS_OUT, runsOutAt: at(14) },
  },
  {
    name: "a fifth used halfway leaves 60% of the week unused",
    used: 20,
    readAt: at(12, 12),
    expected: { kind: WEEK_PACE.UNUSED, projectedPercent: 40 },
  },
  {
    name: "40% used halfway leaves a fifth unused, which still says so",
    used: 40,
    readAt: at(12, 12),
    expected: { kind: WEEK_PACE.UNUSED, projectedPercent: 80 },
  },
  {
    name: "45% used halfway lands at 90%, on track",
    used: 45,
    readAt: at(12, 12),
    expected: { kind: WEEK_PACE.ON_TRACK, projectedPercent: 90 },
  },
])("$name", ({ used, readAt, expected }) => {
  assert.deepEqual(weekPace({ usedPercent: used, readAt, resetsAt: RESETS }), {
    startsAt: STARTS,
    readAt,
    usedPercent: used,
    resetsAt: RESETS,
    ...expected,
  });
});

test("a reading six hours into the week reads no pace yet", () => {
  assert.equal(weekPace({ usedPercent: 10, readAt: at(9, 6), resetsAt: RESETS }), undefined);
});
