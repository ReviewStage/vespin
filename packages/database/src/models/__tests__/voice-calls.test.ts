import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import {
  claimVoiceCallLease,
  deleteVoiceCall,
  insertVoiceCall,
  readVoiceCall,
  saveVoiceCallState,
} from "../voice-calls.js";

/**
 * The row a voice call keeps while it stands, over a real dialect: a member
 * reads and ends only their own call, a lease is claimed by epoch so a stale
 * claimant takes nothing, and only the epoch's holder saves the call's state.
 * Synthetic accounts throughout.
 */

const STARTED_AT = new Date("2026-11-13T02:00:00Z");
const LEASE_UNTIL = new Date("2026-11-13T02:13:20Z");
const NEXT_LEASE_UNTIL = new Date("2026-11-13T02:26:40Z");

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );

  return id;
});

const openCall = Effect.gen(function* () {
  const callerId = yield* openAccount;
  const task = yield* startTask(callerId, { name: "Invitations" });

  const started = yield* createAgent(callerId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  const agentId = Option.getOrThrow(started).agent.id;

  const call = yield* insertVoiceCall({
    liveSessionId: `live-${randomUUID()}`,
    callerId,
    agentId,
    voice: "marin",
    startedAt: STARTED_AT,
    leaseUntil: LEASE_UNTIL,
  });

  return { callerId, call };
});

it.layer(getTestDB())("the row a voice call keeps", (it) => {
  it.effect("one member never reads or ends another's call", () =>
    Effect.gen(function* () {
      const { callerId, call } = yield* openCall;
      const other = yield* openAccount;

      assert.equal(Option.isNone(yield* readVoiceCall(other, call.id)), true);
      assert.equal(yield* deleteVoiceCall(other, call.id), false);

      const read = Option.getOrThrow(yield* readVoiceCall(callerId, call.id));
      assert.equal(read.agentId, call.agentId);
      assert.equal(read.leaseEpoch, 1);
      assert.equal(read.toldSeq, null);

      assert.equal(yield* deleteVoiceCall(callerId, call.id), true);
      assert.equal(Option.isNone(yield* readVoiceCall(callerId, call.id)), true);
    }),
  );

  it.effect(
    "a claim by a stale epoch takes no lease, and the epoch's holder alone saves state",
    () =>
      Effect.gen(function* () {
        const { callerId, call } = yield* openCall;

        const taken = Option.getOrThrow(yield* claimVoiceCallLease(call.id, 1, NEXT_LEASE_UNTIL));
        assert.equal(taken.leaseEpoch, 2);
        assert.equal(taken.leaseUntil.getTime(), NEXT_LEASE_UNTIL.getTime());

        // The claimant that read epoch 1 is stale now.
        assert.equal(Option.isNone(yield* claimVoiceCallLease(call.id, 1, NEXT_LEASE_UNTIL)), true);

        const state = { toldSeq: 42 };
        assert.equal(yield* saveVoiceCallState(call.id, 1, state), false);
        assert.equal(yield* saveVoiceCallState(call.id, 2, state), true);

        const read = Option.getOrThrow(yield* readVoiceCall(callerId, call.id));
        assert.equal(read.toldSeq, 42);
      }),
  );
});
