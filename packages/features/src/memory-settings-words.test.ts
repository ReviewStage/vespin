import assert from "node:assert/strict";
import { test } from "vitest";
import { MEMORY_VIEW, type MemoryView, memoriesInView } from "./memory-settings-words.js";
import type { MemorySummary } from "./memory-wire.js";

/**
 * The views Settings › Memory lists the workspace's memories in: New holds
 * what was kept in the last week, and Unused what no agent recalled in the
 * recall window though it was kept before the window opened, the longest out
 * of use first, so a memory too young to have been reached is never offered
 * to prune. Synthetic memories over a fixed day.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13, 12);

function memory(
  id: string,
  keptDaysAgo: number,
  recalls30d: number,
  lastRecalledDaysAgo: number | null,
): MemorySummary {
  return {
    id,
    text: id,
    keptBy: null,
    forgettable: true,
    createdAt: NOW - keptDaysAgo * DAY,
    updatedAt: NOW - keptDaysAgo * DAY,
    source: null,
    recalls30d,
    lastRecalledAt: lastRecalledDaysAgo === null ? null : NOW - lastRecalledDaysAgo * DAY,
  };
}

test("New holds the last week's memories, newest first, and Unused the old ones no agent recalled in 30 days, longest unused first", () => {
  const memories = [
    memory("kept today, never recalled", 0.5, 0, null),
    memory("kept 3 days ago, recalled", 3, 4, 1),
    memory("kept 10 days ago, never recalled", 10, 0, null),
    memory("kept 40 days ago, never recalled", 40, 0, null),
    memory("kept 90 days ago, last recalled 50 days ago", 90, 0, 50),
    memory("kept 60 days ago, recalled", 60, 12, 2),
  ];

  const ids = (view: MemoryView) => memoriesInView(memories, view, NOW).map((each) => each.id);

  assert.deepEqual(ids(MEMORY_VIEW.NEW), [
    "kept today, never recalled",
    "kept 3 days ago, recalled",
  ]);

  assert.deepEqual(ids(MEMORY_VIEW.UNUSED), [
    "kept 90 days ago, last recalled 50 days ago",
    "kept 40 days ago, never recalled",
  ]);
});
