/**
 * after-first-frame.ts -- whether a screen's first frame has drawn, so a heavy part of it can wait one frame and the screen's push start without it.
 */

import { useEffect, useState } from "react";

/**
 * Answers false on a screen's first render and true from the frame after
 * it, so a heavy part below the fold, such as a task's description, draws
 * in its own commit. Note that the push starts on the first commit, so
 * what that commit draws is what a tap waits on, and a part held back
 * draws as it does while it still loads.
 */
export function useAfterFirstFrame(): boolean {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));

    return () => cancelAnimationFrame(frame);
  }, []);

  return drawn;
}
