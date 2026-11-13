import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import {
  claimVoiceCallLease,
  insertVoiceCall,
  readVoiceCall,
} from "@repo/database/models/voice-calls";
import { agentTable } from "@repo/database/schemas/agent";
import { conversations } from "@repo/database/schemas/storage";
import { hostedUsage } from "@repo/database/schemas/usage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "@repo/database/testing";
import { LIVE_VOICE } from "@repo/features/voices";
import type { WireValue } from "@repo/wire";
import { eq } from "drizzle-orm";
import { type Cause, Effect, Fiber, Layer, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment } from "../environment.js";
import {
  recordingProductAnalytics,
  SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_VOICE_CALL_DURATION,
} from "../events/server-events.js";
import { openVoiceCaller, VOICE_CALLER_ENVIRONMENT } from "../testing/voice-callers.js";
import { LIVE_SIDEBAND_EVENT, type LiveEvent, LiveSidebands } from "./live-sideband.js";
import { VOICE_CALL_LEASE } from "./voice-call-bounds.js";
import {
  holdVoiceCall,
  VOICE_CALL_HELD,
  type VoiceCallLeaseMessage,
  VoiceCallLeaseNotPublished,
  VoiceCallLeases,
  type VoiceCallObserver,
} from "./voice-call-lease.js";

/**
 * A voice call held lease by lease over a fake GPT-Live session, on a real
 * dialect: a lease hands the call to the next with every event heard by a
 * holder, the two overlapping rather than leaving a gap; a holder whose
 * epoch was taken says nothing more and lets go; a lease that cannot hand
 * over closes the session; a crashed holder's lease, delivered again, takes
 * the call back; and the call's close deletes its row and keeps its seconds
 * once, however many holders heard it.
 *
 * Synthetic accounts and sessions throughout.
 */

const ANALYTICS = recordingProductAnalytics();

/** How many of its last events the fake session replays to a new connection, as GPT-Live replays its last few seconds. */
const REPLAYED = 2;

/** Transcript fragments, the most common event a call says. */
const SPOKEN = "session.input_transcript.delta";

/** A context append, the act a holder says to the session. */
const THINKING = "session.thinking.append";

/** One event as a holder heard it: which, and under which epoch. */
interface Heard {
  readonly eventId: string;
  readonly epoch: number;
}

/**
 * A fake GPT-Live session: what it says reaches every attached connection,
 * a new one hears its last `REPLAYED` events first, and a close it is sent
 * is answered with `session.closed` carrying the seconds given.
 */
function fakeSession(closingSeconds: number) {
  const said: LiveEvent[] = [];
  const sent: string[] = [];
  const connections = new Set<Queue.Queue<LiveEvent, Cause.Done>>();

  const say = (type: string, extra: { readonly [key: string]: WireValue } = {}) =>
    Effect.sync(() => {
      const eventId = `event_${said.length + 1}`;
      const event: LiveEvent = { type, eventId, body: { type, event_id: eventId, ...extra } };
      said.push(event);

      for (const connection of connections) Queue.offerUnsafe(connection, event);

      if (type === LIVE_SIDEBAND_EVENT.CLOSED) {
        for (const connection of connections) Queue.endUnsafe(connection);
      }

      return eventId;
    });

  const layer = Layer.succeed(LiveSidebands, {
    attach: () =>
      Effect.gen(function* () {
        const connection = yield* Queue.make<LiveEvent, Cause.Done>();

        for (const event of said.slice(-REPLAYED)) Queue.offerUnsafe(connection, event);
        connections.add(connection);
        yield* Effect.addFinalizer(() => Effect.sync(() => connections.delete(connection)));

        return {
          events: Stream.fromQueue(connection),
          send: (event: { readonly type: string }) =>
            Effect.gen(function* () {
              sent.push(event.type);

              if (event.type === LIVE_SIDEBAND_EVENT.CLOSE) {
                yield* say(LIVE_SIDEBAND_EVENT.CLOSED, { usage: { seconds: closingSeconds } });
              }
            }),
        };
      }),
  });

  return { say, sent, layer };
}

/** A queue that records what it is handed, or refuses every lease. */
const recordingLeases = (takes: boolean) =>
  Effect.map(Queue.unbounded<VoiceCallLeaseMessage>(), (published) => {
    const layer = Layer.succeed(VoiceCallLeases, {
      publish: (lease) =>
        takes
          ? Effect.asVoid(Queue.offer(published, lease))
          : Effect.fail(new VoiceCallLeaseNotPublished({ reason: "refused" })),
    });

    return { published, layer };
  });

/** An observer that hands every event it hears to the test, with the epoch it heard it under. */
const hearing = Effect.map(Queue.unbounded<Heard>(), (heard) => {
  const observe: VoiceCallObserver<never> = (event, holder) =>
    Effect.asVoid(Queue.offer(heard, { eventId: event.eventId, epoch: holder.call.leaseEpoch }));

  return { heard, observe };
});

