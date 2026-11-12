/**
 * queue-consumer.ts -- the one promise door every Vercel Queues consumer runs its delivery's effect through.
 *
 * The queue's SDK awaits a promise handler (`handleCallback`), so a
 * consumer's effect is run here, on the services the function's runtime
 * handed over, never on a runtime of this file's own: this is the promise
 * door of the automation-runs consumer (`automation-run-consumer.ts`) and the
 * agent-turns consumer (`turn-delivery.ts`) alike; what would end it is an Effect consumer in the queue's SDK.
 *
 * A delivery whose effect succeeds answers what it asks of the queue:
 * acknowledged, or delivered again after a while, which the SDK's retry
 * hook sets as the message's visibility. One whose effect fails or dies is
 * left unacknowledged, and the queue delivers it again: after the
 * consumer's own wait where it names one, else once its lease runs out.
 */

import type { WireValue } from "@repo/wire";
import { handleCallback } from "@vercel/queue";
import { Cause, type Context, Data, Duration, Effect, Exit } from "effect";

/** A delivery acknowledged, which the queue delivers no more. */
export const QUEUE_ACKNOWLEDGED = { acknowledged: true } as const;

/** What a delivery asks of the queue once its effect has run: to be acknowledged, or delivered again after the wait given. */
export type QueueAnswer =
  | typeof QUEUE_ACKNOWLEDGED
  | { readonly acknowledged: false; readonly again: Duration.Duration };

/** A delivery asked for again, thrown to the SDK, whose retry hook reads its wait. */
class DeliveredAgain extends Data.TaggedError("DeliveredAgain")<{
  readonly afterSeconds: number;
}> {}

/** A wait as the SDK takes it: whole seconds, at least one. */
function secondsOf(wait: Duration.Duration): number {
  return Math.max(1, Math.ceil(Duration.toSeconds(wait)));
}

/**
 * A consumer's route handler over the services the function's runtime
 * handed it: each delivery's effect run there with how many times it has
 * come, its answer handed to the queue, and a failure thrown so the queue
 * delivers it again, after `failedAgain` where it is given.
 */
export function queueConsumer<R>(
  services: Context.Context<R>,
  consume: (message: WireValue, deliveryCount: number) => Effect.Effect<QueueAnswer, unknown, R>,
  failedAgain?: Duration.Duration,
): (request: Request) => Promise<Response> {
  return handleCallback<WireValue>(
    async (message, metadata) => {
      const exit = await Effect.runPromiseExitWith(services)(
        consume(message, metadata.deliveryCount),
      );

      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);

      if (!exit.value.acknowledged) {
        throw new DeliveredAgain({ afterSeconds: secondsOf(exit.value.again) });
      }
    },
    {
      retry: (error) => {
        if (error instanceof DeliveredAgain) return { afterSeconds: error.afterSeconds };

        return failedAgain === undefined ? undefined : { afterSeconds: secondsOf(failedAgain) };
      },
    },
  );
}
