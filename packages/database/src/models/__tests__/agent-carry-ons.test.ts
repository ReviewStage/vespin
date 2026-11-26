import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  CARRY_ON_REASON,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@repo/wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { messages, turns } from "../../schemas/storage.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { carryOnsUnanswered } from "../agent-carry-ons.js";
import { createAgent } from "../agent-store.js";

/**
 * A coding agent's carry-ons as the backoff reads them, over a real dialect:
 * the carry-on lines counted since the agent last answered, never another
 * account's. Synthetic accounts and words throughout.
 */

const NOW = new Date("2026-11-24T19:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

const openAgent = (userId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "openai/gpt-5.5",
      effort: "high",
      descriptionSnapshot: "# Invitations\n",
      prompt: null,
      repository: "acme/relay",
      runtime: CONVERSATION_RUNTIME.CODEX,
    });

    return Option.getOrThrow(started).agent;
  });

/** The rows the count reads: a carry-on line, a line of the developer's, and the agent's own answer, which a turn of its own writes. */
const LINE = {
  CARRY_ON: {
    role: MESSAGE_ROLE.USER,
    metadata: { channel: MESSAGE_CHANNEL.CARRY_ON, reason: CARRY_ON_REASON.RUNNER_LOST },
    answer: false,
  },
  TYPED: { role: MESSAGE_ROLE.USER, metadata: { channel: MESSAGE_CHANNEL.TYPED }, answer: false },
  ANSWER: { role: MESSAGE_ROLE.ASSISTANT, metadata: null, answer: true },
} as const;

/** One row of the agent's conversation at the place given. */
const written = (
  agent: { readonly userId: string; readonly conversationId: string },
  seq: number,
  line: (typeof LINE)[keyof typeof LINE],
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const { userId, conversationId } = agent;
    const turnId = line.answer ? randomUUID() : null;

    if (turnId !== null) {
      yield* db.insert(turns).values({
        id: turnId,
        userId,
        conversationId,
        origin: TURN_ORIGIN.TYPED,
        status: TURN_STATUS.SETTLED,
      });
    }

    yield* db.insert(messages).values({
      userId,
      conversationId,
      seq,
      turnId,
      clientId: randomUUID(),
      role: line.role,
      parts: [{ type: "text", text: "Words." }],
      metadata: line.metadata,
      placedAt: NOW,
    });
  });

it.layer(getTestDB())("a coding agent's carry-ons", (it) => {
  it.effect(
    "the carry-on lines since the agent last answered are counted, its own starter's alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agent = yield* openAgent(owner);
        const target = { userId: owner, conversationId: agent.conversationId };

        // Before the agent ever answered, every carry-on counts.
        yield* written(agent, 1, LINE.TYPED);
        yield* written(agent, 2, LINE.CARRY_ON);
        assert.equal(yield* carryOnsUnanswered(target), 1);

        // Its answer resets the count; the developer's own line counts for nothing.
        yield* written(agent, 3, LINE.ANSWER);
        assert.equal(yield* carryOnsUnanswered(target), 0);
        yield* written(agent, 4, LINE.CARRY_ON);
        yield* written(agent, 5, LINE.TYPED);
        yield* written(agent, 6, LINE.CARRY_ON);
        assert.equal(yield* carryOnsUnanswered(target), 2);

        assert.equal(
          yield* carryOnsUnanswered({ userId: other, conversationId: agent.conversationId }),
          0,
          "another account reads none of the agent's lines",
        );
      }),
  );
});
