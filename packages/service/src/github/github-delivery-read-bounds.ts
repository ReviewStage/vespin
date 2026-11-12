/**
 * github-delivery-read-bounds.ts -- the github-delivery-reads queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the
 * agent-wakeups consumer's (`../agents/coder-host/agent-wakeup-bounds.ts`); a
 * value import of the consumer from either would carry its graph with it.
 */

import { Duration } from "effect";

export const GITHUB_DELIVERY_READ = {
  /** The queue topic a delivery's reads of GitHub are published to, which the consumer's trigger subscribes to. */
  TOPIC: "github-delivery-reads",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/github/delivery-reads",
  /** The consumer's duration, the Fluid default, since a wake it tells may open a turn whose sandbox takes most of a minute to resume. */
  MAX_DURATION_SECONDS: 300,
  /** The window a burst of deliveries about one commit is read once in: every one in it is answered by one read, sent once it closes. */
  WINDOW: Duration.seconds(10),
  /** How long past its window's close a read is sent, so a delivery landing on the close is still in it. */
  PAST_WINDOW: Duration.seconds(2),
  /** How long a read's message is kept, so one that keeps failing is tried again for that long and then given up. */
  RETAINED: Duration.hours(1),
  /** How long a read that failed waits before it comes again. */
  FAILED_AGAIN: Duration.minutes(1),
  /** How long a publish is waited on before the reads are run in the delivery instead; a send answers in milliseconds. */
  PUBLISH_WAIT: Duration.seconds(5),
} as const;
