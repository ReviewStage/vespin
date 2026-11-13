/**
 * voice-call-lease.ts -- a voice call held from the service: one lease at a time attached to the call's GPT-Live session over its sideband, each handing the call to the next, until the session closes.
 *
 * A call's logic lives here, never in a client, which carries only audio.
 * The route opens the call at lease epoch 1 and publishes its first lease
 * (`voice-procedures.ts`); each lease is a message naming the call and the
 * epoch its holder must claim from. A delivery attaches to the session
 * first and only then claims the lease, a compare-and-set from that epoch to
 * the next (`@repo/database/models/voice-calls`), so of two claims on one
 * epoch exactly one holds, and the loser lets go having done nothing.
 *
 * The lease is held for as long as one function may run
 * (`voice-call-bounds.ts`). Before that runs out the holder publishes the
 * next lease, naming its own epoch, and holds on until its let-go, so the
 * next one attaches and claims while it still listens: the session replays
 * its last few seconds to a new connection, and the two overlap, so no event
 * is lost across the hand-over. Events are handed on at least once rather
 * than exactly once, since neither holder can know where the other stopped,
 * and nor can a lease redelivered after a crash: so everything a holder
 * writes is written under a key of the event's own, and everything it says
 * to the session is fenced by its epoch (`VoiceCallHolder.send`), read just
 * before it is sent. A holder whose fence fails has lost the call and lets
 * go at once.
 *
 * The call ends when the session says it closed: the caller's panel sends
 * `session.close`, the session ends on its own, or a lease that could not
 * publish its successor closes it, the one time the service says it, so no
 * call runs on with nothing holding it. Every holder that hears the close
 * deletes the call's row, and the one whose delete took it keeps the call's
 * seconds, as GPT-Live counted them, on the caller's day and counts the call
 * once, so they are kept exactly once.
 *
 * A holder that crashed is the queue's to recover, with no heartbeat and no
 * sweep: the queue renews a delivery's visibility while its handler runs, so
 * a lease delivered again is one whose earlier delivery died, and that dead
 * delivery may have claimed already, however many times it came before. So
 * a redelivery claims from the epoch the call stands at, whoever took it:
 * where that is a successor the dead holder published before it died, the
 * successor loses the call and lets go at its next fenced act, so one lease
 * still acts at a time. A sideband that drops with no close fails the
 * delivery the same way; one that will not attach for now fails it before
 * it claims anything.
 *
 * The driver (`holdVoiceCall`) names nothing of Functions: it takes a lease
 * and runs until it hands over or the call ends, so a longer-lived host can
 * run it. The queue is Vercel Queues on production and on a Preview;
 * anywhere else, as the local server, each lease is delivered in this
 * process on a fiber of its own, as the queue would deliver it.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readAgentRouting, readVisibleAgentWorkspace } from "@repo/database/models/agent-store";
import { PROVIDER_KEY_UNREADABLE } from "@repo/database/models/provider-key-seal";
import { spendVoiceMeter } from "@repo/database/models/quota";
import {
  claimVoiceCallLease,
  deleteVoiceCall,
  readVoiceCall,
  type VoiceCallRow,
} from "@repo/database/models/voice-calls";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { causeKind, failureKind } from "@repo/runtime/effect";
import { readEither } from "@repo/wire/effect";
import { send } from "@vercel/queue";
import {
  Cause,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  type Redacted,
  Result,
  Schema,
  Stream,
} from "effect";
import { ownApiKeyOf } from "../accounts/own-api-key.js";
import { harnessOf } from "../agents/coder-host/native-runtime.js";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { EXCESS_KEYS, unparsedWire } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { recordServerEventIn, SERVER_EVENT, voiceCallDurationOf } from "../events/server-events.js";
import { logStoreFailure } from "../http/store-failure.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../queues/queue-consumer.js";
import {
  closedSeconds,
  LIVE_SIDEBAND_EVENT,
  type LiveEvent,
  LiveSidebands,
  sessionGone,
} from "./live-sideband.js";
import { VOICE_CALL_LEASE } from "./voice-call-bounds.js";

const MS_PER_SECOND = 1_000;

/** What a lease's delivery runs against: the store, and the deployment's environment the caller's key is opened under. */
export type VoiceCallLeaseServices = DatabaseServices | HostedEnvironment;

