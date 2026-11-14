/**
 * bounds.ts -- the live view's bounds: how long a socket stands, and how fast its frames go.
 */

import { Duration } from "effect";

export const BROWSER_LIVE_BOUNDS = {
  /** How long a socket stays open past the panel's last message. */
  IDLE: Duration.minutes(5),
  /** How often an open view beats its hold on its sandbox: a minute, well inside the hold's freshness (`@repo/database`'s `AGENT_SANDBOX_HOLD`). */
  HOLD_EVERY: Duration.minutes(1),
  /** How often a socket asks whether the panel has gone the idle bound silent. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How often the tab is read again, for its driver and whether it still stands, where Sync cannot wake the read: no listener stands. */
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
