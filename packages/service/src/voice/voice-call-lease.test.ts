import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { claimVoiceCallLease, readVoiceCall } from "@repo/database/models/voice-calls";
import { hostedUsage } from "@repo/database/schemas/usage";
import { getTestDB } from "@repo/database/testing";
import { memorySandbox } from "@repo/sandbox/testing";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Option, Queue } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment } from "../environment.js";
import {
  recordingProductAnalytics,
  SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_VOICE_CALL_DURATION,
} from "../events/server-events.js";
import { githubReaching } from "../testing/github-app-fake.js";
import {
  fakeLiveSession,
  LIVE_REPLAYED,
  openVoiceCall,
  VOICE_CALLER_ENVIRONMENT,
} from "../testing/voice-callers.js";
import { LIVE_SIDEBAND_EVENT } from "./live-sideband.js";
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

/** Transcript fragments, the most common event a call says. */
const SPOKEN = "session.input_transcript.delta";

/** A context append, the act a holder says to the session. */
const THINKING = "session.thinking.append";

/** One event as a holder heard it: which, and under which epoch. */
interface Heard {
  readonly eventId: string;
  readonly epoch: number;
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
  const observe: VoiceCallObserver<never> = (holder) =>
    Effect.succeed({
      observe: (event) =>
        Effect.asVoid(
          Queue.offer(heard, { eventId: event.eventId, epoch: holder.call.leaseEpoch }),
        ),
      beside: Effect.never,
    });

  return { heard, observe };
});

/** The next `count` events holders heard, in any order. */
const nextHeard = (heard: Queue.Queue<Heard>, count: number) =>
  Effect.forEach(Array.from({ length: count }), () => Queue.take(heard));

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
  session: ReturnType<typeof fakeLiveSession>,
  leases: { readonly layer: Layer.Layer<never> },
) =>
  Layer.mergeAll(
    Layer.succeed(HostedEnvironment, VOICE_CALLER_ENVIRONMENT),
    session.layer,
    leases.layer,
    ANALYTICS.layer,
  );

/** The store, and what a holder's sends to the agent reach, which no case here makes. */
const SUITE = Layer.mergeAll(getTestDB(), githubReaching([]).layer, memorySandbox().layer);

it.layer(SUITE)("a voice call held lease by lease", (it) => {
  it.effect(
    "a lease hands the call to the next, which attaches before it lets go, every event is heard, and a close both hear keeps the seconds once",
    () =>
      Effect.gen(function* () {
        const { call, callerId, workspaceId } = yield* openVoiceCall;
        const session = fakeLiveSession(754.5);
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

          const replayed = yield* nextHeard(heard, LIVE_REPLAYED);
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
      const { call, callerId } = yield* openVoiceCall;
      const session = fakeLiveSession(10);
      const leases = yield* recordingLeases(true);
      const told = yield* Queue.unbounded<boolean>();

      const observe: VoiceCallObserver<DatabaseServices> = (holder) =>
        Effect.succeed({
          observe: () =>
            Effect.flatMap(holder.send({ type: THINKING }), (sent) =>
              Effect.asVoid(Queue.offer(told, sent)),
            ),
          beside: Effect.never,
        });

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
        const { call, callerId } = yield* openVoiceCall;
        const session = fakeLiveSession(709);
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
    "a lease whose close goes unconfirmed leaves the call to a lease that took it meanwhile",
    () =>
      Effect.gen(function* () {
        const { call, callerId } = yield* openVoiceCall;
        const session = fakeLiveSession(undefined);
        const leases = yield* recordingLeases(false);
        const { heard, observe } = yield* hearing;

        const held = yield* Effect.gen(function* () {
          const holder = yield* Effect.forkChild(
            holdVoiceCall({ callId: call.id, callerId, epoch: 1, redelivered: false }, observe),
          );

          yield* session.say(SPOKEN);
          yield* nextHeard(heard, 1);
          yield* TestClock.adjust(VOICE_CALL_LEASE.HAND_OVER_AFTER);
          yield* Deferred.await(session.askedToClose);

          // Another lease takes the call while this one waits on a close the session never confirms.
          const taken = yield* claimVoiceCallLease(call.id, 2, new Date(0));
          assert.equal(Option.isSome(taken), true);
          yield* TestClock.adjust(VOICE_CALL_LEASE.CLOSE_WAIT);

          return yield* Fiber.join(holder);
        }).pipe(Effect.provide(world(session, leases)));

        assert.equal(held, VOICE_CALL_HELD.STALE);
        assert.equal(Option.isSome(yield* readVoiceCall(callerId, call.id)), true);
      }),
  );

  it.effect(
    "a lease delivered again after its holders crashed, however many times, takes the call back, and a stale one takes nothing",
    () =>
      Effect.gen(function* () {
        const { call, callerId } = yield* openVoiceCall;
        const session = fakeLiveSession(10);
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
