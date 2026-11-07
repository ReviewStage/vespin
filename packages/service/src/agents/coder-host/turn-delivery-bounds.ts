/**
 * turn-delivery-bounds.ts -- the agent-turns queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the
 * automation-runs consumer's (`../../automations/automation-run-bounds.ts`);
 * a value import of the consumer from either would carry its graph with it.
 */

import { TURN_DEADLINE } from "@repo/features/turn-deadline";
import { Duration } from "effect";

export const TURN_DELIVERY = {
  /** The queue topic every queued turn is published to, which the consumer's trigger subscribes to. */
  TOPIC: "agent-turns",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/agents/turns",
  /** The consumer's duration, the Fluid default a Start's function runs under, since a sandbox can take most of a minute to resume or open. */
  MAX_DURATION_SECONDS: 300,
  /**
   * How long a turn's message is kept: its pickup deadline, past which the
   * sweep fails a turn no runner took, so nothing is left to deliver. It is
   * also how long Queues dedupes a publish under the turn's id.
   */
  RETENTION: Duration.millis(TURN_DEADLINE.PICKUP_MS),
  /** How long a delivery that found the agent's runner lease held waits before it comes again: a launch under way holds it for seconds, a sandbox's open for most of a minute. */
  BUSY_AGAIN: Duration.seconds(5),
  /** How long a delivery whose store or machine was unreachable waits before it comes again. */
  FAILED_AGAIN: Duration.seconds(15),
  /**
   * How long a turn stands queued before the sweep publishes it again, well
   * inside its pickup deadline: a delivery acts within seconds of its
   * publish, so a turn still queued past this may have lost its message
   * between the commit and the publish. Queues drops the publish where the
   * first landed (`RETENTION`).
   */
  REPUBLISH_AFTER: Duration.minutes(1),
  /** How many queued turns one sweep publishes again, oldest first. */
  REPUBLISH_LIMIT: 100,
  /** How many of them it publishes at once. */
  REPUBLISH_CONCURRENCY: 10,
} as const;
