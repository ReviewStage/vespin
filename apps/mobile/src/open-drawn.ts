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

/** How often the JS thread is asked to answer while a page waits for its push, and how late an answer counts as the thread busy, past a timer's own jitter. */
const BUSY_TICK_MS = 16;
const BUSY_LATE_MS = 4;

/** The kinds of page counted open since this launch, so each kind's first, which draws views the app has not drawn before, is told from the rest. */
const openedKinds = new Set<ProductSurface>();

/**
 * Counts, once a push, the time from this page's first render, which the
 * press that pushed it starts in the same task, to its push starting
 * (`transitionStart`, as UIKit starts the slide) and to its push standing
 * (`transitionEnd`, the slide done), each on a rung of
 * `productOpenMilliseconds`, as `open:drawn` with its kind and whether it
 * was the first of its kind since launch: never which thread, task, or
 * agent, and never a time itself. Beside them, on the same rungs, how long
 * the JS thread was busy before the push started: the page's first render
 * and commit, and how late a timer asked every `BUSY_TICK_MS` was answered
 * after them, which work the thread ran ahead of the push, such as the
 * host's, makes late; and whether the page's own thread, task, or agent was
 * held as it first drew (`held`) or still to be read. Note that the slide's
 * first frame falls between the push's start and its standing, once UIKit
 * has laid the page out for its transition, which no event marks. A page
 * that pushes nothing, such as one handing its item to a split view
 * (`surface` none), counts nothing, and so does one whose push stands after
 * the app left the front, since its time would hold a wait nobody sat
 * through.
 */
export function useOpenDrawnCount(surface: ProductSurface | undefined, held: boolean): void {
  const count = useHostCount();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const [renderedAt] = useState(() => performance.now());
  const [heldAtFirst] = useState(held);

  // Note that the watch starts as the page commits, so an early push is never missed, and that the render and commit before it count as busy whole.
  useLayoutEffect(() => {
    if (surface === undefined) return;
    let startedAt: number | undefined;
    let counted = false;
    let busy = performance.now() - renderedAt;
    let asked = performance.now();

    const answering = setInterval(() => {
      const now = performance.now();
      const late = now - asked - BUSY_TICK_MS;

      if (late > BUSY_LATE_MS) busy += late;
      asked = now;
    }, BUSY_TICK_MS);

    const stopStart = navigation.addListener("transitionStart", (event) => {
      if (event.data.closing || startedAt !== undefined) return;
      startedAt = performance.now();
      clearInterval(answering);
    });

    const stopEnd = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing || counted || startedAt === undefined) return;
      counted = true;

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
      clearInterval(answering);
      stopStart();
      stopEnd();
    };
  }, [count, navigation, surface, renderedAt, heldAtFirst]);
}
