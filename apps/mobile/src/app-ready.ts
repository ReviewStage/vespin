// app-ready.ts -- counts how long a launch in front, or a sign-in's return, took to show the Inbox, once each, on a rung, as `app:ready`.

import {
  PRODUCT_FIRST_ROWS,
  PRODUCT_READY_AFTER,
  PRODUCT_SURFACE_EVENT,
  productLaunchSeconds,
  productSessionCountBucket,
} from "@repo/features/analytics";
import { LIVE_READ } from "@repo/features/live-wire";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostCount } from "./host/host-provider.js";
import {
  LAUNCH_PHASE,
  type LaunchPhase,
  launchDelivered,
  launchPhaseMs,
  launchStood,
  sinceLaunch,
} from "./launch-phases.js";
import { launchLeftFront } from "./launch-state.js";

/** Whether this launch has counted, or let go of, its first Inbox, which it does once. */
let counted = false;

/** Whether the rows the Inbox first showed this launch were the phone's kept ones, read at the first commit that showed any; none before. */
let firstShownKept: boolean | undefined;

/** When the last sign-in returned with an account, by `performance.now()`, which the Inbox it shows is timed from; none for a launch signed in already. */
let signedInAt: number | undefined;

/** Whether the app went to the background after that sign-in returned, so its wait would hold time nobody sat through. */
let leftSinceSignIn = false;

/** Stops watching for the background since the sign-in; nothing while none is watched. */
let stopWatching: () => void = () => undefined;

/** The build number this build was released as (`CFBundleVersion`), which a rung of the launch is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/**
 * Notes that a sign-in returned with an account, so the Inbox it shows is
 * counted again, timed from now rather than from the launch. Note that a
 * launch signed out waits through the system's sign-in sheet, whose time
 * no launch count could hold, and that the first Inbox after a sign-in is
 * a whole read, never kept rows, which is the wait this times.
 */
export function noteSignedIn(): void {
  stopWatching();
  signedInAt = performance.now();
  leftSinceSignIn = false;
  counted = false;
  firstShownKept = undefined;

  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") leftSinceSignIn = true;
  });

  stopWatching = () => {
    subscription.remove();
    stopWatching = () => undefined;
  };
}

/**
 * Counts, once a launch, the time from React Native's start to the first
 * commit in which the Inbox shows the feed's answer, its rows or that it
 * holds none, as `app:ready` with that time on a rung of
 * `productLaunchSeconds`, and beside it, on the same rungs, when the launch
 * reached each of its phases (`launch-phases.ts`), and on a count's rungs
 * how many documents the host wrote before it, so a slow launch says where
 * its time went: never how many rows, which threads, or a time itself. Note that the rows the current scope lists
 * aren't asked for, since an account whose Open scope is empty would never
 * count, and that a launch that began in the background, a push or a Live
 * Activity's wake, or went there before the Inbox answered, counts nothing,
 * since its time would hold a wait nobody sat through. After a sign-in
 * (`noteSignedIn`) it counts once more, timed from the sign-in's return and
 * marked so (`ready_after`).
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
    // Note that the rows' source is read at the first commit that shows them, since the service's answer can take the kept rows' place before the app comes active and counts.
    firstShownKept ??= keptRows;

    const after =
      signedInAt === undefined ? PRODUCT_READY_AFTER.LAUNCH : PRODUCT_READY_AFTER.SIGN_IN;

    if (after === PRODUCT_READY_AFTER.SIGN_IN ? leftSinceSignIn : launchLeftFront()) {
      counted = true;
      stopWatching();

      return;
    }

    // Note that the state is read again here, since the app can go inactive after the render this effect belongs to, before its change lands.
    if (!active || AppState.currentState !== "active") return;
    counted = true;
    stopWatching();
    const elapsed = signedInAt === undefined ? sinceLaunch() : performance.now() - signedInAt;

    if (elapsed === undefined) return;
    // Note that the host's start is said for a launch alone, since a sign-in's wait begins long after it.
    const stood = after === PRODUCT_READY_AFTER.LAUNCH ? launchStood() : undefined;

    // Note that each phase is said for a launch alone, as the host's start is.
    const phase = (reachedPhase: LaunchPhase) =>
      after === PRODUCT_READY_AFTER.LAUNCH ? launchPhaseMs(reachedPhase) : undefined;

    const evaluated = phase(LAUNCH_PHASE.EVALUATED);
    const account = phase(LAUNCH_PHASE.ACCOUNT);
    const local = phase(LAUNCH_PHASE.LOCAL);
    const started = phase(LAUNCH_PHASE.STARTED);
    const inbox = phase(LAUNCH_PHASE.INBOX);

    count(PRODUCT_SURFACE_EVENT.APP_READY, {
      launch_seconds: productLaunchSeconds(elapsed),
      ...(evaluated === undefined
        ? undefined
        : { evaluated_seconds: productLaunchSeconds(evaluated) }),
      ...(account === undefined ? undefined : { account_seconds: productLaunchSeconds(account) }),
      ...(local === undefined ? undefined : { local_seconds: productLaunchSeconds(local) }),
      ...(started === undefined ? undefined : { started_seconds: productLaunchSeconds(started) }),
      ...(inbox === undefined ? undefined : { inbox_seconds: productLaunchSeconds(inbox) }),
      ...(after === PRODUCT_READY_AFTER.LAUNCH
        ? { deliveries: productSessionCountBucket(launchDelivered()) }
        : undefined),
      ...(stood?.ms === undefined
        ? undefined
        : { standing_seconds: productLaunchSeconds(stood.ms) }),
      ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      first_rows: firstShownKept ? PRODUCT_FIRST_ROWS.KEPT : PRODUCT_FIRST_ROWS.FEED,
      ready_after: after,
    });
  }, [count, shown, active, keptRows]);
}
