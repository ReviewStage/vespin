/**
 * turn-delivery.ts -- a coding agent's queued turn handed to a runner through a queue: published once the turn is queued, its delivery consumed, and published again by the sweep where it may have been lost.
 *
 * The turn row queued for a runner is the outbox (`@repo/database`'s
 * `turn-state.ts`): no row of its own records a message. Once a write
 * leaves a turn queued, its transaction committed, the store writer tells
 * `QueuedTurnListener`, which publishes the turn on `TURN_DELIVERY.TOPIC`
 * under its id, which Queues dedupes for as long as the message is kept
 * (`TURN_DELIVERY.RETENTION`). Queues cannot join the transaction, so a
 * process that dies between the commit and the publish loses the message,
 * and the minute sweep publishes again every turn still queued past
 * `TURN_DELIVERY.REPUBLISH_AFTER` and inside its pickup deadline
 * (`republishQueuedTurns`), which Queues drops where the first publish
 * landed.
 *
 * Its consumer (`consumeTurnDelivery`) delivers at least once, so it reads
 * the turn's row first and acknowledges a turn no longer queued, gone,
 * running, settled, or failed, without acting. A turn still queued is handed
 * over once by the harness its agent runs on (`runtime-sessions.ts`'s
 * `turnHandedOver`): where a runner is up to read its lines, its delivery
 * comes once more after `TURN_DELIVERY.TAKE_GRACE`, which finds the turn
 * running where the runner took its line, and else launches the runner
 * again; where none is up, the place opened, as a Start's first turn finds
 * it, or resumed, and the runner launched for them, and acknowledged; a
 * hand-over that cannot succeed fails the turn with why through the store
 * writer, and is acknowledged. Where another call holds the agent's runner
 * lease, at work on its runner, the delivery comes again after
 * `TURN_DELIVERY.BUSY_AGAIN`, and one whose store or machine was
 * unreachable fails, and comes again after `TURN_DELIVERY.FAILED_AGAIN`.
 * Past that the turn is the runner's own events' and its deadlines': the
 * runner's take starts it, a launch's failed END fails it, and a runner
 * that dies before it takes the line leaves it to the sweep's reap at its
 * pickup deadline. A runner that ends with the line untaken has its END
 * publish the turn again (`../native-events/runner-events-app.ts`), not
 * under its id, which Queues would drop as the first's.
 *
 * The queue is Vercel Queues on production and on a Preview, each message
 * pinned to the deployment that published it. Anywhere else, as the local
 * server (`apps/web/scripts/local-server.ts`), there is no queue: each
 * message is handed in this process to the same consumer, on a fiber of its
 * own, and delivered again after the wait it asks for, so a send there
 * reaches a runner as it does on Vercel.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { turnStatusOf, turnsAwaitingRunner } from "@repo/database/models/turn-state";
import { type QueuedAgentTurn, QueuedTurnListener } from "@repo/database/models/writer";
import { causeKind, failureKind } from "@repo/runtime/effect";
import { TURN_STATUS } from "@repo/wire";
import { send } from "@vercel/queue";
import {
  Cause,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../../auth/auth-deployment.js";
import {
  QUEUE_ACKNOWLEDGED,
  type QueueAnswer,
  queueConsumer,
} from "../../queues/queue-consumer.js";
import { agentLogIds } from "./agent-log.js";
import { TURN_HANDOVER, turnHandedOver } from "./runtime-sessions.js";
import { TURN_DELIVERY } from "./turn-delivery-bounds.js";

/** A turn's message: the account its agent runs for, the conversation, and the turn. */
const turnMessageSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  turnId: Schema.String,
});

const decodeTurnMessage = Schema.decodeUnknownEffect(turnMessageSchema);

/** How a turn is published: under its id, which Queues dedupes, as its queueing and the sweep publish it; or as an event of its own, as a launch's end publishes it again. */
export const TURN_PUBLISH = {
  KEYED: "keyed",
  UNKEYED: "unkeyed",
} as const;

type TurnPublish = (typeof TURN_PUBLISH)[keyof typeof TURN_PUBLISH];

