/**
 * usage-queues.ts -- sandbox usage charged to the ledger and sent to Metronome through two Vercel Queues topics, as sandboxes are opened and deleted, with no sweep.
 *
 * Each open of a sandbox we bill a workspace for books a check of it
 * (`bookSandboxUsageCheck`), published before the open and delayed past the
 * sandbox's idle stop (`SANDBOX_IDLE` and `SANDBOX_USAGE_CHECK.STOP_MARGIN`);
 * an open whose check the queue did not take is refused, so no sandbox runs
 * that nothing will charge. The check's consumer reads that sandbox's
 * sessions by name and charges those that ended with their figures in
 * (`sandbox-session-charges.ts`). Where one is still up, or stopped with its
 * figures not yet answered, it books itself again `CHECK_AGAIN` on; a
 * sandbox gone took its sessions with it, which were charged as it was
 * deleted, and its check books nothing more. A check is published under its
 * sandbox's name and the span of `CHECK_AGAIN` it falls due in, so the
 * checks every open and every check again book for one sandbox fall into one
 * message a span.
 *
 * Every charge, the check's and those a delete records
 * (`endedSessionsChargedOnDelete`), publishes its ledger ids, not yet sent,
 * to the usage-sends topic, `METRONOME.INGEST_BATCH` to a message, whose
 * consumer sends them (`usage-sending.ts`): a failure Metronome may answer
 * otherwise later fails the delivery, which the queue makes again after
 * `USAGE_SEND.FAILED_AGAIN`. A send is idempotent, reading only what is still
 * unsent, so a message twice is harmless and none is keyed.
 *
 * The queues are Vercel Queues on production alone, as the daily job this
 * replaced ran there alone. A Preview's database is a branch of
 * production's, so it books and sends nothing; its deletes still charge its
 * own ledger. Anywhere else, as the local server, each message is handed in
 * this process to the same consumer, on a fiber of its own over the services
 * the queues were built on, and delivered again after a failure as the
 * queue would. A test runs with neither, publishing nothing, unless it
 * provides `UsageQueues` itself.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { causeKind, failureKind } from "@repo/runtime/effect";
import { EndedSessionsOnDelete, SANDBOX_IDLE, Sandbox, type SandboxSession } from "@repo/sandbox";
import { send } from "@vercel/queue";
import {
  Array as Arr,
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
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../queues/queue-consumer.js";
import type { BillingEnvironment } from "./billing-environment.js";
import { METRONOME } from "./metronome.js";
import { chargedSessions, figuresAwaited } from "./sandbox-session-charges.js";
import { SANDBOX_USAGE_CHECK, USAGE_SEND } from "./usage-queue-bounds.js";
import { sendUsageCharges } from "./usage-sending.js";

/** What a delivery of either queue runs against: the ledger, the sandboxes' sessions, and Metronome. */
export type UsageQueueServices =
  | DatabaseServices
  | Sandbox
  | BillingEnvironment
  | HttpClient.HttpClient;

/** A usage message the queue did not take: a check, which refuses its open, or a send, which leaves its charges unsent. */
class UsageNotPublished extends Data.TaggedError("UsageNotPublished")<{
  readonly topic: string;
  readonly reason: string;
}> {}

interface UsageQueuesService {
  /** A check of the named sandbox published, delayed by the wait given. */
  readonly check: (
    sandboxName: string,
    delay: Duration.Duration,
  ) => Effect.Effect<void, UsageNotPublished>;
  /** The ledger's charges named published to be sent. */
  readonly send: (chargeIds: readonly string[]) => Effect.Effect<void, UsageNotPublished>;
}

/** A check's message as the queue carries it: the sandbox it reads, and nothing of its workspace. */
const CheckMessageSchema = Schema.Struct({ sandboxName: Schema.String });

/** A send's message as the queue carries it: the ledger's ids, and nothing of what they cost. */
const SendMessageSchema = Schema.Struct({ chargeIds: Schema.Array(Schema.String) });

/** How long after an open its sandbox's first check comes: once it must have stopped, left idle, and had its figures answered. */
const FIRST_CHECK = Duration.sum(SANDBOX_IDLE, SANDBOX_USAGE_CHECK.STOP_MARGIN);

/** The queues that publish nothing, as a test or a Preview has them. */
const NOTHING_PUBLISHED: UsageQueuesService = {
  check: () => Effect.void,
  send: () => Effect.void,
};

/** The queues one runtime publishes usage to: none by default, as a test has them. */
export const UsageQueues = Context.Reference<UsageQueuesService>("@repo/service/UsageQueues", {
  defaultValue: () => NOTHING_PUBLISHED,
});

/** How long a check's message is kept: its delay, then `RETAINED_PAST_DUE` of deliveries again. */
function checkRetentionOf(delay: Duration.Duration): Duration.Duration {
  return Duration.sum(delay, SANDBOX_USAGE_CHECK.RETAINED_PAST_DUE);
}

