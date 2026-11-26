// resume-load.ts -- counts each return from the background by its first minute, once a return, as `resume:load`: how many times the JS thread was held over 50 ms, for how long in all and at most, how many documents the host delivered to the screens meanwhile, and how long the app was away, each on a rung; never what ran or what was delivered.

import {
  PRODUCT_LOAD_WINDOW,
  PRODUCT_SURFACE_EVENT,
  type ProductLoadWindow,
  productElapsedSeconds,
  productLoadCount,
  productLoadMilliseconds,
  productSessionCountBucket,
} from "@repo/features/analytics";
import Constants from "expo-constants";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useHostCount } from "./host/host-provider.js";
import { launchDelivered } from "./launch-phases.js";

/** How long after a return its load is counted over: past the catch-up a return reads, which held every touch for seconds on a busy account. */
const RESUME_WINDOW_MS = 60_000;

/** The build number this build was released as (`CFBundleVersion`), which a return is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** A return being counted: when it came back and how long it was away, the deliveries before it, and the long tasks heard since. */
interface Returning {
  readonly at: number;
  readonly awayMs: number;
  readonly deliveredBefore: number;
  readonly watch: PerformanceObserver;
  readonly held: { count: number; ms: number; longest: number };
  readonly over: ReturnType<typeof setTimeout>;
}

/**
 * Counts each return from the background once, as `resume:load`, over its
 * first `RESUME_WINDOW_MS`, or until the app goes back to the background,
 * which marks it cut short: the long tasks React Native reported since the
 * return (`longtask`, each a stretch of 50 ms or more with no chance to
 * yield), their time in all and the longest, the documents the host
 * delivered to the screens meanwhile (`launchDelivered`), and how long the
 * app was away. Note that the time away is read on the wall clock, since
 * the performance clock may stand still while iOS suspends the app.
 */
export function useResumeLoadCount(): void {
  const count = useHostCount();

  useEffect(() => {
    let wentAwayAt: number | undefined;
    let returning: Returning | undefined;

    const finish = (window: ProductLoadWindow) => {
      const done = returning;

      if (done === undefined) return;
      returning = undefined;
      clearTimeout(done.over);
      done.watch.disconnect();

      count(PRODUCT_SURFACE_EVENT.RESUME_LOAD, {
        long_tasks: productLoadCount(done.held.count),
        long_task_ms: productLoadMilliseconds(done.held.ms),
        longest_task_ms: productLoadMilliseconds(done.held.longest),
        deliveries: productSessionCountBucket(launchDelivered() - done.deliveredBefore),
        away_seconds: productElapsedSeconds(done.awayMs),
        load_window: window,
        ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      });
    };

    const begin = (awayMs: number) => {
      const held = { count: 0, ms: 0, longest: 0 };
      const at = performance.now();

      // Note that only long tasks that began after the return count, so one the app ran before it went away is never this return's.
      const watch = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < at) continue;
          held.count += 1;
          held.ms += entry.duration;
          held.longest = Math.max(held.longest, entry.duration);
        }
      });

      watch.observe({ type: "longtask" });
      const over = setTimeout(() => finish(PRODUCT_LOAD_WINDOW.WHOLE), RESUME_WINDOW_MS);
      returning = { at, awayMs, deliveredBefore: launchDelivered(), watch, held, over };
    };

    const change = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background") {
        finish(PRODUCT_LOAD_WINDOW.CUT_SHORT);
        wentAwayAt = Date.now();

        return;
      }

      if (next !== "active" || wentAwayAt === undefined) return;
      const awayMs = Date.now() - wentAwayAt;
      wentAwayAt = undefined;
      begin(awayMs);
    });

    // Note that a return still being counted as the root goes counts nothing, since its minute was never seen whole or cut short by leaving.
    return () => {
      change.remove();

      if (returning === undefined) return;
      clearTimeout(returning.over);
      returning.watch.disconnect();
    };
  }, [count]);
}
