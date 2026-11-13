/**
 * workspace-drive-build-bounds.ts -- the workspace-drive-builds queue's topic, path, and bounds, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, as they read the
 * sandbox-releases consumer's (`sandbox-release-bounds.ts`); a value import
 * of the consumer from either would carry its graph with it.
 */

import { BOOT_BOUNDS } from "@repo/features/agent-boot";
import { Duration } from "effect";

export const WORKSPACE_DRIVE_BUILD = {
  /** The queue topic every build is published to, which the consumer's trigger subscribes to. */
  TOPIC: "workspace-drive-builds",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/agents/workspace-drive-builds",
  /** The consumer's duration, the platform's longest, since a fill runs up to its own ten-minute deadline (`WORKSPACE_DRIVE.DEADLINE`) and the boots it held are booted after it. */
  MAX_DURATION_SECONDS: 800,
  /** How long a build's message is kept: the building deadline, past which the sweep fails every boot it was for, so nothing is left to build for. */
  RETENTION: Duration.millis(BOOT_BOUNDS.BUILDING_DEADLINE_MS),
  /** How long a delivery that found another fill holding the drive waits before it comes again and reads what is still missing. */
  FILLING_AGAIN: Duration.seconds(5),
  /** How long a delivery whose store or machine was unreachable waits before it comes again. */
  FAILED_AGAIN: Duration.seconds(15),
  /** How long a publish is waited on before it is given up and said in the log, so a stalled call to the queue never holds the request that published past it. */
  PUBLISH_WAIT: Duration.seconds(5),
} as const;
