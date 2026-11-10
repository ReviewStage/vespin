import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { SANDBOX_STATE, SANDBOX_STEP } from "@repo/features/agent-sandbox-wire";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  readAgentSandbox,
  recordSandboxBooting,
  recordSandboxOff,
  recordSandboxRunning,
  recordSandboxStep,
  recordSandboxTouch,
} from "../agent-sandbox-store.js";
import { createAgent } from "../agent-store.js";

/**
 * A cloud agent's sandbox record, over a real dialect: a boot's steps in
 * the order they began, kept once it runs and reset by the next boot; a
 * touch that moves the stop by less than the least step writes nothing;
 * and a discard of a session the conversation moved off leaves the newer
 * session's record. Synthetic accounts throughout; each case reads every
 * instant as milliseconds from its own start, since the cases share a clock.
 */

const IDLE = Duration.minutes(3);
const LEAST = Duration.minutes(1);

/** A fresh agent's conversation. */
const openConversation = Effect.gen(function* () {
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
  return Option.getOrThrow(started).agent.conversationId;
});

it.layer(getTestDB())("a cloud agent's sandbox record", (it) => {
  it.effect("a boot's steps run in order, stay once it runs, and are reset by the next boot", () =>
    Effect.gen(function* () {
      const conversationId = yield* openConversation;
      const start = yield* Clock.currentTimeMillis;
      yield* recordSandboxBooting(conversationId, "session-1", SANDBOX_STEP.CREATING);
      yield* TestClock.adjust("2 seconds");
      yield* recordSandboxStep(conversationId, SANDBOX_STEP.CLONING);
      yield* TestClock.adjust("8 seconds");
      yield* recordSandboxStep(conversationId, SANDBOX_STEP.STARTING_AGENT);
      yield* TestClock.adjust("1 second");
      yield* recordSandboxRunning(conversationId, "session-1", IDLE);
      // A step past the boot, as a relaunch in a running sandbox records, is no step of it.
      yield* recordSandboxStep(conversationId, SANDBOX_STEP.CLONING);

      const running = yield* readAgentSandbox(conversationId);
      assert.equal(running?.state, SANDBOX_STATE.RUNNING);
      assert.equal(running?.stateAt.getTime(), start + 11_000);
      assert.equal(running?.runsUntil?.getTime(), start + 191_000);
      assert.deepEqual(running?.steps, [
        { step: SANDBOX_STEP.CREATING, at: start },
        { step: SANDBOX_STEP.CLONING, at: start + 2_000 },
        { step: SANDBOX_STEP.STARTING_AGENT, at: start + 10_000 },
      ]);

      yield* TestClock.adjust("10 minutes");
      yield* recordSandboxBooting(conversationId, "session-1", SANDBOX_STEP.RESUMING);
      const resuming = yield* readAgentSandbox(conversationId);
      assert.equal(resuming?.state, SANDBOX_STATE.BOOTING);
      assert.equal(resuming?.runsUntil, null);
      assert.deepEqual(resuming?.steps, [{ step: SANDBOX_STEP.RESUMING, at: start + 611_000 }]);
    }),
  );

  it.effect("a touch moves the stop only where it moves by the least step or more", () =>
    Effect.gen(function* () {
      const conversationId = yield* openConversation;
      const start = yield* Clock.currentTimeMillis;
      yield* recordSandboxRunning(conversationId, "session-1", IDLE);
      yield* TestClock.adjust("30 seconds");
      yield* recordSandboxTouch(conversationId, IDLE, LEAST);
      assert.equal(
        (yield* readAgentSandbox(conversationId))?.runsUntil?.getTime(),
        start + 180_000,
      );

      yield* TestClock.adjust("30 seconds");
      yield* recordSandboxTouch(conversationId, IDLE, LEAST);
      assert.equal(
        (yield* readAgentSandbox(conversationId))?.runsUntil?.getTime(),
        start + 240_000,
      );
    }),
  );

  it.effect(
    "a discard of a session the conversation moved off leaves the newer session's record",
    () =>
      Effect.gen(function* () {
        const conversationId = yield* openConversation;
        const start = yield* Clock.currentTimeMillis;
        yield* recordSandboxRunning(conversationId, "session-1", IDLE);
        yield* recordSandboxBooting(conversationId, "session-2", SANDBOX_STEP.CREATING);
        yield* recordSandboxOff("session-1");
        assert.equal((yield* readAgentSandbox(conversationId))?.state, SANDBOX_STATE.BOOTING);

        yield* TestClock.adjust("5 seconds");
        yield* recordSandboxOff("session-2");
        const off = yield* readAgentSandbox(conversationId);
        assert.equal(off?.state, SANDBOX_STATE.OFF);
        assert.equal(off?.stateAt.getTime(), start + 5_000);
        assert.equal(off?.runsUntil, null);
      }),
  );
});
