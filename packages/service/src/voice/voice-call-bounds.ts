/**
 * voice-call-bounds.ts -- the voice-calls queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the other
 * consumers' (`agent-wakeup-bounds.ts`); a value import of the lease from
 * either would carry its graph with it.
 *
 * Every timer a lease keeps is here, each with why it exists: there is no
 * heartbeat and no sweep. A lease lasts as long as one function may run,
 * Vercel Functions' own limit and not a choice of ours, which a longer-lived
 * host would lift; the hand-over and the let-go are measured back from it.
 */

import { Duration } from "effect";

/** Vercel Functions' longest duration, the platform's limit, which one lease holds the call for. */
const FUNCTION_LIMIT = Duration.seconds(800);

/** How long before the limit the next lease is published: room for the queue to deliver it, for its function to start, and for it to attach, all before this one lets go. */
const HAND_OVER_AHEAD = Duration.seconds(90);

/** How long before the limit a lease lets go of the session: room to detach and answer the queue before the platform ends the function. */
const LET_GO_AHEAD = Duration.seconds(10);

export const VOICE_CALL_LEASE = {
  /** The queue topic every lease is published to, which the consumer's trigger subscribes to. */
  TOPIC: "voice-calls",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/voice/leases",
  /** The consumer's duration: the platform's limit, which a lease runs to. */
  MAX_DURATION_SECONDS: Duration.toSeconds(FUNCTION_LIMIT),
  /** How long a lease is held before it publishes the next one. */
  HAND_OVER_AFTER: Duration.subtract(FUNCTION_LIMIT, HAND_OVER_AHEAD),
  /** How long a lease is held before it lets go, its successor attached. */
  LET_GO_AFTER: Duration.subtract(FUNCTION_LIMIT, LET_GO_AHEAD),
  /** How long a publish is waited on before it counts as failed, so a stalled call to the queue never outlasts the time left to hand over; a send answers in milliseconds. */
  PUBLISH_WAIT: Duration.seconds(5),
  /** How long a lease that could not hand over waits for the session it closed to say so, before it lets go of the call with no seconds kept. */
  CLOSE_WAIT: Duration.seconds(10),
  /** How long a delivery that failed waits before the queue brings it again, as when the sideband dropped: short, since the call is unheld until then. */
  FAILED_AGAIN: Duration.seconds(1),
} as const;
