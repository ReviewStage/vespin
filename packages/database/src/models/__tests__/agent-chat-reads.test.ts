import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { and, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentRead } from "../../schemas/agent-read.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { markAgentRead, markAgentSeen, markAgentUnread } from "../agent-chat-reads.js";
import { createAgent } from "../agent-store.js";

/**
 * A Manager's chat's read marks, over a real dialect: each member's look
 * moves their own mark alone, and never moves it back; Mark unread moves
 * the asker's own back and marks it unread by hand, which leaving the chat
 * leaves standing and opening it takes back. Synthetic accounts.
 */

const EARLIER = new Date("2026-11-19T12:00:00Z");
const LATER = new Date("2026-11-19T12:30:00Z");
const LATEST = new Date("2026-11-19T13:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

const openAgent = (userId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Billing", repository: "acme/relay" });

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "openai/gpt-5.5",
      effort: "high",
      descriptionSnapshot: "# Billing\n",
      prompt: null,
      repository: "acme/relay",
      runtime: CONVERSATION_RUNTIME.CODEX,
    });

    return Option.getOrThrow(started).agent.id;
  });

/** The instant the member's mark of the agent reads through and whether it stands marked unread by hand, or none where they never looked. */
const markOf = (userId: string, agentId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const rows = yield* db
      .select({ readThrough: agentRead.readThrough, markedUnread: agentRead.markedUnread })
      .from(agentRead)
      .where(and(eq(agentRead.userId, userId), eq(agentRead.agentId, agentId)));

    const [mark] = rows;

    return mark === undefined ? undefined : [mark.readThrough.toISOString(), mark.markedUnread];
  });

it.layer(getTestDB())("a Manager's chat's read marks", (it) => {
  it.effect("a member's look moves their own mark alone, and never moves it back", () =>
    Effect.gen(function* () {
      const reader = yield* openAccount;
      const teammate = yield* openAccount;
      const agentId = yield* openAgent(reader);

      yield* markAgentRead(reader, agentId, LATER);
      yield* markAgentRead(reader, agentId, EARLIER);

      assert.deepEqual(
        [yield* markOf(reader, agentId), yield* markOf(teammate, agentId)],
        [[LATER.toISOString(), false], undefined],
      );
    }),
  );

  it.effect("Mark unread moves the asker's own mark back and marks it unread, alone", () =>
    Effect.gen(function* () {
      const reader = yield* openAccount;
      const teammate = yield* openAccount;
      const agentId = yield* openAgent(reader);

      yield* markAgentRead(reader, agentId, LATER);
      yield* markAgentRead(teammate, agentId, LATER);
      yield* markAgentUnread(reader, agentId, EARLIER);

      assert.deepEqual(
        [yield* markOf(reader, agentId), yield* markOf(teammate, agentId)],
        [
          [EARLIER.toISOString(), true],
          [LATER.toISOString(), false],
        ],
      );
    }),
  );

  it.effect(
    "after Mark unread, leaving the chat moves the mark forward with the mark by hand standing, and opening it takes that back",
    () =>
      Effect.gen(function* () {
        const reader = yield* openAccount;
        const agentId = yield* openAgent(reader);

        yield* markAgentUnread(reader, agentId, EARLIER);
        yield* markAgentSeen(reader, agentId, LATER);
        const left = yield* markOf(reader, agentId);
        yield* markAgentRead(reader, agentId, LATEST);

        assert.deepEqual(
          [left, yield* markOf(reader, agentId)],
          [
            [LATER.toISOString(), true],
            [LATEST.toISOString(), false],
          ],
        );
      }),
  );
});
