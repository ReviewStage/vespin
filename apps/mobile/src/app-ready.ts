// app-ready.ts -- counts how long a launch, a sign-in's return, or a launch woken in the background once it came to the front, took to show the Inbox, once each, on a rung, as `app:ready`, and ends a launch's trace there; and where a launch stood that hadn't shown it 10 s in, once, as `app:not_ready`.

import {
  PRODUCT_FIRST_ROWS,
  PRODUCT_READ_STATE,
  PRODUCT_READY_AFTER,
  PRODUCT_SURFACE_EVENT,
  type ProductReadState,
  productLaunchSeconds,
  productSessionCountBucket,
} from "@repo/features/analytics";
import { LIVE_READ } from "@repo/features/live-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { finishLaunchTrace } from "./crash-reports.js";
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
import { launchActiveAt, launchFrontAt, launchLeftFront } from "./launch-state.js";

/** How long after a launch's start its Inbox may take to show before the launch counts where it stands (`app:not_ready`). */
const NOT_READY_MS = 10_000;

/** Whether this launch has counted, or let go of, its first Inbox, which it does once. */
let counted = false;

/** Whether this launch has counted where it stood without its Inbox, which it does once. */
let notReadyCounted = false;

/** Whether the rows the Inbox first showed this launch were the phone's kept ones, read at the first commit that showed any; none before. */
let firstShownKept: boolean | undefined;

/** How long after the launch's start the Inbox first showed its answer (`sinceLaunch`), read at the first commit that showed it; none before. */
let firstShownAt: number | undefined;

/** When the last sign-in returned with an account, by `performance.now()`, which the Inbox it shows is timed from; none for a launch signed in already. */
let signedInAt: number | undefined;

/** Whether the app went to the background after that sign-in returned, so its wait would hold time nobody sat through. */
let leftSinceSignIn = false;

/** Stops watching for the background since the sign-in; nothing while none is watched. */
let stopWatching: () => void = () => undefined;

/** The build number this build was released as (`CFBundleVersion`), which a rung of the launch is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** Where the Inbox's first read stands in `state`: its rows drawn from what the phone kept, the service's answer, failed, or none yet. */
function inboxReadOf(state: AppStateSnapshot): ProductReadState {
  const read = state[LIVE_READ.INBOX_ITEMS];

  if (read.failed === true) return PRODUCT_READ_STATE.FAILED;

  if (read.rows === undefined) return PRODUCT_READ_STATE.OUT;

  return read.kept === true ? PRODUCT_READ_STATE.KEPT : PRODUCT_READ_STATE.ANSWERED;
}

/** Where the task list's first read stands in `state`: drawn from the phone's kept rows while its read is still out, answered, failed, or none yet. */
function tasksReadOf(state: AppStateSnapshot): ProductReadState {
  const { listStatus, listed } = state.tasks;

  if (listStatus === TASKS_READ.FAILED) return PRODUCT_READ_STATE.FAILED;

  if (listStatus === TASKS_READ.READY) return PRODUCT_READ_STATE.ANSWERED;

  return listed === true ? PRODUCT_READ_STATE.KEPT : PRODUCT_READ_STATE.OUT;
}