export interface TurnQueueShape {
  /** The turn handed on to be delivered to a runner, as `how` says; a publish that fails is said in the log, and the sweep publishes the turn again. */
  readonly publish: (
    turn: QueuedAgentTurn,
    how: TurnPublish,
  ) => Effect.Effect<void, never, DatabaseServices>;
}

/** A delivery acknowledged no more until the wait given has passed. */
function deliveredAgainAfter(again: Duration.Duration): QueueAnswer {
  return { acknowledged: false, again };
}

/**
 * One delivery of a turn's message, as the header says: acknowledged where
 * the turn no longer stands queued or once its hand-over is made, delivered
 * again shortly where the agent's runner lease is held, and failed for the
 * queue to deliver again where its store or machine was unreachable.
 */
export const consumeTurnDelivery = /* @__PURE__ */ Effect.fn("web/consumeTurnDelivery")(function* (
  message: unknown,
): Effect.fn.Return<QueueAnswer, unknown, DatabaseServices> {
  const delivered = yield* Effect.option(decodeTurnMessage(message));

  if (Option.isNone(delivered)) {
    yield* Effect.logError("an agent-turns message did not decode; it is dropped");

    return QUEUE_ACKNOWLEDGED;
  }

  const turn = delivered.value;

  return yield* Effect.gen(function* () {
    const status = yield* turnStatusOf(turn.conversationId, turn.turnId);

    if (!Option.contains(status, TURN_STATUS.QUEUED)) return QUEUE_ACKNOWLEDGED;
    const handover = yield* turnHandedOver(turn);

    if (handover === TURN_HANDOVER.BUSY) return deliveredAgainAfter(TURN_DELIVERY.BUSY_AGAIN);

    if (handover === TURN_HANDOVER.AWAITED) return deliveredAgainAfter(TURN_DELIVERY.TAKE_GRACE);

    if (handover === TURN_HANDOVER.UNREACHED) {
      yield* Effect.logWarning("a queued turn's agent was not reached, so nothing was handed over");
    }

    return QUEUE_ACKNOWLEDGED;
  }).pipe(Effect.annotateLogs({ ...agentLogIds(turn), turnId: turn.turnId }));
});

/** The publish's options: kept for the turn's pickup window, under the turn's id where it is keyed. */
function sendOptions(turn: QueuedAgentTurn, how: TurnPublish) {
  const retentionSeconds = Math.ceil(Duration.toSeconds(TURN_DELIVERY.RETENTION));

  return how === TURN_PUBLISH.KEYED
    ? { retentionSeconds, idempotencyKey: turn.turnId }
    : { retentionSeconds };
}

/**
 * On Vercel: the turn sent to the topic, pinned to this deployment, as the
 * SDK pins every send, waited on at most `TURN_DELIVERY.PUBLISH_WAIT`. A
 * send that failed or was given up is said in the log: a keyed one is
 * published again by the sweep, and an unkeyed one, a launch's end's, leaves
 * the turn to the delivery its keyed publish already made, and else to the
 * sweep's reap at its pickup deadline.
 */
const VERCEL_TURN_QUEUE: TurnQueueShape = {
  publish: (turn, how) =>
    Effect.tryPromise(() =>
      send(
        TURN_DELIVERY.TOPIC,
        { userId: turn.userId, conversationId: turn.conversationId, turnId: turn.turnId },
        sendOptions(turn, how),
      ),
    ).pipe(
      Effect.timeoutOption(TURN_DELIVERY.PUBLISH_WAIT),
      Effect.flatMap((sent) =>
        Option.isSome(sent)
          ? Effect.void
          : Effect.logWarning("a queued turn's publish outlasted its bound and was given up"),
      ),
      Effect.catch((failure) =>
        Effect.logWarning(`a queued turn was not published: ${failureKind(failure)}`),
      ),
      Effect.annotateLogs({ ...agentLogIds(turn), turnId: turn.turnId }),
    ),
};

/** The publisher's services as a delivery of its own runs on them: outside any transaction the publish ran inside, which has ended by then. */
const outsideTransaction = Effect.flatMap(SqlClient.SqlClient, (client) =>
  Effect.map(Effect.context<DatabaseServices>(), Context.omit(client.transactionService)),
);

