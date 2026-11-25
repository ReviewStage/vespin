// launch-load.ts -- counts a launch's first three minutes, once, as `launch:load`: how many times the JS thread was held over 50 ms and for how long in all, and how many tasks outside the list were read one by one and how long their drawing took, each on a rung; never what ran or what was read.

import {
  PRODUCT_LOAD_WINDOW,
  PRODUCT_SURFACE_EVENT,
  type ProductLoadWindow,
  productLoadCount,
  productLoadMilliseconds,
} from "@repo/features/analytics";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect } from "react";
import { AppState } from "react-native";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostCount } from "./host/host-provider.js";
import { sinceLaunch } from "./launch-phases.js";
import { launchBeganAway } from "./launch-state.js";

/** How long after the runtime's start a launch's load is counted over: past the first minutes in which a catch-up was seen to hold every touch. */
const LOAD_WINDOW_MS = 180_000;

/**
 * When the window ends, on the performance clock, which counts from the
 * device's start rather than the runtime's, so the window is laid from React
 * Native's own mark of the runtime's start (`sinceLaunch`), or from this
 * module's first run where the runtime keeps none.
 */
const WINDOW_END = performance.now() + LOAD_WINDOW_MS - (sinceLaunch() ?? 0);

/** The build number this build was released as (`CFBundleVersion`), which a launch is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** How many long tasks the window held so far, and their time in all, in milliseconds. */
const held = { count: 0, ms: 0 };

/** Whether this launch's load was counted, so it is counted once. */
let counted = false;

// Note that the long tasks are heard from the bundle's start, buffered, so those before the screens mount, the host's standing among them, are counted too. React Native reports one for each stretch over 50 ms that held the JS thread.
const longTaskWatch = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.startTime >= WINDOW_END) continue;
    held.count += 1;
    held.ms += entry.duration;
  }
});

longTaskWatch.observe({ type: "longtask", buffered: true });

/**
 * Counts this launch's load once its window is over, or as the app goes to
 * the background before then, which marks it cut short: the long tasks
 * heard, and the tasks read outside the list as the host tallied them on
 * the document (`TasksView`'s `coldReads`). A launch the system began in the
 * background counts nothing, since nobody waited through its minutes.
 */
export function useLaunchLoadCount(): void {
  const count = useHostCount();
  const client = useQueryClient();

  useEffect(() => {
    if (counted || launchBeganAway()) return;

    const finish = (window: ProductLoadWindow) => {
      if (counted) return;
      counted = true;
      longTaskWatch.disconnect();
      const cold = client.getQueryData(appStateQuery.queryKey)?.tasks.coldReads;

      count(PRODUCT_SURFACE_EVENT.LAUNCH_LOAD, {
        long_tasks: productLoadCount(held.count),
        long_task_ms: productLoadMilliseconds(held.ms),
        cold_reads: productLoadCount(cold?.count ?? 0),
        cold_read_ms: productLoadMilliseconds(cold?.drawMs ?? 0),
        load_window: window,
        ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      });
    };

    const away = AppState.addEventListener("change", (next) => {
      if (next === "background") finish(PRODUCT_LOAD_WINDOW.CUT_SHORT);
    });

    const over = setTimeout(
      () => finish(PRODUCT_LOAD_WINDOW.WHOLE),
      Math.max(0, WINDOW_END - performance.now()),
    );

    return () => {
      away.remove();
      clearTimeout(over);
    };
  }, [count, client]);
}
