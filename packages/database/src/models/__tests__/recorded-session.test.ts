import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { claimRuntimeSession, recordedRuntimeSession } from "../recorded-session.js";

/**
 * The conversation's record of its session, claimed only forward, over a
 * real dialect. Synthetic accounts throughout.
 */

/** A session id as the runner mints it: the harness's prefix, the instant in twelve hex digits, then a UUID. */
const minted = (prefix: string, instant: number) =>
  `${prefix}${instant.toString(16).padStart(12, "0")}-${randomUUID()}`;

const EARLIER = Date.UTC(2026, 9, 1);
const LATER = Date.UTC(2026, 10, 7);

/** An account of its own with an agent of its own, by the agent's conversation. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Invitations" });

  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  return { userId, conversationId: Option.getOrThrow(started).agent.conversationId };
});

it.layer(getTestDB())("a conversation's recorded session", (it) => {
  it.effect.each([
    {
      case: "a session minted later claims over one before the rename",
      standing: minted("luke-claude-code-", EARLIER),
      next: minted("claude-code-", LATER),
      claims: true,
    },
    {
      case: "a session minted earlier never claims back over a later one",
      standing: minted("codex-", LATER),
      next: minted("luke-codex-", EARLIER),
      claims: false,
    },
    {
      case: "a minted session claims over an id carrying no instant",
      standing: "wrun_01JC8Y4ZQ5V7R2M3N6P8T0W9XB",
      next: minted("codex-", EARLIER),
      claims: true,
    },
    {
      case: "an id carrying no instant never claims over a minted session",
      standing: minted("claude-code-", EARLIER),
      next: "wrun_01JC8Y4ZQ5V7R2M3N6P8T0W9XB",
      claims: false,
    },
  ])("$case", ({ standing, next, claims }) =>
    Effect.gen(function* () {
      const target = yield* openAgent;
      assert.equal(yield* claimRuntimeSession(target, standing, new Date(EARLIER)), true);

      assert.equal(yield* claimRuntimeSession(target, next, new Date(LATER)), claims);
      assert.equal(yield* recordedRuntimeSession(target), claims ? next : standing);
    }),
  );
});