/** The next `count` events holders heard, in any order. */
const nextHeard = (heard: Queue.Queue<Heard>, count: number) =>
  Effect.forEach(Array.from({ length: count }), () => Queue.take(heard));

/** A call opened by the route on a Claude Code agent, its row at epoch 1. */
const openCall = Effect.gen(function* () {
  const db = yield* Database;
  const callerId = yield* openVoiceCaller();
  const workspaceId = yield* openWorkspace(callerId);
  const agentId = yield* openAgentOnOwnTask(callerId, workspaceId);

  const [agent] = yield* db
    .select({ conversationId: agentTable.conversationId })
    .from(agentTable)
    .where(eq(agentTable.id, agentId));

  assert.ok(agent);
  yield* db
    .update(conversations)
    .set({ runtime: CONVERSATION_RUNTIME.CLAUDE_CODE })
    .where(eq(conversations.id, agent.conversationId));

  const call = yield* insertVoiceCall({
    liveSessionId: "live_test",
    callerId,
    agentId,
    voice: LIVE_VOICE.MARIN,
    startedAt: new Date(0),
    leaseUntil: new Date(0),
  });

  return { call, callerId, workspaceId };
});

/** The seconds on the caller's days. */
const metered = (callerId: string) =>
  Effect.flatMap(Database, (db) =>
    db
      .select({ voiceSeconds: hostedUsage.voiceSeconds })
      .from(hostedUsage)
      .where(eq(hostedUsage.userId, callerId)),
  );

const countedCalls = (callerId: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === callerId && event.name === SERVER_EVENT.VOICE_CALL)
    .map((event) => ({ workspaceId: event.workspaceId, ...event.properties }));

/** A test's world: the caller's key opened, the fake session attached, the queue recording, analytics counted. */
const world = (
  session: ReturnType<typeof fakeSession>,
  leases: { readonly layer: Layer.Layer<never> },
) =>
  Layer.mergeAll(
    Layer.succeed(HostedEnvironment, VOICE_CALLER_ENVIRONMENT),
    session.layer,
    leases.layer,
    ANALYTICS.layer,
  );