/** Where the workspaces' first read stands in `state`: those the phone kept held while it is still out, answered, failed, or none yet. */
function workspacesReadOf(state: AppStateSnapshot): ProductReadState {
  const { workspacesStatus, workspaces } = state.tasks;

  if (workspacesStatus === TASKS_READ.FAILED) return PRODUCT_READ_STATE.FAILED;

  if (workspacesStatus === TASKS_READ.READY) return PRODUCT_READ_STATE.ANSWERED;

  return workspaces.length > 0 ? PRODUCT_READ_STATE.KEPT : PRODUCT_READ_STATE.OUT;
}

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
  firstShownAt = undefined;

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
 * its time went: never how many rows, which threads, or a time itself.
 * Note that the rows the current scope lists aren't asked for, since an
 * account whose Open scope is empty would never count. A launch that began
 * in the background, a push or a Live Activity's wake, or went there before
 * the Inbox answered, is timed from when the app last came to the front
 * (`launchFrontAt`), and each of its phases too, one reached while away on
 * the first rung, since a wait from the launch would hold time nobody sat
 * through; it's marked so (`ready_after` front). After a sign-in
 * (`noteSignedIn`) it counts once more, timed from the sign-in's return and
 * marked so. A launch is counted to the first commit that showed the Inbox
 * even where the app came active only later, as one a system alert covered
 * does, since the wait behind the alert is none of the launch's: when the
 * app first came active is counted beside it, on the same rungs
 * (`active_seconds`).
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
    firstShownAt ??= sinceLaunch();

    const after =
      signedInAt !== undefined
        ? PRODUCT_READY_AFTER.SIGN_IN
        : launchLeftFront()
          ? PRODUCT_READY_AFTER.FRONT
          : PRODUCT_READY_AFTER.LAUNCH;

    if (after === PRODUCT_READY_AFTER.SIGN_IN && leftSinceSignIn) {
      counted = true;
      stopWatching();

      return;
    }

    // Note that the state is read again here, since the app can go inactive after the render this effect belongs to, before its change lands.
    if (!active || AppState.currentState !== "active") return;
    // Note that a launch timed from the front waits until the front is noted, which the launch's own watch does before this one hears the change.
    const from = after === PRODUCT_READY_AFTER.FRONT ? launchFrontAt() : 0;

    if (from === undefined) return;
    counted = true;
    stopWatching();
    const sinceStart = sinceLaunch();

    // Note that a launch that waited in front is timed to its first commit that showed the Inbox, whenever it came active, and one timed from the front to when it counts, the Inbox already shown or not.
    const elapsed =
      signedInAt !== undefined
        ? performance.now() - signedInAt
        : after === PRODUCT_READY_AFTER.LAUNCH
          ? firstShownAt
          : sinceStart === undefined
            ? undefined
            : sinceStart - from;

    if (elapsed === undefined) return;

    // Note that the host's start and each phase are said for a launch alone, since a sign-in's wait begins long after them, and one reached before the front is the first rung.
    const sinceFront = (ms: number | undefined) =>
      after === PRODUCT_READY_AFTER.SIGN_IN || ms === undefined
        ? undefined
        : Math.max(0, ms - from);

    const stood = sinceFront(launchStood()?.ms);
    const phase = (reachedPhase: LaunchPhase) => sinceFront(launchPhaseMs(reachedPhase));

    const evaluated = phase(LAUNCH_PHASE.EVALUATED);
    const account = phase(LAUNCH_PHASE.ACCOUNT);
    const local = phase(LAUNCH_PHASE.LOCAL);
    const started = phase(LAUNCH_PHASE.STARTED);
    const screens = phase(LAUNCH_PHASE.SCREENS);
    const inbox = phase(LAUNCH_PHASE.INBOX);
    const activeAt = after === PRODUCT_READY_AFTER.LAUNCH ? launchActiveAt() : undefined;

    // Note that only a launch that waited in front ends its trace, since one timed from the front or a sign-in waited from elsewhere.
    if (after === PRODUCT_READY_AFTER.LAUNCH) finishLaunchTrace(elapsed, activeAt);

    count(PRODUCT_SURFACE_EVENT.APP_READY, {
      launch_seconds: productLaunchSeconds(elapsed),
      ...(evaluated === undefined
        ? undefined
        : { evaluated_seconds: productLaunchSeconds(evaluated) }),
      ...(account === undefined ? undefined : { account_seconds: productLaunchSeconds(account) }),
      ...(local === undefined ? undefined : { local_seconds: productLaunchSeconds(local) }),
      ...(started === undefined ? undefined : { started_seconds: productLaunchSeconds(started) }),
      ...(screens === undefined ? undefined : { screens_seconds: productLaunchSeconds(screens) }),
      ...(inbox === undefined ? undefined : { inbox_seconds: productLaunchSeconds(inbox) }),
      ...(activeAt === undefined ? undefined : { active_seconds: productLaunchSeconds(activeAt) }),
      ...(after === PRODUCT_READY_AFTER.SIGN_IN
        ? undefined
        : { deliveries: productSessionCountBucket(launchDelivered()) }),
      ...(stood === undefined ? undefined : { standing_seconds: productLaunchSeconds(stood) }),
      ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      first_rows: firstShownKept ? PRODUCT_FIRST_ROWS.KEPT : PRODUCT_FIRST_ROWS.FEED,
      ready_after: after,
    });
  }, [count, shown, active, keptRows]);
}

