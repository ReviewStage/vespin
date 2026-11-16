/**
 * playing-frames.ts -- a playing video's or sound clip's position read on every frame the window draws, so its scrubber and playhead glide rather than step.
 *
 * A media element tells where it stands through `timeupdate`, which a
 * browser fires about four times a second, so a scrubber moved by it
 * alone jumps a quarter second at a time. While the medium plays, its
 * player reads it again on each animation frame, and stops as it pauses,
 * ends, or goes; `timeupdate` still answers a seek while paused. Note that
 * a frame is only drawn while the window is shown, so a player in a hidden
 * tab reads nothing.
 */

import { useEffect, useRef } from "react";

/** Calls `onFrame` on every frame the window draws while `playing`, with the latest `onFrame` handed in. */
export function usePlayingFrames(playing: boolean, onFrame: () => void): void {
  const latest = useRef(onFrame);
  latest.current = onFrame;

  useEffect(() => {
    if (!playing) return;

    let frame = requestAnimationFrame(function step() {
      latest.current();
      frame = requestAnimationFrame(step);
    });

    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