it.layer(getTestDB())("a voice call held lease by lease", (it) => {
  it.effect(
    "a lease hands the call to the next, which attaches before it lets go, every event is heard, and a close both hear keeps the seconds once",
    () =>
      Effect.gen(function* () {
        const { call, callerId, workspaceId } = yield* openCall;
        const session = fakeSession(754.5);
        const leases = yield* recordingLeases(true);
        const { heard, observe } = yield* hearing;

        yield* Effect.gen(function* () {
          const first = yield* Effect.forkChild(
            holdVoiceCall({ callId: call.id, callerId, epoch: 1, redelivered: false }, observe),
          );

          const said = [yield* session.say(SPOKEN)];
          yield* nextHeard(heard, 1);
          said.push(yield* session.say(SPOKEN));
          yield* nextHeard(heard, 1);

          // At the hand-over the next lease is published, naming the epoch this one holds.
          yield* TestClock.adjust(VOICE_CALL_LEASE.HAND_OVER_AFTER);
          const next = yield* Queue.take(leases.published);
          assert.deepEqual(next, { callId: call.id, callerId, epoch: 2 });

          // The next lease attaches while the first still listens, and hears the session's replay.
          const second = yield* Effect.forkChild(
            holdVoiceCall({ ...next, redelivered: false }, observe),
          );

          const replayed = yield* nextHeard(heard, REPLAYED);
          assert.deepEqual(replayed, [
            { eventId: said[0], epoch: 3 },
            { eventId: said[1], epoch: 3 },
          ]);

          // Both hear what is said while they overlap.
          said.push(yield* session.say(SPOKEN));
          const overlapped = yield* nextHeard(heard, 2);
          assert.deepEqual(overlapped.map((one) => one.epoch).sort(), [2, 3]);
          assert.deepEqual(
            overlapped.map((one) => one.eventId),
            [said[2], said[2]],
          );

          // Then the caller ends the call, which both hear.
          yield* session.say(LIVE_SIDEBAND_EVENT.CLOSED, { usage: { seconds: 754.5 } });
          assert.equal(yield* Fiber.join(first), VOICE_CALL_HELD.ENDED);
          assert.equal(yield* Fiber.join(second), VOICE_CALL_HELD.ENDED);
        }).pipe(Effect.provide(world(session, leases)));

        assert.equal(Option.isNone(yield* readVoiceCall(callerId, call.id)), true);
        assert.deepEqual(yield* metered(callerId), [{ voiceSeconds: 754.5 }]);
        assert.deepEqual(countedCalls(callerId), [
          {
            workspaceId,
            duration: SERVER_VOICE_CALL_DURATION.UNDER_15M,
            harness: SERVER_AGENT_HARNESS.CLAUDE_CODE,
          },
        ]);
        assert.deepEqual(session.sent, []);
      }),
  );

  it.effect("a holder whose epoch was taken says nothing more and lets go", () =>
    Effect.gen(function* () {
      const { call, callerId } = yield* openCall;
      const session = fakeSession(10);
      const leases = yield* recordingLeases(true);
      const told = yield* Queue.unbounded<boolean>();

      const observe: VoiceCallObserver<DatabaseServices> = (_event, holder) =>
        Effect.flatMap(holder.send({ type: THINKING }), (sent) =>
          Effect.asVoid(Queue.offer(told, sent)),
        );

      const held = yield* Effect.gen(function* () {
        const holder = yield* Effect.forkChild(
          holdVoiceCall({ callId: call.id, callerId, epoch: 1, redelivered: false }, observe),
        );

        yield* session.say(SPOKEN);
        assert.equal(yield* Queue.take(told), true);

        // Another lease takes the call from the epoch this one holds.
        const taken = yield* claimVoiceCallLease(call.id, 2, new Date(0));
        assert.equal(Option.isSome(taken), true);

        yield* session.say(SPOKEN);
        assert.equal(yield* Queue.take(told), false);

        return yield* Fiber.join(holder);
      }).pipe(Effect.provide(world(session, leases)));

      assert.equal(held, VOICE_CALL_HELD.STALE);
      assert.deepEqual(session.sent, [THINKING]);
      assert.equal(Option.isSome(yield* readVoiceCall(callerId, call.id)), true);
    }),
  );

  it.effect(
    "a lease that cannot publish the next one closes the session, and the close ends the call with its seconds",
    () =>
      Effect.gen(function* () {
        const { call, callerId } = yield* openCall;
        const session = fakeSession(709);
        const leases = yield* recordingLeases(false);
        const { heard, observe } = yield* hearing;

        const held = yield* Effect.gen(function* () {
          const holder = yield* Effect.forkChild(
            holdVoiceCall({ callId: call.id, callerId, epoch: 1, redelivered: false }, observe),
          );

          yield* session.say(SPOKEN);
          yield* nextHeard(heard, 1);
          yield* TestClock.adjust(VOICE_CALL_LEASE.HAND_OVER_AFTER);

          return yield* Fiber.join(holder);
        }).pipe(Effect.provide(world(session, leases)));

        assert.equal(held, VOICE_CALL_HELD.ENDED);
        assert.deepEqual(session.sent, [LIVE_SIDEBAND_EVENT.CLOSE]);
        assert.equal(Option.isNone(yield* readVoiceCall(callerId, call.id)), true);
        assert.deepEqual(yield* metered(callerId), [{ voiceSeconds: 709 }]);
      }),
  );

  it.effect(
    "a lease delivered again after its holders crashed, however many times, takes the call back, and a stale one takes nothing",
    () =>
      Effect.gen(function* () {
        const { call, callerId } = yield* openCall;
        const session = fakeSession(10);
        const leases = yield* recordingLeases(true);
        const { heard, observe } = yield* hearing;
        const lease = { callId: call.id, callerId, epoch: 1 };

        yield* Effect.gen(function* () {
          const crashed = yield* Effect.forkChild(
            holdVoiceCall({ ...lease, redelivered: false }, observe),
          );

          yield* session.say(SPOKEN);
          assert.deepEqual(
            (yield* nextHeard(heard, 1)).map((one) => one.epoch),
            [2],
          );
          yield* Fiber.interrupt(crashed);

          // The same message, come again, claims from the epoch its dead delivery took.
          const again = yield* Effect.forkChild(
            holdVoiceCall({ ...lease, redelivered: true }, observe),
          );

          assert.deepEqual(
            (yield* nextHeard(heard, 1)).map((one) => one.epoch),
            [3],
          );

          // A first delivery of a message whose epoch is long gone holds nothing.
          const stale = yield* holdVoiceCall({ ...lease, redelivered: false }, observe);
          assert.equal(stale, VOICE_CALL_HELD.STALE);

          // Its holder dies too, and the message comes a third time: the call is still taken back.
          yield* Fiber.interrupt(again);

          const third = yield* Effect.forkChild(
            holdVoiceCall({ ...lease, redelivered: true }, observe),
          );

          assert.deepEqual(
            (yield* nextHeard(heard, 1)).map((one) => one.epoch),
            [4],
          );
          yield* Fiber.interrupt(third);
        }).pipe(Effect.provide(world(session, leases)));

        const row = Option.getOrThrow(yield* readVoiceCall(callerId, call.id));
        assert.equal(row.leaseEpoch, 4);
      }),
  );
});
