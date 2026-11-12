import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent, readAgentRouting } from "@repo/database/models/agent-store";
import { user } from "@repo/database/schemas/auth";
import { messages, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_SOURCE } from "@repo/features/agent-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TURN_STATUS, valueFromJsonText, type WireValue } from "@repo/wire";
import type { StoredUIMessage } from "@repo/wire/ui-messages";
import { asc, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { OfferedModel } from "../../providers/model-catalog.js";
import { importConductorChat } from "./conductor-chat-import.js";
import type { ConductorChat, ConductorMessage } from "./conductor-client.js";

/**
 * A Conductor chat of each harness, written as hand-made records shaped as
 * the live API answered them (scrubbed and trimmed), imported over a real
 * store, and read back as the transcript draws it: the developer's lines,
 * the harness's words, reasoning, and calls with their answers, a tool no
 * transcript registers as the generic call, and an inline picture kept.
 */

const FALLBACK = { model: "anthropic/claude-opus-5.5", effort: "high" } as const;

const OFFERED: readonly OfferedModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high"],
  },
];

/** A 1×1 PNG, the smallest picture whose header states its size. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const userLine = (id: string, receivedAt: string, message: string): ConductorMessage => ({
  id,
  type: "userMessage",
  receivedAt,
  content: { message, config: { harness: "claude", model: "opus" } },
});

const agentEvent = (id: string, receivedAt: string, rawPayload: WireValue): ConductorMessage => ({
  id,
  type: "agent",
  receivedAt,
  content: { rawPayload },
});

/** A Claude Code chat of two turns: thinking, words, a Bash call answered, a call of a tool we lack, a subagent's own message, a picture sent inline, and the run's own bookkeeping. */
const CLAUDE_CHAT: readonly ConductorMessage[] = [
  userLine("c-1", "2026-10-01T09:00:00.000Z", "Please fix the flaky check."),
  agentEvent("c-2", "2026-10-01T09:00:01.000Z", {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "text", text: "Please fix the flaky check." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL_PNG } },
      ],
    },
  }),
  agentEvent("c-3", "2026-10-01T09:00:02.000Z", {
    type: "system",
    subtype: "init",
    session_id: "s-1",
  }),
  agentEvent("c-4", "2026-10-01T09:00:03.000Z", {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "msg-1",
      content: [
        { type: "thinking", thinking: "Look at the test first." },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pnpm test" } },
      ],
    },
  }),
  agentEvent("c-5", "2026-10-01T09:00:04.000Z", {
    type: "assistant",
    parent_tool_use_id: "toolu_9",
    message: { id: "msg-sub", content: [{ type: "text", text: "A subagent's own words." }] },
  }),
  agentEvent("c-6", "2026-10-01T09:00:05.000Z", {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "1 failed" }],
    },
  }),
  agentEvent("c-7", "2026-10-01T09:00:06.000Z", {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "msg-2",
      content: [
        { type: "tool_use", id: "toolu_2", name: "ConductorOnlyTool", input: { path: "a" } },
      ],
    },
  }),
  agentEvent("c-8", "2026-10-01T09:00:07.000Z", {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "done" }],
    },
  }),
  agentEvent("c-9", "2026-10-01T09:00:08.000Z", {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "msg-3", content: [{ type: "text", text: "Fixed the timeout." }] },
  }),
  agentEvent("c-10", "2026-10-01T09:00:09.000Z", {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    usage: { input_tokens: 10, output_tokens: 5 },
  }),
  agentEvent("c-11", "2026-10-01T09:00:10.000Z", { type: "command_lifecycle", phase: "end" }),
  userLine("c-12", "2026-10-01T09:05:00.000Z", "Thanks, push it."),
  agentEvent("c-13", "2026-10-01T09:05:01.000Z", {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "msg-4", content: [{ type: "text", text: "Pushed." }] },
  }),
];

const codexEvent = (id: string, at: string, event: WireValue) =>
  agentEvent(id, at, { event, thread_id: "thread-1" });

/** A Codex chat of one turn: reasoning, a command run, and words, in Conductor's envelope. */
const CODEX_CHAT: readonly ConductorMessage[] = [
  userLine("x-1", "2026-10-02T10:00:00.000Z", "List the files."),
  codexEvent("x-2", "2026-10-02T10:00:01.000Z", { type: "turn.started" }),
  codexEvent("x-3", "2026-10-02T10:00:02.000Z", {
    type: "item.completed",
    item: { type: "reasoning", id: "r-1", summary: ["Run ls."], content: [] },
  }),
  codexEvent("x-4", "2026-10-02T10:00:03.000Z", {
    type: "item.started",
    item: { type: "commandExecution", id: "cmd-1", command: "ls", cwd: "/w", status: "inProgress" },
  }),
  codexEvent("x-5", "2026-10-02T10:00:04.000Z", {
    type: "item.completed",
    item: {
      type: "commandExecution",
      id: "cmd-1",
      command: "ls",
      cwd: "/w",
      status: "completed",
      aggregatedOutput: "README.md\n",
      exitCode: 0,
    },
  }),
  codexEvent("x-6", "2026-10-02T10:00:05.000Z", {
    type: "item.completed",
    item: { type: "agentMessage", id: "m-1", text: "One file: README.md." },
  }),
  codexEvent("x-7", "2026-10-02T10:00:06.000Z", {
    type: "turn.completed",
    usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
  }),
];

const chatOf = (overrides: Partial<ConductorChat>): ConductorChat => ({
  id: randomUUID(),
  name: "Fix the flaky check",
  model: "opus",
  resolvedModel: "claude-opus-5-5",
  effort: "medium",
  ...overrides,
});

