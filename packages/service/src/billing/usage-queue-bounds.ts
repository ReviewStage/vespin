/**
 * usage-queue-bounds.ts -- the usage queues' topics, paths, and bounds, on their own so the build can read them without the consumers' graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes each consumer's trigger read these, as they read the
 * agent-wakeups consumer's (`agents/coder-host/agent-wakeup-bounds.ts`); a
 * value import of the consumers (`usage-queues.ts`) from either would carry
 * their graph with it.
 */

import { Duration } from "effect";

/** The sandbox-usage-checks queue: a delayed check of one sandbox's sessions, published as it is opened, which charges those that ended. */
export const SANDBOX_USAGE_CHECK = {
  /** The queue topic every check is published to, which the consumer's trigger subscribes to. */
  TOPIC: "sandbox-usage-checks",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/billing/sandbox-usage-checks",
  /** The consumer's duration: one list of a sandbox's sessions, a few rows written, and two publishes, well inside the platform's default. */
  MAX_DURATION_SECONDS: 60,
  /** How long past a sandbox's idle stop (`@repo/sandbox`'s `SANDBOX_IDLE`) its first check waits, so a sandbox opened once and left has stopped and had its figures answered by then. */
  STOP_MARGIN: Duration.minutes(5),
  /** How long a check that found a session still up, or stopped with its figures not yet answered, waits before it looks again; checks due in the same span of this length are one message. */
  CHECK_AGAIN: Duration.minutes(5),
  /** How long after a session stopped its figures are waited on; past this it is logged and given up, as Vercel never answered them. */
  FIGURES_AWAITED_LONGEST: Duration.days(1),
  /** How long a check's message is kept past its due time, so a delivery that keeps failing is tried again for that long and then given up. */
  RETAINED_PAST_DUE: Duration.hours(1),
  /** How long a delivery whose read or store failed waits before it comes again. */
  FAILED_AGAIN: Duration.minutes(1),
  /** How long a publish is waited on before the open is refused, so a stalled call to the queue never holds an open past it; a send answers in milliseconds. */
  PUBLISH_WAIT: Duration.seconds(5),
} as const;

/** The usage-sends queue: ledger charges just recorded, sent to Metronome and stamped sent. */
export const USAGE_SEND = {
  /** The queue topic every charge recorded is published to, which the consumer's trigger subscribes to. */
  TOPIC: "usage-sends",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/billing/usage-sends",
  /** The consumer's duration: a workspace's customer and contract made where missing and one ingest, each tried again for about 15 seconds, inside the platform's default. */
  MAX_DURATION_SECONDS: 120,
  /** How long a send's message is kept, so a Metronome down for hours has its usage sent once it is back. */
  RETENTION: Duration.days(1),
  /** How long a delivery Metronome or the store failed waits before it comes again. */
  FAILED_AGAIN: Duration.minutes(5),
  /** How long a publish is waited on before it is said to have failed. */
  PUBLISH_WAIT: Duration.seconds(5),
} as const;