/** How a lease ended. */
export const VOICE_CALL_HELD = {
  /** It published the next lease and let go at its let-go. */
  HANDED_OVER: "handed-over",
  /** The session said it closed while this lease held it. */
  ENDED: "ended",
  /** It could not publish the next lease, and closed the session. */
  CLOSED: "closed",
  /** Another lease held the call before this one could claim it, or took it since. */
  STALE: "stale",
  /** The call was over before this lease came: its row gone, or its session no longer there. */
  GONE: "gone",
} as const;

export type VoiceCallHeld = (typeof VOICE_CALL_HELD)[keyof typeof VOICE_CALL_HELD];

/** One lease as its message names it: the call, its caller, and the epoch to claim from. */
const VoiceCallLeaseMessageSchema = Schema.Struct({
  callId: Schema.String,
  callerId: Schema.String,
  epoch: Schema.Int,
});

export type VoiceCallLeaseMessage = typeof VoiceCallLeaseMessageSchema.Type;

/** One delivery of a lease: its message, and whether the queue brought it before. */
export interface VoiceCallLease extends VoiceCallLeaseMessage {
  readonly redelivered: boolean;
}

/** The call as one lease holds it, and what that lease may say to the session. */
export interface VoiceCallHolder {
  /** The call's row as this lease claimed it, under the epoch it holds. */
  readonly call: VoiceCallRow;
  /** The event sent where this lease still holds the call, read just before; whether it was. A holder told no lets go. */
  readonly send: (event: {
    readonly type: string;
  }) => Effect.Effect<boolean, StoreFailure, DatabaseServices>;
}

/** What a holder does with each event the session says before it closes: at least once, under a key of the event's own. */
export type VoiceCallObserver<R> = (
  event: LiveEvent,
  holder: VoiceCallHolder,
) => Effect.Effect<void, StoreFailure, R>;

/** A lease's message the queue did not take. */
export class VoiceCallLeaseNotPublished extends Data.TaggedError("VoiceCallLeaseNotPublished")<{
  readonly reason: string;
}> {}

/** The sideband closed with no word of the session's close, so the call is unheld until the lease comes again. */
class SidebandDropped extends Data.TaggedError("SidebandDropped") {}

/** The sideband would not attach for now, so the lease comes again. */
class SidebandUnattached extends Data.TaggedError("SidebandUnattached")<{
  readonly status: number | undefined;
}> {}

interface VoiceCallLeasesService {
  /** The lease's message published, or why the queue did not take it. */
  readonly publish: (
    lease: VoiceCallLeaseMessage,
  ) => Effect.Effect<void, VoiceCallLeaseNotPublished, VoiceCallLeaseServices>;
}

/** An observer that does nothing with what it hears: the call is held, handed over, and ended, and nothing more. */
export const observeNothing: VoiceCallObserver<never> = () => Effect.void;

/**
 * The call's row deleted, and, where this delete is the one that took it,
 * its seconds kept on the caller's day and the call counted once, by its
 * length and the agent's harness, in the agent's workspace. A meter the
 * store refused is logged and the call still counted, as dictation's is.
 */
const endCall = Effect.fnUntraced(function* (
  call: VoiceCallRow,
  seconds: Option.Option<number>,
): Effect.fn.Return<void, StoreFailure, DatabaseServices> {
  const deleted = yield* deleteVoiceCall(call.callerId, call.id);

  if (!deleted || Option.isNone(seconds)) return;
  const now = yield* Clock.currentTimeMillis;

  yield* spendVoiceMeter({ userId: call.callerId, seconds: seconds.value, now }).pipe(
    Effect.catch(logStoreFailure),
  );

  const routing = yield* readAgentRouting(call.callerId, call.agentId).pipe(
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), Option.none())),
  );

  const harness = Option.flatMapNullishOr(routing, (agent) => harnessOf(agent.runtime));

  // Note that a call whose agent is gone, or ended for good, is metered but not counted, since it has no harness to count it by.
  if (Option.isNone(harness)) return;

  yield* recordServerEventIn(
    SERVER_EVENT.VOICE_CALL,
    call.callerId,
    readVisibleAgentWorkspace(call.callerId, call.agentId),
    { duration: voiceCallDurationOf(seconds.value * MS_PER_SECOND), harness: harness.value },
  );
});

