// pull-request-model.test.ts -- GitHub's sentence of whether a pull request merges, beside a chip that names its queue place.

import { describe, expect, it } from "vitest";
import {
  type AgentOverviewPullRequest,
  CHECK_SUMMARY,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "./agent-wire.js";
import { MERGE_ACTION, mergeSentence } from "./pull-request-model.js";
import { MERGE_METHOD } from "./pull-request-write-wire.js";

/** A queued pull request whose auto-merge is on, by squash, ready to merge. */
const QUEUED: AgentOverviewPullRequest = {
  number: 7,
  title: "Expire invitations",
  url: "https://github.com/acme/app/pull/7",
  state: PULL_REQUEST_STATE.OPEN,
  html: "",
  base: "main",
  head: "expiry-job",
  createdAt: 1_000,
  mergedAt: null,
  merge: MERGE_STATE.CLEAN,
  requested: [],
  merging: {
    methods: [MERGE_METHOD.SQUASH],
    autoMergeAllowed: true,
    queue: true,
    queued: { position: 2 },
    autoMerge: { method: MERGE_METHOD.SQUASH },
    headSha: "c0ffee1",
    review: null,
    checks: CHECK_SUMMARY.PASSING,
  },
};

describe("mergeSentence", () => {
  it("still says auto-merge is on where a chip already names the queue's place", () => {
    expect(mergeSentence(QUEUED, MERGE_ACTION.DEQUEUE, { queueShown: true })).toBe(
      "Auto-merge is on (squash). Ready to merge",
    );
  });

  it("says a draft is a draft even where GitHub's merge state was read before it became one", () => {
    const { merging: _merging, ...read } = QUEUED;
    const drafted: AgentOverviewPullRequest = { ...read, state: PULL_REQUEST_STATE.DRAFT };

    expect(mergeSentence(drafted, undefined)).toBe("A draft; mark it ready for review to merge");
  });
});
