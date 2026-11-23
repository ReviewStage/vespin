// pull-request-chip-model.test.ts -- an agent's pull request capsule says where it stands and, while open, how its checks went, in words as well as marks.

import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { describe, expect, it } from "vitest";
import { pullRequestChipLook } from "./pull-request-chip-model.js";

describe("an agent's pull request capsule", () => {
  it.each([
    {
      facts: { number: 128, state: PULL_REQUEST_STATE.OPEN, checks: CHECK_SUMMARY.FAILING },
      words: "#128",
      checks: true,
      heard: "Pull request #128, open, checks failing",
    },
    {
      facts: {
        number: 128,
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.PENDING,
        queued: true,
      },
      words: "#128 · Queued",
      checks: true,
      heard: "Pull request #128, queued, checks running",
    },
    {
      facts: { number: 128, state: PULL_REQUEST_STATE.MERGED, checks: CHECK_SUMMARY.PASSING },
      words: "#128 · Merged",
      checks: false,
      heard: "Pull request #128, merged",
    },
  ] as const)("reads $heard", ({ facts, words, checks, heard }) => {
    const look = pullRequestChipLook(facts);

    expect(look.words).toBe(words);
    expect(look.after !== undefined).toBe(checks);
    expect(look.heard).toBe(heard);
  });
});