/** The caller's own OpenAI key the session was opened on; none where they no longer have one this deployment can open. */
const callerKey = Effect.fnUntraced(function* (callerId: string) {
  const environment = yield* HostedEnvironment;
  const key = yield* ownApiKeyOf(callerId, PROVIDER_KEY_PROVIDER.OPENAI, environment);

  return key === undefined || key === PROVIDER_KEY_UNREADABLE
    ? Option.none<Redacted.Redacted>()
    : Option.some(key);
});

/** The lease claimed until the function's limit: from the epoch the message names, or, for a redelivery, from the one the call stands at. */
const claimLease = Effect.fnUntraced(function* (
  lease: VoiceCallLease,
  standing: VoiceCallRow,
  startedAt: number,
) {
  const until = new Date(startedAt + VOICE_CALL_LEASE.MAX_DURATION_SECONDS * MS_PER_SECOND);
  const epoch = lease.redelivered ? standing.leaseEpoch : lease.epoch;

  return yield* claimVoiceCallLease(lease.callId, epoch, until);
});

/** Sleeps until `at` on the clock, a lease's own deadline. */
const sleepUntil = (at: number) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.sleep(Duration.millis(Math.max(0, at - now))),
  );

/** The queue one runtime publishes leases to: this process's by default, as a test or a local run has it. */
export const VoiceCallLeases = Context.Reference<VoiceCallLeasesService>(
  "@repo/service/VoiceCallLeases",
  { defaultValue: () => ({ publish: inProcessPublish }) },
);

/**
 * One lease held: attached, claimed, and then the session's events handed to
 * `observe` until the call ends, the lease hands over, or another lease
 * takes the call. A failure is the caller's, which leaves the lease to come
 * again.
 */
