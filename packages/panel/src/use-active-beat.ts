/**
 * use-active-beat.ts -- tells the service the member is at this window while they use it, so their phone holds its pushes.
 */

import { PRESENCE } from "@repo/features/presence-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Clock, Context } from "effect";
import { useEffect } from "react";
import { tellAct } from "./act.js";
import { rendererServicesNow } from "./renderer-runtime.js";

/** What counts as the member using the window: a key, a press, a move of the pointer or the wheel, or the window taking focus. */
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "focus"] as const;

/** Reads the renderer's clock as it stands at the call. */
function clockNow(): number {
  return Context.get(rendererServicesNow(), Clock.Clock).currentTimeMillisUnsafe();
}

/**
 * While an account is signed in, each use of the window tells the host the
 * member is active (`ACT_KIND.ACCOUNT_ACTIVE`), at most once every
 * `PRESENCE.BEAT_EVERY_MS`, the first use at once. Note that nothing is
 * scheduled: a window left alone, hidden, or closed simply sends nothing
 * more, and the service counts the member away once its window passes, so
 * there is no sign-off to send. The beat carries nothing of what was typed
 * or pressed. Each window's root mounts it once; the phone mounts no panel,
 * so it never counts itself present.
 */
export function useActiveBeat(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return undefined;
    let lastSent = Number.NEGATIVE_INFINITY;
    const used = () => {
      const now = clockNow();
      if (now - lastSent < PRESENCE.BEAT_EVERY_MS) return;
      lastSent = now;
      tellAct(ACT_KIND.ACCOUNT_ACTIVE);
    };
    // Capture and passive: the beat reads no event and never stands in a handler's way.
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, used, { capture: true, passive: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, used, { capture: true });
      }
    };
  }, [signedIn]);
}
