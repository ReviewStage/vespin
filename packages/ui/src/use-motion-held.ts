import { Predicate } from "effect";
import { useEffect, useState } from "react";
import { motionHeld } from "./motion-timing.js";

/**
 * use-motion-held.ts -- whether motion is held still, read again as the reduced-motion setting changes.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tells `heard` each time the reduced-motion setting changes, the moment to
 * read the motion tokens again, since they change with it; answers the way
 * to stop. Note that a document with no media queries, as a test's is, has
 * no setting to follow.
 */
function listenToMotionSetting(heard: () => void): () => void {
  if (typeof window === "undefined" || !Predicate.isFunction(window.matchMedia)) {
    return () => undefined;
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", heard);

  return () => query.removeEventListener("change", heard);
}

/**
 * Whether motion is held still, for what a script plays that the stylesheet
 * cannot hold: holding every loop still leaves the poses, and switching
 * between poses is the motion someone asked not to see. Note that the tokens
 * are what answers; the setting's media query only says when to read them
 * again, since the tokens change with it.
 */
export function useMotionHeld(): boolean {
  // Note that a render off a page, as a static render is, has no tokens to read, and holds still.
  const [held, setHeld] = useState(() => typeof document === "undefined" || motionHeld());

  useEffect(() => {
    const update = () => setHeld(motionHeld());
    // Note that we read again once drawn, because a capture run zeroes the tokens under a stage
    // that may be committed beside the caller, after the render's own read.
    update();

    return listenToMotionSetting(update);
  }, []);

  return held;
}