/** The key a check is published under: its sandbox, and the span of `CHECK_AGAIN` it falls due in, so checks due together are one message. */
function checkKey(sandboxName: string, dueAt: number): string {
  const span = Math.floor(dueAt / Duration.toMillis(SANDBOX_USAGE_CHECK.CHECK_AGAIN));

  return JSON.stringify([sandboxName, span]);
}

/** A send to the topic, bounded by the wait given, failed as not published where it failed or stalled. */
const published = <A>(topic: string, wait: Duration.Duration, sent: () => Promise<A>) =>
  Effect.tryPromise(sent).pipe(
    Effect.timeoutOption(wait),
    Effect.mapError((failure) => new UsageNotPublished({ topic, reason: failureKind(failure) })),
    Effect.flatMap((answered) =>
      Option.isSome(answered)
        ? Effect.void
        : Effect.fail(new UsageNotPublished({ topic, reason: "the publish outlasted its bound" })),
    ),
  );

/** On Vercel: each message sent to its topic, a check delayed and keyed, a send at once. */
const vercelQueues: UsageQueuesService = {
  check: (sandboxName, delay) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      published(SANDBOX_USAGE_CHECK.TOPIC, SANDBOX_USAGE_CHECK.PUBLISH_WAIT, () =>
        send(
          SANDBOX_USAGE_CHECK.TOPIC,
          { sandboxName },
          {
            idempotencyKey: checkKey(sandboxName, now + Duration.toMillis(delay)),
            delaySeconds: Math.ceil(Duration.toSeconds(delay)),
            retentionSeconds: Math.ceil(Duration.toSeconds(checkRetentionOf(delay))),
          },
        ),
      ),
    ),
  send: (chargeIds) =>
    Effect.forEach(
      Arr.chunksOf(chargeIds, METRONOME.INGEST_BATCH),
      (batch) =>
        published(USAGE_SEND.TOPIC, USAGE_SEND.PUBLISH_WAIT, () =>
          send(
            USAGE_SEND.TOPIC,
            { chargeIds: batch },
            { retentionSeconds: Math.ceil(Duration.toSeconds(USAGE_SEND.RETENTION)) },
          ),
        ),
      { discard: true },
    ),
};

/** The charges named published to be sent, where there are any. */
const sendPublished = (chargeIds: readonly string[]) =>
  chargeIds.length === 0
    ? Effect.void
    : Effect.flatMap(UsageQueues, (queues) => queues.send(chargeIds));

/** Whether a session is still to be charged by a later check: up, or stopped with its figures not yet answered and still waited on. */
function stillOpen(session: SandboxSession, now: number): boolean {
  if (session.ended === undefined) return true;

  if (!figuresAwaited(session)) return false;
  const stoppedAt = session.stoppedAt ?? session.createdAt;

  return now - stoppedAt < Duration.toMillis(SANDBOX_USAGE_CHECK.FIGURES_AWAITED_LONGEST);
}

/**
 * One delivery of the named sandbox's check: its sessions that ended with
 * their figures in charged and their unsent charges published to be sent,
 * and the check booked again where one is still to be charged. A session
 * whose figures were waited on past `FIGURES_AWAITED_LONGEST` is logged and
 * let go. A failure is the caller's, which leaves the message to come again.
 */
export const consumeSandboxUsageCheck = (sandboxName: string) =>
  Effect.gen(function* () {
    const sessions = yield* (yield* Sandbox).sessionsOf(sandboxName);
    const now = yield* Clock.currentTimeMillis;

    const run = yield* chargedSessions(
      sessions.filter((session) => session.ended !== undefined && !figuresAwaited(session)),
    );

    yield* sendPublished(run.unsentIds);
    const open = sessions.filter((session) => stillOpen(session, now));
    const givenUp = sessions.filter(figuresAwaited).length - open.filter(figuresAwaited).length;

    if (givenUp > 0) {
      yield* Effect.logWarning(
        `sandbox sessions whose figures never came given up, uncharged: ${givenUp}`,
      );
    }

    if (open.length > 0) {
      yield* (yield* UsageQueues).check(sandboxName, SANDBOX_USAGE_CHECK.CHECK_AGAIN);
    }

    return { ...run, open: open.length };
  }).pipe(Effect.annotateLogs({ sandboxName }));

/**
 * A check of the named sandbox booked for once it must have stopped, as it
 * is opened; an open whose check the queue did not take is the caller's to
 * refuse, so no sandbox runs that nothing will charge.
 */
export const bookSandboxUsageCheck = (sandboxName: string) =>
  Effect.flatMap(UsageQueues, (queues) => queues.check(sandboxName, FIRST_CHECK));

/**
 * A message's deliveries in this process, as the queue would make them: the
 * delay slept out, then handed to the consumer, and handed again after a
 * failure until its retention has passed.
 */
