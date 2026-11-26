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
import { markAgentRead, markAgentUnread } from "../agent-chat-reads.js";
import { createAgent } from "../agent-store.js";

/**
 * A Manager's chat's read marks, over a real dialect: each member's look
 * moves their own mark alone, and never moves it back; Mark unread moves
 * the asker's own back, which their next look moves forward. Synthetic
 * accounts.
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

/** The instant the member's mark of the agent reads through, or none where they never looked. */
const markOf = (userId: string, agentId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const rows = yield* db
      .select({ readThrough: agentRead.readThrough })
      .from(agentRead)
      .where(and(eq(agentRead.userId, userId), eq(agentRead.agentId, agentId)));

    return rows[0]?.readThrough.toISOString();
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
        [LATER.toISOString(), undefined],
      );
    }),
  );

  it.effect("Mark unread moves the asker's own mark back alone", () =>
    Effect.gen(function* () {
      const reader = yield* openAccount;
      const teammate = yield* openAccount;
      const agentId = yield* openAgent(reader);

      yield* markAgentRead(reader, agentId, LATER);
      yield* markAgentRead(teammate, agentId, LATER);
      yield* markAgentUnread(reader, agentId, EARLIER);

      assert.deepEqual(
        [yield* markOf(reader, agentId), yield* markOf(teammate, agentId)],
        [EARLIER.toISOString(), LATER.toISOString()],
      );
    }),
  );

  it.effect("a look after Mark unread moves the mark forward again", () =>
    Effect.gen(function* () {
      const reader = yield* openAccount;
      const agentId = yield* openAgent(reader);

      yield* markAgentRead(reader, agentId, LATER);
      yield* markAgentUnread(reader, agentId, EARLIER);
      yield* markAgentRead(reader, agentId, LATEST);

      assert.equal(yield* markOf(reader, agentId), LATEST.toISOString());
    }),
  );
});
