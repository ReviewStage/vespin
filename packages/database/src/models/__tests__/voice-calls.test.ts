import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { messages } from "../../schemas/storage.js";
import { task } from "../../schemas/task.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import {
  claimVoiceCallLease,
  deleteVoiceCall,
  endVoiceCall,
  insertVoiceCall,
  listStandingVoiceCalls,
  readVoiceCall,
  saveVoiceCallState,
} from "../voice-calls.js";

/**
 * The row a voice call keeps while it stands, over a real dialect: a member
 * reads and ends only their own call, a lease is claimed by epoch so a stale
 * claimant takes nothing, only the epoch's holder saves the call's state, and
 * which calls stand on an agent is read only within its workspace, and a
 * call's end lets go of the blank agent it was on where nobody spoke to it.
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

  return { callerId, call, workspaceId: task.workspaceId };
});

/** What an agent a call opens on was handed: nothing, as Talk in a new agent's box starts it, or the task's description. */
const HANDED = {
  BLANK: { descriptionSnapshot: null, prompt: null },
  DESCRIPTION: { descriptionSnapshot: "# Invitations\n", prompt: null },
} as const;

/** A call by `callerId` opened on a new agent of theirs on `taskId`, handed as `handed` says. */
const callOnNewAgent = (
  callerId: string,
  taskId: string,
  handed: (typeof HANDED)[keyof typeof HANDED],
) =>
  Effect.gen(function* () {
    const started = yield* createAgent(callerId, {
      taskId,
      ...handed,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const agent = Option.getOrThrow(started).agent;

    const call = yield* insertVoiceCall({
      liveSessionId: `live-${randomUUID()}`,
      callerId,
      agentId: agent.id,
      voice: "marin",
      startedAt: STARTED_AT,
      leaseUntil: LEASE_UNTIL,
    });

    return { agent, call };
  });

/** One line said into the agent's conversation by `userId`, as a member says one on a call. */
const sayInto = (userId: string, conversationId: string) =>
  Effect.flatMap(Database, (db) =>
    db.insert(messages).values({
      userId,
      conversationId,
      seq: 1,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Fix the flaky login test.", state: "done" }],
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
      placedAt: STARTED_AT,
      finishedAt: STARTED_AT,
    }),
  );

/** Whether the agent and the task still stand. */
const standing = (agentId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const agents = yield* db.select().from(agentTable).where(eq(agentTable.id, agentId));
    const tasks = yield* db.select().from(task).where(eq(task.id, taskId));

    return { agent: agents.length > 0, task: tasks.length > 0 };
  });

it.layer(getTestDB())("the row a voice call keeps", (it) => {
  it.effect(
    "a call ending on the caller's blank agent nobody spoke to deletes the agent, and its task only where that holds nothing else",
    () =>
      Effect.gen(function* () {
        const callerId = yield* openAccount;

        // Talk on Home: the task and its agent were both made by the press.
        const untitled = yield* startTask(callerId, {});
        const fromHome = yield* callOnNewAgent(callerId, untitled.id, HANDED.BLANK);
        assert.equal(yield* endVoiceCall(callerId, fromHome.call.id), true);
        assert.deepEqual(yield* standing(fromHome.agent.id, untitled.id), {
          agent: false,
          task: false,
        });

        // Talk on a task of the member's own: the agent goes and the task stands.
        const named = yield* startTask(callerId, { name: "Invitations" });
        const onTask = yield* callOnNewAgent(callerId, named.id, HANDED.BLANK);
        yield* endVoiceCall(callerId, onTask.call.id);
        assert.deepEqual(yield* standing(onTask.agent.id, named.id), { agent: false, task: true });
      }),
  );

  it.effect(
    "a call's end leaves the agent where anybody spoke to it, it was handed work, or another call stands on it",
    () =>
      Effect.gen(function* () {
        const callerId = yield* openAccount;

        // Spoken to: the caller's first words reached it.
        const spokenTask = yield* startTask(callerId, {});
        const spoken = yield* callOnNewAgent(callerId, spokenTask.id, HANDED.BLANK);
        yield* sayInto(callerId, spoken.agent.conversationId);
        yield* endVoiceCall(callerId, spoken.call.id);
        assert.deepEqual(yield* standing(spoken.agent.id, spokenTask.id), {
          agent: true,
          task: true,
        });

        // Handed the description: an ordinary agent the call was on.
        const handedTask = yield* startTask(callerId, {});
        const handed = yield* callOnNewAgent(callerId, handedTask.id, HANDED.DESCRIPTION);
        yield* endVoiceCall(callerId, handed.call.id);
        assert.deepEqual(yield* standing(handed.agent.id, handedTask.id), {
          agent: true,
          task: true,
        });

        // Two calls on one blank agent: the first to end leaves it to the other.
        const sharedTask = yield* startTask(callerId, {});
        const first = yield* callOnNewAgent(callerId, sharedTask.id, HANDED.BLANK);

        const second = yield* insertVoiceCall({
          liveSessionId: `live-${randomUUID()}`,
          callerId,
          agentId: first.agent.id,
          voice: "marin",
          startedAt: STARTED_AT,
          leaseUntil: LEASE_UNTIL,
        });

        yield* endVoiceCall(callerId, first.call.id);
        assert.equal((yield* standing(first.agent.id, sharedTask.id)).agent, true);
        yield* endVoiceCall(callerId, second.id);
        assert.equal((yield* standing(first.agent.id, sharedTask.id)).agent, false);
      }),
  );

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
    "a teammate reads the calls standing on the agent, and no one outside its workspace",
    () =>
      Effect.gen(function* () {
        const { callerId, call, workspaceId } = yield* openCall;
        const teammate = yield* openAccount;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openAccount;

        assert.deepEqual(yield* listStandingVoiceCalls(teammate, call.agentId), [
          { id: call.id, callerId, startedAt: STARTED_AT },
        ]);

        assert.deepEqual(yield* listStandingVoiceCalls(outsider, call.agentId), []);

        yield* deleteVoiceCall(callerId, call.id);
        assert.deepEqual(yield* listStandingVoiceCalls(teammate, call.agentId), []);
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