const deliveredInProcess = <R>(
  delivery: Effect.Effect<unknown, unknown, R>,
  delay: Duration.Duration,
  retention: Duration.Duration,
  failedAgain: Duration.Duration,
) =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(retention);
    yield* Effect.sleep(delay);

    while (true) {
      const failed = yield* delivery.pipe(
        Effect.as(false),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.as(
                Effect.logWarning(`a usage message will be delivered again: ${causeKind(cause)}`),
                true,
              ),
        ),
      );

      if (!failed) return;
      yield* Effect.sleep(failedAgain);

      if ((yield* Clock.currentTimeMillis) >= until) return;
    }
  });

/** Off Vercel: each message delivered in this process, on a fiber of its own over the services given, its own publishes back into these queues. */
function inProcessQueues(services: Context.Context<UsageQueueServices>): UsageQueuesService {
  const queues: UsageQueuesService = {
    check: (sandboxName, delay) =>
      Effect.asVoid(
        Effect.forkDetach(
          deliveredInProcess(
            consumeSandboxUsageCheck(sandboxName),
            delay,
            checkRetentionOf(delay),
            SANDBOX_USAGE_CHECK.FAILED_AGAIN,
          ).pipe(Effect.provideContext(services), Effect.provideService(UsageQueues, queues)),
        ),
      ),
    send: (chargeIds) =>
      Effect.asVoid(
        Effect.forkDetach(
          deliveredInProcess(
            sendUsageCharges(chargeIds),
            Duration.zero,
            USAGE_SEND.RETENTION,
            USAGE_SEND.FAILED_AGAIN,
          ).pipe(Effect.provideContext(services)),
        ),
      ),
  };

  return queues;
}

/** The queues as the deployment's environment names them: Vercel's on production, none on a Preview, this process's anywhere else. */
export const usageQueuesFromEnvironment = Layer.effect(
  UsageQueues,
  Effect.gen(function* () {
    const deployment = yield* Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT));
    const named = Option.getOrUndefined(deployment);

    if (named === DEPLOYMENT_ENVIRONMENT.PRODUCTION) return vercelQueues;

    if (named === DEPLOYMENT_ENVIRONMENT.PREVIEW) return NOTHING_PUBLISHED;

    return inProcessQueues(yield* Effect.context<UsageQueueServices>());
  }).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/**
 * `EndedSessionsOnDelete` as the deployment answers it: the sessions charged
 * over the database the deployment reads and their unsent charges published
 * to be sent, a failure of either logged and let be, so a delete never waits
 * on more than the ledger's write and a publish nor fails for them. A
 * session it missed goes uncharged, since its sandbox's checks find it gone.
 */
export const endedSessionsChargedOnDelete = Layer.effect(
  EndedSessionsOnDelete,
  Effect.gen(function* () {
    const database = yield* Effect.context<DatabaseServices>();
    const queues = yield* UsageQueues;

    return (sessions: readonly SandboxSession[]) =>
      chargedSessions(sessions).pipe(
        Effect.flatMap((run) => sendPublished(run.unsentIds)),
        Effect.provideContext(database),
        Effect.provideService(UsageQueues, queues),
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `a deleted sandbox's sessions were not charged or sent: ${Cause.pretty(cause)}`,
          ),
        ),
        Effect.asVoid,
      );
  }),
);

/**
 * The check consumer's route handler over the services the function's
 * runtime handed it: each delivery acknowledged once its sandbox is read and
 * charged, one that does not decode dropped, and a failure left for the
 * queue to deliver again after `SANDBOX_USAGE_CHECK.FAILED_AGAIN`.
 */
export function sandboxUsageChecksHandler(
  services: Context.Context<UsageQueueServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const check = yield* Effect.option(Schema.decodeUnknownEffect(CheckMessageSchema)(message));

        if (Option.isNone(check)) {
          yield* Effect.logError("a sandbox-usage-checks message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        yield* consumeSandboxUsageCheck(check.value.sandboxName).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning(`a sandbox's usage check will come again: ${causeKind(cause)}`),
          ),
        );

        return QUEUE_ACKNOWLEDGED;
      }),
    SANDBOX_USAGE_CHECK.FAILED_AGAIN,
  );
}

/**
 * The send consumer's route handler over the services the function's
 * runtime handed it: each delivery acknowledged once its charges are sent or
 * set aside, one that does not decode dropped, and a failure Metronome may
 * answer otherwise later left for the queue to deliver again after
 * `USAGE_SEND.FAILED_AGAIN`.
 */
export function usageSendsHandler(
  services: Context.Context<UsageQueueServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const sent = yield* Effect.option(Schema.decodeUnknownEffect(SendMessageSchema)(message));

        if (Option.isNone(sent)) {
          yield* Effect.logError("a usage-sends message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        yield* sendUsageCharges(sent.value.chargeIds).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning(`usage will be sent again: ${causeKind(cause)}`),
          ),
        );

        return QUEUE_ACKNOWLEDGED;
      }),
    USAGE_SEND.FAILED_AGAIN,
  );
}
