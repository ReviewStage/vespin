// app-ready.ts -- counts how long a launch in front took to show the Inbox, once a launch, on a rung, as `app:ready`.

import { PRODUCT_SURFACE_EVENT, productLaunchSeconds } from "@repo/features/analytics";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";
import { launchLeftFront } from "./launch-state.js";

/** React Native's own startup marks, which its `performance` holds beside the web's and its types leave out. */
interface StartupPerformance {
  readonly rnStartupTiming?: { readonly startTime?: number | null };
}

/** Whether this launch has counted, or let go of, its first Inbox, which it does once. */
let counted = false;

/** The time since React Native's own start of this launch, in milliseconds, or none where the runtime keeps no start. */
function sinceLaunch(): number | undefined {
  // Note that React Native's startup timing is read inside a guard, since a runtime that keeps none throws on the read.
  try {
    // SAFETY: React Native's `performance` holds `rnStartupTiming` (react-native/src/private/webapis/performance/Performance.js); every member is read as optional.
    const start = (performance as Performance & StartupPerformance).rnStartupTiming?.startTime;

    return start === null || start === undefined ? undefined : performance.now() - start;
  } catch {
    return undefined;
  }
}

/**
 * Counts, once a launch, the time from React Native's start to the first
 * commit in which the Inbox shows the feed's answer, its rows or that it
 * holds none, as `app:ready` with that time on a rung of
 * `productLaunchSeconds` and nothing else: never how many rows, which
 * threads, or the time itself. Note that the rows the current scope lists
 * aren't asked for, since an account whose Open scope is empty would never
 * count, and that a launch that began in the background, a push or a Live
 * Activity's wake, or went there before the Inbox answered, counts nothing,
 * since its time would hold a wait nobody sat through.
 */
export function useAppReadyCount(shown: boolean): void {
  const count = useHostCount();
  // Note that a launch from a tap can read `inactive` while iOS finishes launching it, as kept rows draw, so the count waits for the app to come active rather than letting the launch go.
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );

    // Note that the state is read again once subscribed, since the app can come active between the first render and this effect, and the listener never replays it.
    setActive(AppState.currentState === "active");

    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (counted || !shown) return;

    if (launchLeftFront()) {
      counted = true;

      return;
    }

    if (!active) return;
    counted = true;
    const elapsed = sinceLaunch();

    if (elapsed === undefined) return;
    count(PRODUCT_SURFACE_EVENT.APP_READY, { launch_seconds: productLaunchSeconds(elapsed) });
  }, [count, shown, active]);
}