export const holdVoiceCall = Effect.fn("voice/holdVoiceCall")(function* <R>(
  lease: VoiceCallLease,
  observe: VoiceCallObserver<R>,
): Effect.fn.Return<
  VoiceCallHeld,
  StoreFailure | SidebandDropped | SidebandUnattached,
  VoiceCallLeaseServices | R
> {
  const startedAt = yield* Clock.currentTimeMillis;
  const standing = yield* readVoiceCall(lease.callerId, lease.callId);

  if (Option.isNone(standing)) return VOICE_CALL_HELD.GONE;
  const key = yield* callerKey(lease.callerId);

  // Note that a session no key opens is one no lease can hold or close, so the call is over for the service.
  if (Option.isNone(key)) {
    yield* Effect.logWarning("a voice call's key can no longer be opened; the call is let go");
    yield* endCall(standing.value, Option.none());

    return VOICE_CALL_HELD.GONE;
  }

  const sidebands = yield* LiveSidebands;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      // Attached before claiming, so the lease this one takes over from still listens while it comes.
      const attached = yield* Effect.result(
        sidebands.attach(standing.value.liveSessionId, key.value),
      );

      // Note that an attach that may pass later claims nothing, so the lease comes again at the epoch it names.
      if (Result.isFailure(attached) && !sessionGone(attached.failure)) {
        return yield* new SidebandUnattached({ status: attached.failure.status });
      }

      const claimed = yield* claimLease(lease, standing.value, startedAt);

      if (Option.isNone(claimed)) return VOICE_CALL_HELD.STALE;
      const call = claimed.value;

      if (Result.isFailure(attached)) {
        // The session closed while no lease listened, so its seconds were never heard.
        yield* endCall(call, Option.none());

        return VOICE_CALL_HELD.GONE;
      }

      const sideband = attached.success;
      let lost = false;

      const holder: VoiceCallHolder = {
        call,
        send: (event) =>
          Effect.gen(function* () {
            const now = yield* readVoiceCall(call.callerId, call.id);
            const holds = Option.exists(now, (row) => row.leaseEpoch === call.leaseEpoch);

            if (!holds) {
              lost = true;

              return false;
            }

            yield* sideband.send(event);

            return true;
          }),
      };

      const listened = Effect.gen(function* () {
        let seconds = Option.none<number>();
        let closed = false;

        yield* Stream.runForEachWhile(sideband.events, (event) => {
          if (event.type !== LIVE_SIDEBAND_EVENT.CLOSED) {
            return Effect.map(observe(event, holder), () => !lost);
          }

          closed = true;
          seconds = closedSeconds(event);

          return Effect.succeed(false);
        });

        if (closed) {
          yield* endCall(call, seconds);

          return VOICE_CALL_HELD.ENDED;
        }

        if (lost) return VOICE_CALL_HELD.STALE;

        return yield* new SidebandDropped();
      });

      const held = Effect.gen(function* () {
        yield* sleepUntil(startedAt + Duration.toMillis(VOICE_CALL_LEASE.HAND_OVER_AFTER));
        const leases = yield* VoiceCallLeases;

        const published = yield* Effect.result(
          leases.publish({ callId: call.id, callerId: call.callerId, epoch: call.leaseEpoch }),
        );

        if (Result.isSuccess(published)) {
          yield* sleepUntil(startedAt + Duration.toMillis(VOICE_CALL_LEASE.LET_GO_AFTER));

          return VOICE_CALL_HELD.HANDED_OVER;
        }

        // Note that a call no lease will hold next is closed, so it never runs on the caller's key unheld.
        yield* Effect.logWarning(
          `a voice call's next lease was not published (${published.failure.reason}); the call is closed`,
        );

        if (!(yield* holder.send({ type: LIVE_SIDEBAND_EVENT.CLOSE }))) {
          return VOICE_CALL_HELD.STALE;
        }

        // The close the session confirms ends the call where it is heard; one it never confirms ends it here, with no seconds heard.
        yield* Effect.sleep(VOICE_CALL_LEASE.CLOSE_WAIT);
        yield* endCall(call, Option.none());

        return VOICE_CALL_HELD.CLOSED;
      });

      return yield* Effect.raceFirst(listened, held);
    }),
  );
});

/** One delivery of a lease, as the queue hands its message, held with nothing observed beyond the call's end. */
// PROBE (temporary, reverted before merge): each event's type, id, and timing fields, never its words.
const ProbeFieldsSchema = Schema.Struct({
  offset_ms: Schema.optional(Schema.Number),
  start_ms: Schema.optional(Schema.Number),
  end_ms: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  usage: Schema.optional(Schema.Struct({ seconds: Schema.Number })),
  client_event_id: Schema.optional(Schema.String),
});

const ProbePublishedSchema = Schema.Struct({ publishedAt: Schema.Number });

const probeObserver: VoiceCallObserver<never> = (event, holder) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    const read = readEither(ProbeFieldsSchema, { excess: EXCESS_KEYS.DROP })(
      unparsedWire(event.body),
    );

    const fields = Result.isSuccess(read) ? read.success : {};

    yield* Effect.logInfo(
      `voice-probe event ${JSON.stringify({ at: now, epoch: holder.call.leaseEpoch, type: event.type, id: event.eventId, ...fields })}`,
    );
  });

const consumeVoiceCallLease = (lease: VoiceCallLease) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(
      `voice-probe delivered ${JSON.stringify({ at: yield* Clock.currentTimeMillis, epoch: lease.epoch, redelivered: lease.redelivered })}`,
    );

    const held = yield* holdVoiceCall(lease, probeObserver);

    yield* Effect.logInfo(
      `voice-probe held ${JSON.stringify({ at: yield* Clock.currentTimeMillis, epoch: lease.epoch, held })}`,
    );

    return held;
  }).pipe(Effect.annotateLogs({ callId: lease.callId, epoch: lease.epoch }));

