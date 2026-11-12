/**
 * workspace-drive-fill-bounds.ts -- the workspace-drive-fills queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the
 * agent-wakeups consumer's (`coder-host/agent-wakeup-bounds.ts`); a value
 * import of the consumer from either would carry its graph with it.
 */

import { Duration } from "effect";

export const WORKSPACE_DRIVE_FILL = {
  /** The queue topic each next step of a workspace drive's fill is published to, which the consumer's trigger subscribes to. */
  TOPIC: "workspace-drive-fills",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/agents/drive-fills",
  /** The consumer's duration, the platform's longest, so a step and the repository it ends on fit with room to spare. */
  MAX_DURATION_SECONDS: 800,
  /**
   * How long one step syncs repositories before it hands the rest to the
   * next. Note that it fits the shortest function a step runs in, the
   * default one a connect's webhook fills past its answer in, so no fill is
   * cut off by its function's bound, whatever the workspace's size.
   */
  STEP: Duration.minutes(4),
  /** How many repositories a fill syncs in one run, their tokens minted at once and standing at the firewall together. */
  BATCH: 16,
  /** How long a step whose run failed waits before it comes again. */
  FAILED_AGAIN: Duration.minutes(1),
  /** How long a step's message is kept, so a step that keeps failing is given up. */
  RETAINED: Duration.hours(6),
  /** How long a publish is waited on; a send answers in milliseconds. */
  PUBLISH_WAIT: Duration.seconds(5),
} as const;
