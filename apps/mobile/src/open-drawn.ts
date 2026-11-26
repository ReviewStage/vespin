// open-drawn.ts -- counts how long a page pushed open took to start its slide and to stand, once an open, on rungs, as `open:drawn`, with its kind and whether it was the first of its kind since launch.

import {
  PRODUCT_OPEN_ORDER,
  PRODUCT_PAGE_DATA,
  PRODUCT_SURFACE_EVENT,
  type ProductSurface,
  productOpenMilliseconds,
} from "@repo/features/analytics";
import Constants from "expo-constants";
import { type NativeStackNavigationProp, useNavigation } from "expo-router";
import { useLayoutEffect, useState } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";

/** The build number this build was released as (`CFBundleVersion`), which an open is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** The kinds of page counted open since this launch, so each kind's first, which draws views the app has not drawn before, is told from the rest. */
const openedKinds = new Set<ProductSurface>();

/** How long the long tasks in `tasks` held the JS thread between `from` and `to`, each clipped to that span. */
function heldBetween(tasks: readonly PerformanceEntry[], from: number, to: number): number {
  return tasks.reduce((held, task) => {
    const overlap = Math.min(task.startTime + task.duration, to) - Math.max(task.startTime, from);

    return overlap > 0 ? held + overlap : held;
  }, 0);
}

/**
 * Counts, once a push, the time from this page's first render, which the
 * press that pushed it starts in the same task, to its push starting
 * (`transitionStart`, as UIKit starts the slide) and to its push standing
 * (`transitionEnd`, the slide done), each on a rung of
 * `productOpenMilliseconds`, as `open:drawn` with its kind and whether it
 * was the first of its kind since launch: never which thread, task, or
 * agent, and never a time itself. Beside them, on the same rungs, how long
 * the JS thread was held before the push started, from the page's first
 * render: the part of each long task React Native reported (`longtask`, a
 * stretch of 50 ms or more with no chance to yield) that fell in that span,
 * such as the host's work ahead of the push; and whether the page's own
 * thread, task, or agent was held as it first drew (`held`) or still to be
 * read. Note that the slide's first frame falls between the push's start and
 * its standing, once UIKit has laid the page out for its transition, which
 * no event marks. A page that pushes nothing, such as one handing its item
 * to a split view (`surface` none), counts nothing, and so does one whose
 * push stands after the app left the front, since its time would hold a wait
 * nobody sat through.
 */
export function useOpenDrawnCount(surface: ProductSurface | undefined, held: boolean): void {
  const count = useHostCount();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const [renderedAt] = useState(() => performance.now());
  const [heldAtFirst] = useState(held);

  // Note that the watch starts as the page commits, so an early push is never missed, and that the long task its render and commit ran in is reported as that task ends, after the watch began.
  useLayoutEffect(() => {
    if (surface === undefined) return;
    let startedAt: number | undefined;
    let counted = false;
    const longTasks: PerformanceEntry[] = [];

    const watch = new PerformanceObserver((list) => {
      longTasks.push(...list.getEntries());
    });

    watch.observe({ type: "longtask" });

    const stopStart = navigation.addListener("transitionStart", (event) => {
      if (event.data.closing || startedAt !== undefined) return;
      startedAt = performance.now();
    });

    const stopEnd = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing || counted || startedAt === undefined) return;
      counted = true;
      // Note that a long task is reported only once it ends, so those not yet handed to the watch are taken as the slide stands, long after the push began.
      const busy = heldBetween([...longTasks, ...watch.takeRecords()], renderedAt, startedAt);
      watch.disconnect();

      if (AppState.currentState !== "active") return;
      const order = openedKinds.has(surface) ? PRODUCT_OPEN_ORDER.LATER : PRODUCT_OPEN_ORDER.FIRST;
      openedKinds.add(surface);

      count(PRODUCT_SURFACE_EVENT.OPEN_DRAWN, {
        surface,
        start_ms: productOpenMilliseconds(startedAt - renderedAt),
        stand_ms: productOpenMilliseconds(performance.now() - renderedAt),
        open_order: order,
        busy_ms: productOpenMilliseconds(busy),
        page_data: heldAtFirst ? PRODUCT_PAGE_DATA.HELD : PRODUCT_PAGE_DATA.READ,
        ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      });
    });

    return () => {
      watch.disconnect();
      stopStart();
      stopEnd();
    };
  }, [count, navigation, surface, renderedAt, heldAtFirst]);
}
