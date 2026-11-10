/**
 * bounds.ts -- the live view's bounds: how long a socket stands, and how fast its frames go.
 */

import { SANDBOX_IDLE } from "@repo/sandbox";
import { Duration } from "effect";

export const BROWSER_LIVE_BOUNDS = {
  /** How long a socket stays open past the panel's last message. */
  IDLE: Duration.minutes(5),
  /**
   * How long a socket stays open past the member's last input, however
   * often its panel says it is watching: as long as the sandbox runs past
   * its last use (`SANDBOX_IDLE`), since watching alone does not touch it,
   * so the view closes as idle as its sandbox stops, and Watch again opens
   * a new view, resuming the sandbox.
   */
  INPUT_IDLE: SANDBOX_IDLE,
  /** How often a socket asks whether the panel has gone the idle bound silent. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How often the tab is read again, for its driver and whether it still stands, where Sync cannot wake the read: no listener stands, or the tab is on no task. */
  TAB_CHECK_EVERY: Duration.seconds(5),
  /** How often input moves the member's takeover on, well inside its hold. */
  RENEW_EVERY: Duration.seconds(10),
  /** The least time between two frames: at most eight a second. */
  FRAME_EVERY: Duration.millis(125),
  /** How long the close waits on the browser to stop the cast. */
  CAST_END_TIMEOUT: Duration.seconds(2),
  /** The most bytes the panel's socket may still be sending before a frame is skipped. */
  MAX_BUFFERED_BYTES: 1024 * 1024,
  /** The screencast: JPEG, no larger than a laptop's screen, at a quality text stays legible at. */
  SCREENCAST: { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800 },
} as const;
