/**
 * claude-goals.test.ts -- which of Claude Code's transcript entries the store's appends hold as a settled goal, and that every entry still reaches the store.
 */

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { GOAL_EVENT } from "@repo/wire/ui-messages";
import { MutableRef } from "effect";
import { describe, expect, it } from "vitest";
import { goalWatchedFile, goalWatchedStore } from "./claude-goals.js";
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

describe("goalWatchedFile", () => {
  it("holds the goals the CLI's own transcript settles once the session starts, never one an earlier launch settled, and leaves a line not yet ended for the next read", async () => {
    const folder = mkdtempSync(join(tmpdir(), "claude-goals-"));
    const path = join(folder, "session.jsonl");

    const line = (
      entry: ReturnType<typeof goalStatus> | { readonly type: string; readonly uuid: string },
    ) => `${JSON.stringify(entry)}\n`;

    const held = MutableRef.make<readonly RunnerGoal[]>([]);

    try {
      // A goal met in an earlier launch of the session.
      writeFileSync(path, line(goalStatus({ met: true, reason: "Met before." })));
      const watched = goalWatchedFile(held);
      const [start] = watched.hooks.SessionStart?.[0]?.hooks ?? [];
      await start?.(
        {
          hook_event_name: "SessionStart",
          session_id: "s",
          transcript_path: path,
          cwd: folder,
          source: "resume",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const met = goalStatus({ met: true, reason: "All pass.", iterations: 2 });
      appendFileSync(path, line({ type: "user", uuid: "u" }) + line(met));
      appendFileSync(path, JSON.stringify(goalStatus({ failed: true })));
      await watched.settle();

      expect(MutableRef.get(held)).toEqual([
        {
          type: RUNNER_EVENT.GOAL,
          event: GOAL_EVENT.MET,
          condition: CONDITION,
          reason: "All pass.",
          turns: 2,
          tokens: null,
          tokenBudget: null,
        },
      ]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
