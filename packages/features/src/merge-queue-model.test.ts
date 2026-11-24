/**
 * merge-queue-model.test.ts -- how a queued pull request's merge group checks are counted and said, which the desktop's page and the iOS screen both draw. Synthetic pull requests throughout.
 */

import { describe, expect, it } from "vitest";
import { CHECK_SUMMARY } from "./agent-wire.js";
import { mergeQueueChecksStanding, mergeQueueHeard } from "./merge-queue-model.js";
import {
  MERGE_QUEUE_ENTRY_STATE,
  type MergeQueueChecks,
  type MergeQueueEntry,
  type MergeQueueEntryState,
} from "./merge-queue-wire.js";

/** acme/relay#41 at the queue's front, in `state`, its merge group's checks as given. */
function entry(state: MergeQueueEntryState, checks: MergeQueueChecks | null): MergeQueueEntry {
  return {
    position: 1,
    state,
    enqueuedAt: 1_000,
    checks,
    pullRequest: {
      number: 41,
      title: "Expire invitations",
      url: "https://github.com/acme/relay/pull/41",
      author: null,
    },
    task: null,
  };
}

describe("a queued pull request's checks", () => {
  it.each([
    {
      case: "a group not yet built counts nothing and shows no glyph while it waits",
      entry: entry(MERGE_QUEUE_ENTRY_STATE.QUEUED, null),
      standing: { summary: CHECK_SUMMARY.NONE, count: undefined },
      heard: ["#41", "Waiting", "ghost"],
    },
    {
      case: "a group being checked before GitHub counts shows the running ring alone",
      entry: entry(MERGE_QUEUE_ENTRY_STATE.AWAITING_CHECKS, null),
      standing: { summary: CHECK_SUMMARY.PENDING, count: undefined },
      heard: ["#41", "Checking", "ghost"],
    },
    {
      case: "a failure counts the failed, naming the first and how many more",
      entry: entry(MERGE_QUEUE_ENTRY_STATE.UNMERGEABLE, {
        total: 9,
        passed: 5,
        failedCount: 3,
        failed: ["lint"],
      }),
      standing: { summary: CHECK_SUMMARY.FAILING, count: 3 },
      heard: ["#41", "Failing", "lint failed +2", "ghost"],
    },
    {
      case: "a failure GitHub names none of is counted in words",
      entry: entry(MERGE_QUEUE_ENTRY_STATE.UNMERGEABLE, {
        total: 4,
        passed: 3,
        failedCount: 1,
        failed: [],
      }),
      standing: { summary: CHECK_SUMMARY.FAILING, count: 1 },
      heard: ["#41", "Failing", "1 check failed", "ghost"],
    },
    {
      case: "checks still running count those left",
      entry: entry(MERGE_QUEUE_ENTRY_STATE.AWAITING_CHECKS, {
        total: 9,
        passed: 7,
        failedCount: 0,
        failed: [],
      }),
      standing: { summary: CHECK_SUMMARY.PENDING, count: 2 },
      heard: ["#41", "Checking", "7 of 9 checks passed", "ghost"],
    },
    {
      case: "every check passed counts them all",
      entry: entry(MERGE_QUEUE_ENTRY_STATE.MERGEABLE, {
        total: 9,
        passed: 9,
        failedCount: 0,
        failed: [],
      }),
      standing: { summary: CHECK_SUMMARY.PASSING, count: 9 },
      heard: ["#41", "Merging", "9 of 9 checks passed", "ghost"],
    },
  ])("$case", ({ entry: queued, standing, heard }) => {
    expect(mergeQueueChecksStanding(queued)).toEqual(standing);
    expect(mergeQueueHeard(queued, "ghost")).toEqual(heard);
  });
});
