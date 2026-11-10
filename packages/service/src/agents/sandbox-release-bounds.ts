/**
 * sandbox-release-bounds.ts -- the sandbox-releases queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the agent-turns
 * consumer's (`coder-host/turn-delivery-bounds.ts`); a value import of the
 * consumer from either would carry its graph with it.
 */

import { Duration } from "effect";

export const SANDBOX_RELEASE = {
  /** The queue topic every release is published to, which the consumer's trigger subscribes to. */
  TOPIC: "agent-sandbox-releases",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/agents/sandbox-releases",
  /** The consumer's duration: one row read, one delete, and one write, well inside the platform's default. */
  MAX_DURATION_SECONDS: 60,
  /** How long a sandbox stands unused before its release is due. */
  UNUSED_FOR: Duration.days(7),
  /** How many sandboxes newly due one sweep marks and queues at most, oldest used first, so a fault cannot release every sandbox at once; as many again still releasing are published again beside them. */
  SWEEP_LIMIT: 50,
  /**
   * How long a release's message is kept, and how long Queues drops a
   * publish under the same sandbox's name: the sweep publishes a sandbox
   * still RELEASING every minute, which Queues drops while the first stands.
   */
  RETENTION: Duration.hours(1),
  /** How long a delivery whose delete or store failed waits before it comes again. */
  FAILED_AGAIN: Duration.minutes(1),
  /** The most one delete runs before its delivery fails and comes again. */
  DELETE_TIMEOUT: Duration.seconds(30),
  /** How long a publish is waited on before it is given up and said in the log; the sweep publishes again next minute. */
  PUBLISH_WAIT: Duration.seconds(5),
  /** How many releases one sweep publishes at once, so a queue that hangs holds the sweep for a few `PUBLISH_WAIT`s, not one per row. */
  PUBLISH_CONCURRENCY: 10,
} as const;