/** A member of their own with a task to import onto. */
const member = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const task = yield* startTask(userId, { name: "Imported work" });

  return { userId, taskId: task.id };
});

/** A part as the transcript draws it: its type, and its words, state, and output where it has them. */
function drawn(part: StoredUIMessage["parts"][number]): readonly WireValue[] {
  const fields: WireValue[] = [part.type];

  if ("text" in part) fields.push(part.text);
  else if ("state" in part && part.state !== undefined) fields.push(part.state);

  if ("input" in part && part.type === "tool-unknown_tool") {
    fields.push(valueFromJsonText(JSON.stringify(part.input)));
  }

  return fields;
}

/** The conversation's messages and turns as a reader of the transcript sees them. */
const transcriptOf = (conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const rows = yield* db
      .select({ role: messages.role, parts: messages.parts, turnId: messages.turnId })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.seq));

    const turnRows = yield* db
      .select({ status: turns.status, usage: turns.usage })
      .from(turns)
      .where(eq(turns.conversationId, conversationId));

    return { rows, turns: turnRows };
  });

it.layer(getTestDB())("a Conductor chat imported", (it) => {
  it.effect(
    "a Claude Code chat lands as finished turns with its words, reasoning, calls, and picture",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* member;

        const { agent } = yield* importConductorChat({
          userId,
          taskId,
          repository: null,
          workspace: { id: "ws-1", deepLink: "conductor://workspace/ws-1" },
          chat: chatOf({ archivedAt: "2026-10-03T00:00:00.000Z" }),
          messages: CLAUDE_CHAT,
          offered: OFFERED,
          fallback: FALLBACK,
        });

        const { rows, turns: written } = yield* transcriptOf(agent.conversationId);
        const routing = yield* readAgentRouting(userId, agent.id);

        assert.deepEqual(
          rows.map((row) => [row.role, row.parts.map(drawn)]),
          [
            ["user", [["text", "Please fix the flaky check."], ["file"]]],
            [
              "assistant",
              [
                ["step-start"],
                ["reasoning", "Look at the test first."],
                ["tool-Bash", "output-available"],
                ["step-start"],
                [
                  "tool-unknown_tool",
                  "output-available",
                  { name: "ConductorOnlyTool", input: { path: "a" } },
                ],
                ["step-start"],
                ["text", "Fixed the timeout."],
              ],
            ],
            ["user", [["text", "Thanks, push it."]]],
            ["assistant", [["step-start"], ["text", "Pushed."]]],
          ],
        );
        // Every line names its turn, so a replay of the transcript hands each one.
        assert.ok(rows.every((row) => row.turnId !== null));
        assert.deepEqual(
          written.map((turn) => [turn.status, turn.usage]),
          [
            [TURN_STATUS.SETTLED, null],
            [TURN_STATUS.SETTLED, null],
          ],
        );
        assert.equal(agent.model, "anthropic/claude-opus-5.5");
        assert.equal(agent.effort, "medium");
        assert.notEqual(agent.archivedAt, null);
        assert.equal(agent.source?.kind, AGENT_SOURCE.CONDUCTOR);
        assert.equal(Option.getOrThrow(routing).nativeSession, "transcript-replay");
      }),
  );

  it.effect(
    "a rerun writes again an import a run left unfinished, and leaves a finished one as it stands",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* member;
        const chat = chatOf({});

        // A run that died partway: the agent made under the chat's key, its source never recorded.
        const partial = Option.getOrThrow(
          yield* createAgent(userId, {
            taskId,
            descriptionSnapshot: null,
            prompt: null,
            idempotencyKey: chat.id,
            model: FALLBACK.model,
            effort: FALLBACK.effort,
            repository: null,
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          }),
        ).agent;

        const toImport = {
          userId,
          taskId,
          repository: null,
          workspace: { id: "ws-3" },
          chat,
          messages: CODEX_CHAT,
          offered: OFFERED,
          fallback: FALLBACK,
        };

        const redone = yield* importConductorChat(toImport);
        const again = yield* importConductorChat(toImport);
        const { rows } = yield* transcriptOf(redone.agent.conversationId);

        assert.ok(Option.isNone(yield* readAgentRouting(userId, partial.id)));
        assert.notEqual(redone.agent.id, partial.id);
        assert.equal(redone.created, true);
        assert.equal(redone.agent.source?.kind, AGENT_SOURCE.CONDUCTOR);
        assert.deepEqual([again.agent.id, again.created], [redone.agent.id, false]);
        assert.equal(rows.length, 2);
      }),
  );

  it.effect("a Codex chat lands as a finished turn with its reasoning, command, and words", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* member;

      const { agent } = yield* importConductorChat({
        userId,
        taskId,
        repository: null,
        workspace: { id: "ws-2" },
        chat: chatOf({ model: "gpt-5", resolvedModel: "gpt-5", effort: "high" }),
        messages: CODEX_CHAT,
        offered: OFFERED,
        fallback: FALLBACK,
      });

      const { rows, turns: written } = yield* transcriptOf(agent.conversationId);

      assert.deepEqual(
        rows.map((row) => [row.role, row.parts.map(drawn)]),
        [
          ["user", [["text", "List the files."]]],
          [
            "assistant",
            [
              ["step-start"],
              ["reasoning", "Run ls."],
              ["tool-commandExecution", "output-available"],
              ["step-start"],
              ["text", "One file: README.md."],
            ],
          ],
        ],
      );
      assert.deepEqual(
        written.map((turn) => turn.status),
        [TURN_STATUS.SETTLED],
      );
      // The chat's model is not offered, so the agent runs on the workspace's default.
      assert.equal(agent.model, FALLBACK.model);
      assert.equal(agent.archivedAt, null);
    }),
  );
});
