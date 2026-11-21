// open-drawn.ts -- counts how long a page pushed open took to start its slide and to stand, once an open, on rungs, as `open:drawn`, with its kind and whether it was the first of its kind since launch.

import {
  PRODUCT_OPEN_ORDER,
  PRODUCT_SURFACE_EVENT,
  type ProductSurface,
  productDrawnMilliseconds,
} from "@repo/features/analytics";
import Constants from "expo-constants";
import { type NativeStackNavigationProp, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";

/** The build number this build was released as (`CFBundleVersion`), which an open is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** The kinds of page counted open since this launch, so each kind's first, which draws views the app has not drawn before, is told from the rest. */
const openedKinds = new Set<ProductSurface>();

/**
 * Counts, once a push, the time from this page's first render, which the
 * press that pushed it starts in the same task, to its push starting
 * (`transitionStart`, as UIKit starts the slide) and to its push standing
 * (`transitionEnd`, the slide done), each on a rung of
 * `productDrawnMilliseconds`, as `open:drawn` with its kind and whether it
 * was the first of its kind since launch: never which thread, task, or
 * agent, and never a time itself. Note that the slide's first frame falls
 * between the two, once UIKit has laid the page out for its transition,
 * which no event marks. A page that pushes nothing, such as one handing its
 * item to a split view (`surface` none), counts nothing, and so does one
 * whose push stands after the app left the front, since its time would hold
 * a wait nobody sat through.
 */
export function useOpenDrawnCount(surface: ProductSurface | undefined): void {
  const count = useHostCount();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const [renderedAt] = useState(() => performance.now());

  useEffect(() => {
    if (surface === undefined) return;
    let startedAt: number | undefined;
    let counted = false;

    const stopStart = navigation.addListener("transitionStart", (event) => {
      if (!event.data.closing) startedAt ??= performance.now();
    });

    const stopEnd = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing || counted || startedAt === undefined) return;
      counted = true;

      if (AppState.currentState !== "active") return;
      const order = openedKinds.has(surface) ? PRODUCT_OPEN_ORDER.LATER : PRODUCT_OPEN_ORDER.FIRST;
      openedKinds.add(surface);

      count(PRODUCT_SURFACE_EVENT.OPEN_DRAWN, {
        surface,
        start_ms: productDrawnMilliseconds(startedAt - renderedAt),
        drawn_ms: productDrawnMilliseconds(performance.now() - renderedAt),
        open_order: order,
        ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      });
    });

    return () => {
      stopStart();
      stopEnd();
    };
  }, [count, navigation, surface, renderedAt]);
}
