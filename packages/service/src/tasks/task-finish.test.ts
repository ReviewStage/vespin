import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent, readAgent } from "@repo/database/models/agent-store";
import { updateTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_ARCHIVER } from "@repo/features/agent-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { doneTaskArchive } from "../agents/agent-change.js";
import { idleStandingAgents } from "../agents/coder-host/stop.js";
import { settleTaskAfterTurn } from "./task-finish.js";

/**
 * An agent archived with its task moved to Done, against a real dialect: an
 * idle one at once, and one still at work, the agent that moved the task
 * among them, once its turn ends.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** An agent the account started on the task an hour ago, past the starting grace. */
const openAgent = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const started = yield* createAgent(userId, {
      taskId,
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    const { agent } = Option.getOrThrow(started);
    const now = yield* Clock.currentTimeMillis;
    const db = yield* Database;
    yield* db
      .update(agentTable)
      .set({ createdAt: new Date(now - 60 * 60_000) })
      .where(eq(agentTable.id, agent.id));
    return agent;
  });

/** A turn of the agent's conversation queued ten minutes ago, running or settled as `status` says. */
const turnOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  status: TurnStatus,
) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const db = yield* Database;
    const [row] = yield* db
      .insert(turns)
      .values({
        userId: agent.userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status,
        queuedAt: new Date(now - 10 * 60_000),
        startedAt: new Date(now - 10 * 60_000 + 1000),
        settledAt: status === TURN_STATUS.SETTLED ? new Date(now - 60_000) : null,
      })
      .returning({ id: turns.id });
    return row?.id ?? assert.fail("the turn was not written");
  });

/** The turn settled, as its end leaves it. */
const settle = (turnId: string) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ status: TURN_STATUS.SETTLED, settledAt: new Date(now) })
        .where(eq(turns.id, turnId)),
    ),
  );

/** Whether the agent stands archived. */
const archived = (userId: string, agentId: string) =>
  Effect.map(readAgent(userId, agentId), (read) => Option.getOrThrow(read).archivedAt !== null);

it.layer(getTestDB())("an agent archived with its task's Done", (it) => {
  it.effect(
    "a task moved to Done archives its idle agent at once, and one whose turn still runs, its Stop on the way, only once that turn ends",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const idle = yield* openAgent(userId, task.id);
        const stopping = yield* openAgent(userId, task.id);
        yield* turnOf(idle, TURN_STATUS.SETTLED);
        const running = yield* turnOf(stopping, TURN_STATUS.RUNNING);
        const now = yield* Clock.currentTimeMillis;
        yield* Database.use((db) =>
          db
            .update(turns)
            .set({ cancelRequestedAt: new Date(now) })
            .where(eq(turns.id, running)),
        );

        yield* updateTask(userId, task.id, { status: TASK_STATUS.DONE }, undefined, {
          archivedBy: { by: AGENT_ARCHIVER.MEMBER, userId },
          idle: idleStandingAgents,
        });
        assert.equal(yield* archived(userId, idle.id), true);
        assert.equal(yield* archived(userId, stopping.id), false);

        yield* settle(running);
        yield* settleTaskAfterTurn(userId, task.id, stopping.id);
        assert.equal(yield* archived(userId, stopping.id), true);
      }),
  );

  it.effect(
    "a member's Done that confirmed stopping its agents archives the one whose Stop is on the way at once",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const stopping = yield* openAgent(userId, task.id);
        const running = yield* turnOf(stopping, TURN_STATUS.RUNNING);
        const now = yield* Clock.currentTimeMillis;
        yield* Database.use((db) =>
          db
            .update(turns)
            .set({ cancelRequestedAt: new Date(now) })
            .where(eq(turns.id, running)),
        );

        yield* updateTask(
          userId,
          task.id,
          { status: TASK_STATUS.DONE },
          undefined,
          doneTaskArchive({ by: AGENT_ARCHIVER.MEMBER, userId }, new Set([stopping.id])),
        );
        assert.equal(yield* archived(userId, stopping.id), true);
      }),
  );

  it.effect(
    "an agent moving its own task to Done archives its idle teammate at once, and itself once its turn ends",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const finisher = yield* openAgent(userId, task.id);
        const teammate = yield* openAgent(userId, task.id);
        yield* turnOf(teammate, TURN_STATUS.SETTLED);
        const answering = yield* turnOf(finisher, TURN_STATUS.RUNNING);

        // The agent's update_task moves the task to Done as that agent, for its member.
        yield* updateTask(userId, task.id, { status: TASK_STATUS.DONE }, undefined, {
          archivedBy: {
            by: AGENT_ARCHIVER.AGENT,
            userId,
            agentId: finisher.id,
            agentName: "Finisher",
          },
          idle: idleStandingAgents,
        });
        assert.equal(yield* archived(userId, teammate.id), true);
        assert.equal(yield* archived(userId, finisher.id), false);

        yield* settle(answering);
        yield* settleTaskAfterTurn(userId, task.id, finisher.id);
        assert.equal(yield* archived(userId, finisher.id), true);
      }),
  );
});
