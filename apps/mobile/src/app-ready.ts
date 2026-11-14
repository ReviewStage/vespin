// app-ready.ts -- counts how long a launch took to draw the Inbox's first rows, once a launch, on a rung, as `app:ready`.

import { PRODUCT_SURFACE_EVENT, productLaunchSeconds } from "@repo/features/analytics";
import { useEffect } from "react";
import { useHostCount } from "./host/host-provider.js";

/** React Native's own startup marks, which its `performance` holds beside the web's and its types leave out. */
interface StartupPerformance {
  readonly rnStartupTiming?: { readonly startTime?: number | null };
}

/** Whether this launch has counted its first rows, which it does once. */
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
 * commit in which the Inbox holds rows, as `app:ready` with that time on a
 * rung of `productLaunchSeconds` and nothing else: never how many rows,
 * which threads, or the time itself. Note that it is the first rows of the
 * launch whatever screen opened first, so a launch that opened on a link to
 * a thread counts when the Inbox is first shown, and an Inbox that stays
 * empty counts nothing.
 */
export function useAppReadyCount(hasRows: boolean): void {
  const count = useHostCount();
  useEffect(() => {
    if (counted || !hasRows) return;
    counted = true;
    const elapsed = sinceLaunch();

    if (elapsed === undefined) return;
    count(PRODUCT_SURFACE_EVENT.APP_READY, { launch_seconds: productLaunchSeconds(elapsed) });
  }, [count, hasRows]);
}
