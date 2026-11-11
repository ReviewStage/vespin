/**
 * agent-wakeup-bounds.ts -- the agent-wakeups queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the agent-turns
 * consumer's (`turn-delivery-bounds.ts`); a value import of the consumer from
 * either would carry its graph with it.
 */

import { Duration } from "effect";

export const AGENT_WAKEUP = {
  /** The queue topic every booked wakeup is published to, delayed until it comes due, which the consumer's trigger subscribes to. */
  TOPIC: "agent-wakeups",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/agents/wakeups",
  /** The consumer's duration, the Fluid default a Start's function runs under, since the line it sends may open a turn whose sandbox takes most of a minute to resume. */
  MAX_DURATION_SECONDS: 300,
  /** How long a wakeup's message is kept past its due time, so a delivery that keeps failing is tried again for that long and then given up. */
  RETAINED_PAST_DUE: Duration.hours(1),
  /** How long a delivery whose send or store failed waits before it comes again. */
  FAILED_AGAIN: Duration.minutes(1),
  /** How long a publish is waited on before the booking is refused, so a stalled call to the queue never holds the agent's tool call past it; a send answers in milliseconds. */
  PUBLISH_WAIT: Duration.seconds(5),
} as const;