/** On Vercel: the message sent to the topic; a send that failed or stalled is not published. */
const vercelPublish = (lease: VoiceCallLeaseMessage) =>
  Effect.tryPromise(() => send(VOICE_CALL_LEASE.TOPIC, { ...lease, publishedAt: Date.now() })).pipe(
    Effect.timeoutOption(VOICE_CALL_LEASE.PUBLISH_WAIT),
    Effect.mapError((failure) => new VoiceCallLeaseNotPublished({ reason: failureKind(failure) })),
    Effect.flatMap((sent) =>
      Option.isSome(sent)
        ? Effect.void
        : Effect.fail(
            new VoiceCallLeaseNotPublished({ reason: "the publish outlasted its bound" }),
          ),
    ),
  );

/**
 * A lease's deliveries in this process, as the queue would make them:
 * handed to the driver, and handed again after a failure, marked as come
 * before, until a lease's let-go has passed since the first.
 */
const deliveredInProcess = (message: VoiceCallLeaseMessage) =>
  Effect.gen(function* () {
    const until =
      (yield* Clock.currentTimeMillis) + Duration.toMillis(VOICE_CALL_LEASE.LET_GO_AFTER);

    let redelivered = false;

    while (true) {
      const failed = yield* consumeVoiceCallLease({ ...message, redelivered }).pipe(
        Effect.as(false),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.as(
                Effect.logWarning(
                  `a voice call's lease will be delivered again: ${causeKind(cause)}`,
                ),
                true,
              ),
        ),
      );

      if (!failed) return;
      yield* Effect.sleep(VOICE_CALL_LEASE.FAILED_AGAIN);
      redelivered = true;

      if ((yield* Clock.currentTimeMillis) >= until) return;
    }
  });

/** Off Vercel: the lease delivered in this process, on a fiber of its own over the publisher's services. */
function inProcessPublish(
  message: VoiceCallLeaseMessage,
): Effect.Effect<void, never, VoiceCallLeaseServices> {
  return Effect.gen(function* () {
    const services = yield* Effect.context<VoiceCallLeaseServices>();
    yield* Effect.forkDetach(deliveredInProcess(message).pipe(Effect.provideContext(services)));
  });
}

/** The queue as the deployment's environment names it: Vercel's on production and on a Preview, this process's anywhere else. */
export const voiceCallLeasesFromEnvironment = Layer.effect(
  VoiceCallLeases,
  Effect.map(
    Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
    (deployment): VoiceCallLeasesService => ({
      publish: Option.exists(
        deployment,
        (named) =>
          named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
      )
        ? vercelPublish
        : inProcessPublish,
    }),
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery held to its end and acknowledged, one that does
 * not decode dropped, and a failure left for the queue to deliver again
 * after `VOICE_CALL_LEASE.FAILED_AGAIN`.
 */
export function voiceCallLeasesHandler(
  services: Context.Context<VoiceCallLeaseServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message, deliveryCount) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.option(
          Schema.decodeUnknownEffect(VoiceCallLeaseMessageSchema)(message),
        );

        if (Option.isNone(decoded)) {
          yield* Effect.logError("a voice-calls message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        // PROBE: queue latency, from the publish to this delivery.
        const published = yield* Effect.option(
          Schema.decodeUnknownEffect(ProbePublishedSchema)(message),
        );

        const latency = Option.map(published, ({ publishedAt }) => Date.now() - publishedAt);

        yield* Effect.logInfo(
          `voice-probe latency ${JSON.stringify({ ms: Option.getOrNull(latency), deliveryCount })}`,
        );

        yield* consumeVoiceCallLease({ ...decoded.value, redelivered: deliveryCount > 1 }).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning(`a voice call's lease will be delivered again: ${causeKind(cause)}`),
          ),
        );

        return QUEUE_ACKNOWLEDGED;
      }),
    VOICE_CALL_LEASE.FAILED_AGAIN,
  );
}