/**
 * A message's deliveries in this process, as the queue would make them:
 * each handed to the consumer, and delivered again after the wait it asks
 * for, or a failure's, until it is acknowledged or its retention has passed.
 */
const deliveredInProcess = (turn: QueuedAgentTurn, until: number) =>
  Effect.gen(function* () {
    while (true) {
      const answer = yield* consumeTurnDelivery(turn).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.as(
                Effect.logWarning(`a queued turn's delivery will come again: ${causeKind(cause)}`),
                deliveredAgainAfter(TURN_DELIVERY.FAILED_AGAIN),
              ),
        ),
      );

      if (answer.acknowledged) return;
      yield* Effect.sleep(answer.again);

      if ((yield* Clock.currentTimeMillis) >= until) return;
    }
  });

/**
 * Off Vercel: each message delivered in this process, on a fiber of its own
 * over the publisher's services. A keyed publish of a turn whose message is
 * still kept is dropped, as Queues drops it.
 */
function inProcessTurnQueue(): TurnQueueShape {
  const kept = new Map<string, number>();

  return {
    publish: (turn, how) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        for (const [turnId, until] of kept) if (until <= now) kept.delete(turnId);

        if (how === TURN_PUBLISH.KEYED && kept.has(turn.turnId)) return;
        const until = now + Duration.toMillis(TURN_DELIVERY.RETENTION);

        if (how === TURN_PUBLISH.KEYED) kept.set(turn.turnId, until);
        const services = yield* outsideTransaction;
        yield* Effect.forkDetach(
          deliveredInProcess(turn, until).pipe(Effect.provideContext(services)),
        );
      }),
  };
}

/** The queue one runtime has: Vercel's where the runtime provides it, this process's otherwise. */
export const TurnQueue = Context.Reference<TurnQueueShape>("@repo/service/TurnQueue", {
  defaultValue: inProcessTurnQueue,
});

/** The queue as the deployment's environment names it: Vercel's on production and on a Preview, this process's anywhere else. */
export const turnQueueFromEnvironment = Layer.effect(
  TurnQueue,
  Effect.map(Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)), (deployment) =>
    Option.exists(
      deployment,
      (named) =>
        named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
    )
      ? VERCEL_TURN_QUEUE
      : inProcessTurnQueue(),
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/** The store writer's listener for the turns it leaves queued: each published under its id. */
export const queuedTurnListener = Layer.succeed(QueuedTurnListener, {
  heard: (turn) =>
    Effect.gen(function* () {
      const queue = yield* TurnQueue;
      yield* queue.publish(turn, TURN_PUBLISH.KEYED);
    }),
});

/**
 * The turns still queued past `TURN_DELIVERY.REPUBLISH_AFTER` and inside
 * their pickup deadline published again under their ids, a sweep's worth,
 * answering how many.
 */
export const republishQueuedTurns = /* @__PURE__ */ Effect.fn("web/republishQueuedTurns")(
  function* (now: number) {
    const queue = yield* TurnQueue;
    const queuedBefore = new Date(now - Duration.toMillis(TURN_DELIVERY.REPUBLISH_AFTER));

    const turns = yield* turnsAwaitingRunner(
      queuedBefore,
      new Date(now),
      TURN_DELIVERY.REPUBLISH_LIMIT,
    );

    yield* Effect.forEach(turns, (turn) => queue.publish(turn, TURN_PUBLISH.KEYED), {
      concurrency: TURN_DELIVERY.REPUBLISH_CONCURRENCY,
      discard: true,
    });

    return turns.length;
  },
);

/**
 * The consumer's route handler over the services the function's runtime
 * handed it, its native harnesses among them: each delivery consumed, a
 * failure said in the log and left for the queue to deliver again.
 */
export function agentTurnsHandler(
  services: Context.Context<DatabaseServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      consumeTurnDelivery(message).pipe(
        Effect.tapCause((cause) =>
          Effect.logWarning(`a queued turn's delivery will come again: ${causeKind(cause)}`),
        ),
      ),
    TURN_DELIVERY.FAILED_AGAIN,
  );
}
