import assert from "node:assert/strict";
import { RUNNER_END, RUNNER_EVENT } from "@repo/agent-runner/protocol";
import { RUN_EVENT, type RunEvent } from "@repo/features/turn-run";
import type { WireValue } from "@repo/wire";
import { test } from "vitest";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { cursorMoments } from "./cursor-moments.js";
import { NATIVE_MOMENT, type NativeHeld } from "./native-moments.js";
import {
  heldProjection,
  NATIVE_WRITE,
  type NativeProjection,
  projectMoments,
} from "./native-projection.js";

const AGENT = "cursor-0000019a8c3e2f10-7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const IDS = { agent_id: AGENT, run_id: "run-1" } as const;
const README = "/vercel/sandbox/repository/README.md";

/**
 * One run as Cursor's SDK streamed it in the spike, shortened and written by
 * hand: thinking and words a token a message, a read said running twice
 * before it completes, an edit whose change is in its answer's diff, a call
 * to our own tool through the custom tools' server, a shell command a review
 * refused and that never completes, the run's usage, and the launch's end.
 */
const RECORDED: readonly WireValue[] = [
  { type: RUNNER_EVENT.ACCEPTED, uuid: "10000000-0000-4000-8000-000000000001" },
  { type: "status", ...IDS, status: "RUNNING" },
  { type: "thinking", ...IDS, text: "The" },
  { type: "thinking", ...IDS, text: " file" },
  { type: "thinking", ...IDS, text: "", thinking_duration_ms: 120 },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-read",
    name: "read",
    status: "running",
    args: { path: README },
  },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-read",
    name: "read",
    status: "running",
    args: { path: README },
  },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-read",
    name: "read",
    status: "completed",
    args: { path: README },
    result: { status: "success", value: { content: "# scratch\n", totalLines: 2, fileSize: 10 } },
  },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-edit",
    name: "edit",
    status: "completed",
    args: { path: README },
    result: {
      status: "success",
      value: {
        linesAdded: 1,
        linesRemoved: 1,
        diffString: `--- a/${README}\n+++ b/${README}\n@@ -1,2 +1,2 @@\n # scratch\n-TODO: nothing\n+TODO: spike`,
      },
    },
  },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-thread",
    name: "mcp",
    status: "completed",
    args: {
      providerIdentifier: "custom-user-tools",
      toolName: "mcp__team__inbox_post",
      args: { key: "readme", body: "Done." },
    },
    result: {
      status: "success",
      value: { content: [{ text: { text: '{"status":"posted"}' } }], isError: false },
    },
  },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-push",
    name: "shell",
    status: "running",
    args: { command: "git push --force origin main", workingDirectory: "/vercel/sandbox" },
  },
  {
    type: "assistant",
    ...IDS,
    message: { role: "assistant", content: [{ type: "text", text: "I" }] },
  },
  {
    type: "assistant",
    ...IDS,
    message: { role: "assistant", content: [{ type: "text", text: " read it." }] },
  },
  {
    type: "usage",
    ...IDS,
    usage: {
      inputTokens: 24726,
      outputTokens: 408,
      cacheReadTokens: 20096,
      cacheWriteTokens: 0,
      totalTokens: 25134,
    },
  },
  { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
];

/** The recording read and folded event by event, as the events route folds a batch, and every event told the writer. */
function folded(messages: readonly WireValue[]) {
  let state: NativeProjection = heldProjection(null);
  const told: RunEvent[] = [];
  const sessions: string[] = [];

  messages.forEach((message, index) => {
    const held: NativeHeld = {
      callName: (callId) => state.turn?.calls[callId],
      session: state.session,
      sequence: index + 1,
      planLimited: false,
    };

    const projected = projectMoments(state, cursorMoments(message, held), {
      conversationId: "c_cursor",
      sequence: index + 1,
      now: 0,
      attempt: 1,
      queuedTurnId: undefined,
      model: "cursor/composer-2.5",
      ownKey: true,
      registered: (name) => Object.hasOwn(CODER_TOOL_SET, name),
      report: () => undefined,
    });

    state = projected.state;

    for (const write of projected.writes) {
      if (write.kind === NATIVE_WRITE.EVENT) told.push(write.event);

      if (write.kind === NATIVE_WRITE.SESSION) sessions.push(write.sessionId);
    }
  });

  return { told, sessions };
}

test("a Cursor run reads as one turn: its tokens joined into whole reasoning and words, each call started once and stored under the name its row draws by, our own tool's answer read as its JSON, a call left running settled as the turn ends, and its usage metered", () => {
  const { told, sessions } = folded(RECORDED);

  assert.deepEqual(sessions, [AGENT]);
  assert.deepEqual(
    told.flatMap((event) => (event.kind === RUN_EVENT.REASONING_COMPLETED ? [event.summary] : [])),
    ["The file"],
  );
  assert.deepEqual(
    told.flatMap((event) => (event.kind === RUN_EVENT.TEXT_DRAFTED ? [event.text] : [])).at(-1),
    "I read it.",
  );
  assert.deepEqual(
    told.flatMap((event) =>
      event.kind === RUN_EVENT.TOOL_CALL_STARTED ? [[event.callId, event.name]] : [],
    ),
    [
      ["call-read", "cursorRead"],
      ["call-edit", "cursorEdit"],
      ["call-thread", "post_thread"],
      ["call-push", "cursorShell"],
    ],
  );

  const settled = new Map(
    told.flatMap((event) =>
      event.kind === RUN_EVENT.TOOL_CALL_SETTLED ? [[event.callId, event.settlement]] : [],
    ),
  );

  assert.deepEqual(settled.get("call-thread"), {
    state: "output-available",
    output: { status: "posted" },
    status: "posted",
  });
  assert.equal(settled.get("call-read")?.state, "output-available");
  assert.equal(settled.get("call-push")?.state, "output-error");

  const ended = told.find((event) => event.kind === RUN_EVENT.TURN_ENDED);
  assert.deepEqual(ended?.kind === RUN_EVENT.TURN_ENDED ? ended.usage : undefined, {
    inputTokens: 24726,
    outputTokens: 408,
    cachedInputTokens: 20096,
    reasoningTokens: 0,
    cacheWriteTokens: 0,
  });
});

test("a call a review refused comes back as the call's error, Cursor's words kept, and the turn goes on", () => {
  const moments = cursorMoments(
    {
      type: "tool_call",
      ...IDS,
      call_id: "call-push",
      name: "shell",
      status: "completed",
      args: { command: "git push --force origin main" },
      result: {
        status: "error",
        error: {
          message: "Local SDK runs cannot request interactive approval for this shell command.",
          command: "git push --force origin main",
        },
      },
    },
    { callName: () => undefined, session: AGENT, sequence: 1, planLimited: false },
  );

  const settled = moments.find((moment) => moment.kind === NATIVE_MOMENT.TOOL_SETTLED);

  assert.deepEqual(settled?.kind === NATIVE_MOMENT.TOOL_SETTLED ? settled.settlement : undefined, {
    state: "output-error",
    output: "Local SDK runs cannot request interactive approval for this shell command.",
    errorText: "Local SDK runs cannot request interactive approval for this shell command.",
    status: "rejected",
  });
  assert.ok(!moments.some((moment) => moment.kind === NATIVE_MOMENT.RESULT));
});
