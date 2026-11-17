// app-ready.ts -- counts how long a launch in front took to show the Inbox, once a launch, on a rung, as `app:ready`.

import {
  PRODUCT_FIRST_ROWS,
  PRODUCT_SURFACE_EVENT,
  productLaunchSeconds,
} from "@repo/features/analytics";
import { LIVE_READ } from "@repo/features/live-wire";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostCount } from "./host/host-provider.js";
import { launchStood, sinceLaunch } from "./launch-phases.js";
import { launchLeftFront } from "./launch-state.js";

/** Whether this launch has counted, or let go of, its first Inbox, which it does once. */
let counted = false;

/** The build number this build was released as (`CFBundleVersion`), which a rung of the launch is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

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

  // Note that the Inbox's rows are read as the phone's kept ones while the host marks them so, until the service's first answer takes their place.
  const { data: keptRows = false } = useQuery({
    ...appStateQuery,
    select: (state) => state[LIVE_READ.INBOX_ITEMS].kept === true,
  });

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

    // Note that the state is read again here, since the app can go inactive after the render this effect belongs to, before its change lands.
    if (!active || AppState.currentState !== "active") return;
    counted = true;
    const elapsed = sinceLaunch();

    if (elapsed === undefined) return;
    const stood = launchStood();

    count(PRODUCT_SURFACE_EVENT.APP_READY, {
      launch_seconds: productLaunchSeconds(elapsed),
      ...(stood?.ms === undefined
        ? undefined
        : { standing_seconds: productLaunchSeconds(stood.ms) }),
      ...(stood === undefined ? undefined : { kept_store: stood.keptStore }),
      ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      first_rows: keptRows ? PRODUCT_FIRST_ROWS.KEPT : PRODUCT_FIRST_ROWS.FEED,
    });
  }, [count, shown, active, keptRows]);
}
