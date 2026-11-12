/**
 * claude-goals.test.ts -- which of Claude Code's transcript entries the store's appends hold as a settled goal, and that every entry still reaches the store.
 */

import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { GOAL_EVENT } from "@repo/wire/ui-messages";
import { MutableRef } from "effect";
import { describe, expect, it } from "vitest";
import { goalWatchedStore } from "./claude-goals.js";
import { RUNNER_EVENT, type RunnerGoal } from "./protocol.js";

const CONDITION = "every billing test passes";

/** A `goal_status` attachment as Claude Code 2.1.322 wrote it to its transcript. */
function goalStatus(attachment: {
  readonly met?: boolean;
  readonly failed?: boolean;
  readonly sentinel?: boolean;
  readonly reason?: string;
  readonly iterations?: number;
  readonly durationMs?: number;
  readonly tokens?: number;
}) {
  return {
    type: "attachment",
    uuid: "entry",
    attachment: { type: "goal_status", condition: CONDITION, ...attachment },
  };
}

describe("goalWatchedStore", () => {
  it("holds the settling of a goal, met or impossible, and passes every entry to the store", async () => {
    const appended: unknown[] = [];
    const held = MutableRef.make<readonly RunnerGoal[]>([]);

    const store = goalWatchedStore(
      { append: async (_key, entries) => void appended.push(...entries) },
      held,
    );

    const met = goalStatus({
      met: true,
      reason: "All pass.",
      iterations: 2,
      durationMs: 7221,
      tokens: 988,
    });

    const entries = [
      goalStatus({ met: false, sentinel: true }),
      goalStatus({ met: false, reason: "2 tests still fail." }),
      met,
      goalStatus({ met: false, failed: true, reason: "The suite was deleted." }),
      { type: "user", uuid: "line", message: { role: "user", content: "go" } },
    ];

    await store.append({ projectKey: "p", sessionId: "s" }, entries);
    // A subagent's transcript holds no goal of the session's.
    await store.append({ projectKey: "p", sessionId: "s", subpath: "agent-1" }, [met]);

    expect(MutableRef.get(held)).toEqual([
      {
        type: RUNNER_EVENT.GOAL,
        event: GOAL_EVENT.MET,
        condition: CONDITION,
        reason: "All pass.",
        turns: 2,
        tokens: 988,
        tokenBudget: null,
      },
      {
        type: RUNNER_EVENT.GOAL,
        event: GOAL_EVENT.IMPOSSIBLE,
        condition: CONDITION,
        reason: "The suite was deleted.",
        turns: null,
        tokens: null,
        tokenBudget: null,
      },
    ]);
    expect(appended).toEqual([...entries, met]);
  });

  it("holds nothing of a batch the store refused, which the SDK sends again", async () => {
    const held = MutableRef.make<readonly RunnerGoal[]>([]);

    const store = goalWatchedStore<Pick<SessionStore, "append">>(
      {
        append: async () => {
          throw new Error("The transcript store answered 503");
        },
      },
      held,
    );

    const met = goalStatus({ met: true, reason: "All pass." });
    await expect(store.append({ projectKey: "p", sessionId: "s" }, [met])).rejects.toThrow();
    expect(MutableRef.get(held)).toEqual([]);
  });
});