/**
 * Counts, once a launch already signed in, where it stood 10 s after its
 * start if its Inbox hadn't shown the feed's answer by then
 * (`useAppReadyCount`), as `app:not_ready`: each phase it had reached and
 * when, on `app:ready`'s rungs, how many documents the host wrote, whether
 * it left the front, and where the Inbox's, the task list's, and the
 * workspaces' first reads stood (`PRODUCT_READ_STATE`), so a launch that
 * never counts `app:ready` still says what it waited on. Never a row, a
 * thread, or a time itself. Note that the document is read from the query's
 * cache when the 10 s are up, rather than selected, so the screen that
 * holds this count draws again for none of the host's deliveries.
 */
export function useAppNotReadyCount(signedIn: boolean): void {
  const count = useHostCount();
  const client = useQueryClient();

  useEffect(() => {
    // Note that a sign-in after the launch has its own wait, which `app:ready` times from its return.
    if (!signedIn || notReadyCounted || signedInAt !== undefined) return;
    const since = sinceLaunch();

    if (since === undefined) return;

    const timer = setTimeout(
      () => {
        const state = client.getQueryData(appStateQuery.queryKey);

        if (counted || notReadyCounted || state === undefined) return;
        notReadyCounted = true;

        const rung = (ms: number | undefined) =>
          ms === undefined ? undefined : productLaunchSeconds(ms);

        const stood = rung(launchStood()?.ms);
        const evaluated = rung(launchPhaseMs(LAUNCH_PHASE.EVALUATED));
        const account = rung(launchPhaseMs(LAUNCH_PHASE.ACCOUNT));
        const local = rung(launchPhaseMs(LAUNCH_PHASE.LOCAL));
        const started = rung(launchPhaseMs(LAUNCH_PHASE.STARTED));
        const screens = rung(launchPhaseMs(LAUNCH_PHASE.SCREENS));
        const inbox = rung(launchPhaseMs(LAUNCH_PHASE.INBOX));
        const activeAt = rung(launchActiveAt());

        count(PRODUCT_SURFACE_EVENT.APP_NOT_READY, {
          ...(stood === undefined ? undefined : { standing_seconds: stood }),
          ...(evaluated === undefined ? undefined : { evaluated_seconds: evaluated }),
          ...(account === undefined ? undefined : { account_seconds: account }),
          ...(local === undefined ? undefined : { local_seconds: local }),
          ...(started === undefined ? undefined : { started_seconds: started }),
          ...(screens === undefined ? undefined : { screens_seconds: screens }),
          ...(inbox === undefined ? undefined : { inbox_seconds: inbox }),
          ...(activeAt === undefined ? undefined : { active_seconds: activeAt }),
          deliveries: productSessionCountBucket(launchDelivered()),
          ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
          ready_after: launchLeftFront() ? PRODUCT_READY_AFTER.FRONT : PRODUCT_READY_AFTER.LAUNCH,
          inbox_read: inboxReadOf(state),
          tasks_read: tasksReadOf(state),
          workspaces_read: workspacesReadOf(state),
        });
      },
      Math.max(0, NOT_READY_MS - since),
    );

    return () => clearTimeout(timer);
  }, [signedIn, count, client]);
}
