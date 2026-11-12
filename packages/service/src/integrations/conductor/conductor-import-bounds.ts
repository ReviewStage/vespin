/**
 * conductor-import-bounds.ts -- the conductor-imports queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the
 * automation-runs consumer's (`../../automations/automation-run-bounds.ts`);
 * a value import of the consumer from either would carry its graph with it.
 */

import { Duration } from "effect";

export const CONDUCTOR_IMPORTS = {
  /** The queue topic every workspace and chat of an import is published to, which the consumer's trigger subscribes to. */
  TOPIC: "conductor-imports",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/integrations/conductor-imports",
  /** The consumer's duration: a chat of thousands of messages takes about 30 seconds to read and as long again to write. */
  MAX_DURATION_SECONDS: 300,
  /** How long a message is kept, and how long Queues drops a publish under the same key: a run's key lives a day at most. */
  RETENTION: Duration.days(1),
  /** How many times a workspace or a chat may fail in a way that may pass, such as Conductor not answering, before it settles failed. */
  MAX_ATTEMPTS: 5,
  /** How long a delivery that failed waits before it comes again, times how many times it has failed. */
  FAILED_AGAIN: Duration.seconds(30),
  /**
   * How many of a run's workspaces and chats talk to Conductor at once. A
   * run queues every workspace in one go, thousands for a large team, and
   * Conductor answers a flood with failures, so the rest wait their turn.
   */
  LEASES_PER_RUN: 4,
  /** How long a delivery holds its lease: past the consumer's own bound, so one cut off lets go of it after. */
  LEASE_FOR: Duration.seconds(330),
  /** The least a delivery that found the run's leases all held waits before it comes again; a random wait up to as long again is added, so they spread out. */
  BUSY_AGAIN: Duration.seconds(20),
  /** How long a publish is waited on before it is given up and said in the log; a send answers in milliseconds. */
  PUBLISH_WAIT: Duration.seconds(5),
  /** How many messages a run or a workspace publishes at once. */
  PUBLISH_CONCURRENCY: 10,
  /** How many repositories a check asks GitHub about at once. */
  READ_CONCURRENCY: 4,
  /** How many of a workspace's chats have their first page read at once for its description. */
  FIRST_PAGE_CONCURRENCY: 2,
  /** How long a run's key is kept at most, whatever is still queued. */
  KEY_LIFETIME: Duration.days(1),
} as const;
