/**
 * out-of-memory.test.ts -- which of Claude Code's Bash calls are told as killed out of memory: the line its answer carries for the transcript, and the words the model reads beside it.
 */

import type { HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { claudeCodeMemoryWatch } from "./out-of-memory.js";

const GB = 1024 ** 3;
const CALL = "toolu_oom";

/** Claude Code's Bash answer for a command killed by SIGKILL, as its 2.1.304 CLI wrote it. */
const KILLED_ANSWER =
  "Exit code 137\n/bin/bash: line 1:  3533 Killed                     pnpm typecheck";

const BASE = {
  session_id: "session",
  transcript_path: "/tmp/session.jsonl",
  cwd: "/vercel/sandbox",
};
const SIGNAL = { signal: new AbortController().signal };

/** One Bash call run under the watch, the kernel's count reading each of `kills` in turn: what the model was told, and the answer as posted. */
async function runCall(
  answer: string,
  kills: readonly (number | undefined)[],
  memoryBytes: number | undefined,
) {
  const counts = [...kills];
  const watch = claudeCodeMemoryWatch({
    kills: async () => counts.shift(),
    memoryBytes: async () => memoryBytes,
  });
  const call = { tool_name: "Bash", tool_input: { command: "pnpm typecheck" }, tool_use_id: CALL };
  const began: HookInput = { ...BASE, ...call, hook_event_name: "PreToolUse" };
  const ended: HookInput = {
    ...BASE,
    ...call,
    hook_event_name: "PostToolUseFailure",
    error: answer,
  };
  await watch.hooks.PreToolUse[0]?.hooks[0]?.(began, CALL, SIGNAL);
  const told = await watch.hooks.PostToolUseFailure[0]?.hooks[0]?.(ended, CALL, SIGNAL);
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: CALL, content: answer, is_error: true }],
    },
    parent_tool_use_id: null,
    session_id: "session",
  } satisfies SDKMessage;
  const posted = watch.annotate(message);
  const content = posted.type === "user" ? posted.message.content : undefined;
  const block = Array.isArray(content) ? content[0] : undefined;
  return {
    context:
      told !== undefined && "hookSpecificOutput" in told ? told.hookSpecificOutput : undefined,
    shown: block?.type === "tool_result" ? block.content : undefined,
  };
}

describe("claudeCodeMemoryWatch", () => {
  it.each([
    {
      run: "killed while the kernel's count rose",
      answer: KILLED_ANSWER,
      kills: [0, 1],
      memoryBytes: 4 * GB,
      line: "Killed: the sandbox ran out of memory (4 GB)",
    },
    {
      run: "killed out of memory where the size cannot be read",
      answer: KILLED_ANSWER,
      kills: [3, 4],
      memoryBytes: undefined,
      line: "Killed: the sandbox ran out of memory",
    },
    {
      run: "killed by a plain SIGKILL, the count unchanged",
      answer: KILLED_ANSWER,
      kills: [2, 2],
      memoryBytes: 4 * GB,
      line: undefined,
    },
    {
      run: "failing otherwise while the count rose for another process",
      answer: "Exit code 1\nerror TS2322",
      kills: [0, 1],
      memoryBytes: 4 * GB,
      line: undefined,
    },
    {
      run: "killed on a machine that keeps no count",
      answer: KILLED_ANSWER,
      kills: [undefined, undefined],
      memoryBytes: undefined,
      line: undefined,
    },
  ])("a command $run", async ({ answer, kills, memoryBytes, line }) => {
    const { context, shown } = await runCall(answer, kills, memoryBytes);
    if (line === undefined) {
      expect(context).toBeUndefined();
      expect(shown).toBe(answer);
      return;
    }
    expect(shown).toBe(`${answer}\n${line}`);
    expect(context).toMatchObject({
      hookEventName: "PostToolUseFailure",
      additionalContext: expect.stringMatching(
        new RegExp(`^${line.replace(/[()]/g, "\\$&")}\\. .*less parallelism`),
      ),
    });
  });
});
