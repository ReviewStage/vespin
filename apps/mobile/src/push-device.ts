/**
 * push-device.ts -- the phone registered with the service for pushes while an account is signed in and iOS lets it notify, unregistered before a sign-out, and its "Notify me" and how its pushes fare as Settings reads and sets them.
 *
 * The phone is named by the raw APNs token iOS hands the app
 * (`getDevicePushTokenAsync`, never an Expo push token, so a notification's
 * words go only to Apple) and the gateway the token belongs to, which the
 * build decides (`BUILD_ENVIRONMENT`). The token is read once a launch,
 * since iOS may hand a new one after a restore or a reinstall, and the phone
 * registered again on every launch while the permission stands, so the
 * service always holds the token iOS hands now; a register is idempotent.
 * Note that iOS may never answer the read, as on an ad-hoc-signed simulator
 * or a phone that cannot reach APNs, so nothing a person waits on, a
 * sign-out above all, waits on it.
 * Nothing is asked while signed out. A fixture run, which reaches no service
 * and whose simulator holds no APNs token, names the phone by a synthetic
 * token its host's fixture answers (`@repo/host/fixture-inbox`).
 *
 * The rest of what the phone does with a push (its categories and buttons,
 * a reply typed in place, a tap opening the thread, the badge, and clearing
 * a settled thread's notification) is the app's notifications work, not
 * this module's.
 */

import {
  PUSH_ENVIRONMENT,
  PUSH_NOTIFY,
  type PushDeviceStatusAnswer,
  type PushEnvironment,
  type PushNotify,
} from "@repo/features/push-device-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { ActPortClient } from "@repo/host/contract";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { getDevicePushTokenAsync } from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";
import { NOTIFICATION_STANDING, useNotificationPermission } from "./notification-permission.js";

/**
 * The gateway this build's tokens belong to. Note that the entitlement
 * names production for every build, and a Debug build Xcode signs for
 * development is handed a sandbox token all the same, so the build's kind
 * decides it: a Debug build takes the sandbox, and a Release build
 * (TestFlight, the App Store) production.
 */
const BUILD_ENVIRONMENT: PushEnvironment = __DEV__
  ? PUSH_ENVIRONMENT.SANDBOX
  : PUSH_ENVIRONMENT.PRODUCTION;

/** The token a fixture run names the phone by: synthetic hex of a real token's length, which no phone holds. */
const FIXTURE_PUSH_TOKEN = "f1".repeat(32);

/** The phone as the service names it: its token, and the gateway the token belongs to. */
export interface PushDeviceKey {
  readonly token: string;
  readonly environment: PushEnvironment;
}

/** This launch's read of the phone's token, made once and shared by every screen that asks. */
let tokenRead: Promise<PushDeviceKey | undefined> | undefined;

/** The key this launch's read of the phone's token answered; none until iOS answers one. */
let keyRead: PushDeviceKey | undefined;

/** The key a fixture run names the phone by. */
const FIXTURE_KEY: PushDeviceKey = { token: FIXTURE_PUSH_TOKEN, environment: BUILD_ENVIRONMENT };

/** The phone's key, read once a launch: a fixture run's synthetic one, or iOS's own; none where iOS hands no token. */
function readDeviceKey(fixture: boolean): Promise<PushDeviceKey | undefined> {
  if (fixture) return Promise.resolve(FIXTURE_KEY);
  tokenRead ??= getDevicePushTokenAsync().then(
    (token) => {
      keyRead =
        typeof token.data === "string" && token.data !== ""
          ? { token: token.data, environment: BUILD_ENVIRONMENT }
          : undefined;
      return keyRead;
    },
    (error: unknown) => {
      // Note that a refusal is not kept, so the next screen to ask reads again.
      tokenRead = undefined;
      console.error("The phone's push token could not be read.", error);
      return undefined;
    },
  );
  return tokenRead;
}

/** Whether this launch runs on a fixture's data rather than the service. */
export function useFixtureRun(): boolean {
  const { data: fixture = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.run.fixtureMode,
  });
  return fixture;
}

/** The phone's key once iOS lets it notify, read once a launch; none until then, or where iOS hands no token. */
export function usePushDeviceKey(): PushDeviceKey | undefined {
  const { standing } = useNotificationPermission();
  const fixture = useFixtureRun();
  const [key, setKey] = useState<PushDeviceKey | undefined>(undefined);
  // Note that a fixture run stands for a phone that allowed notifications, since a CI simulator never answers the permission's read.
  const allowed = fixture || standing === NOTIFICATION_STANDING.ALLOWED;
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    readDeviceKey(fixture).then((read) => {
      if (live) setKey(read);
    });
    return () => {
      live = false;
    };
  }, [allowed, fixture]);
  return allowed ? key : undefined;
}

/** This launch's register of the phone under the account signed in, and the token it named, which a read of its standing waits for. */
let registration: { readonly token: string; readonly done: Promise<void> } | undefined;

/** The latest register sent, which the next one waits on, so a late answer for an account signed out of can never land after the next account's. */
let lastRegister: Promise<void> = Promise.resolve();

/**
 * The phone registered under the account signed in, once for its token
 * until a sign-out unregisters it: the register under way, or done, where
 * one was asked already. Note that a read of the phone's standing waits on
 * it, so a Settings screen opened as the permission is first granted reads
 * a phone the service holds.
 */
function registered(acts: ActPortClient, key: PushDeviceKey): Promise<void> {
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  if (bundleId === undefined) return Promise.resolve();
  if (registration?.token === key.token) return registration.done;
  const done = lastRegister
    .then(() => acts[ACT_KIND.PUSH_DEVICE_REGISTER]({ ...key, bundleId }))
    .then(
      (answer) => {
        // Note that a register the service did not take is asked again by the next screen that reads.
        if ("failure" in answer) registration = undefined;
      },
      (error: unknown) => {
        registration = undefined;
        console.error("The phone was not registered for notifications.", error);
      },
    );
  registration = { token: key.token, done };
  lastRegister = done;
  return done;
}

/** The phone registered under the account signed in, once a launch while iOS lets it notify; nothing while signed out. */
export function usePushRegistration(signedIn: boolean): void {
  const acts = useHostActs();
  const key = usePushDeviceKey();
  useEffect(() => {
    if (!signedIn) {
      // Note that a sign-out the app did not start, such as a refused renewal, runs no unregister, so the next account registers afresh.
      registration = undefined;
      return;
    }
    if (key === undefined) return;
    registered(acts, key).catch(() => undefined);
  }, [acts, signedIn, key]);
}

/**
 * The phone unregistered from the account's pushes, as a sign-out asks
 * before it signs out, so no push for the account reaches a phone signed
 * out of it. It names the phone by the token this launch already read, and
 * never reads one itself, since iOS may never answer a read and a sign-out
 * must always finish. Done at once where no token was read: the phone was
 * then registered by no read of this launch, and one registered on an
 * earlier launch is let go by the service once APNs refuses its token, or
 * moves to whoever signs in next. A sign-out goes on where the unregister
 * fails too, since signing out must work offline.
 */
export function unregisterPushDevice(acts: ActPortClient, fixture: boolean): Promise<void> {
  // The next account to sign in registers the phone afresh.
  registration = undefined;
  // Note that the unregister waits on a register still under way, since a register landing after it would put the phone back on the account.
  const done = lastRegister.then(() => {
    const key = fixture ? FIXTURE_KEY : keyRead;
    if (key === undefined) return undefined;
    return acts[ACT_KIND.PUSH_DEVICE_UNREGISTER](key).then(
      () => undefined,
      (error: unknown) => console.error("The phone was not unregistered.", error),
    );
  });
  lastRegister = done;
  return done;
}

/** The phone's standing as Settings draws it, none until the service answers, and the "Notify me" choice made from it. */
export function usePushDeviceStanding(key: PushDeviceKey | undefined): {
  readonly standing: PushDeviceStatusAnswer | undefined;
  readonly choose: (notify: PushNotify) => void;
} {
  const acts = useHostActs();
  const [standing, setStanding] = useState<PushDeviceStatusAnswer | undefined>(undefined);
  // Which choice was made last, so an earlier one's refusal never puts back what a later one drew.
  const picks = useRef(0);
  // The choice the service last held, read or taken, which a refusal puts back.
  const confirmed = useRef<PushNotify | undefined>(undefined);
  useEffect(() => {
    if (key === undefined) return undefined;
    let live = true;
    registered(acts, key)
      .then(() => acts[ACT_KIND.PUSH_DEVICE_STATUS](key))
      .then(
        (answer) => {
          // A phone the service does not hold yet, or a read it did not answer, draws no standing.
          if (!live) return;
          confirmed.current = "failure" in answer ? undefined : answer.notify;
          setStanding("failure" in answer ? undefined : answer);
        },
        (error: unknown) => console.error("The phone's notifications could not be read.", error),
      );
    return () => {
      live = false;
    };
  }, [acts, key]);
  const choose = useCallback(
    (notify: PushNotify) => {
      if (key === undefined || standing === undefined) return;
      picks.current += 1;
      const pick = picks.current;
      // Note that the choice is drawn at once and put back where the service did not take it, unless a later choice stands by then.
      setStanding({ ...standing, notify });
      const putBack = () => {
        const held = confirmed.current;
        if (pick === picks.current && held !== undefined) {
          setStanding((drawn) => drawn && { ...drawn, notify: held });
        }
      };
      acts[ACT_KIND.PUSH_DEVICE_NOTIFY]({ ...key, notify }).then((answer) => {
        if ("failure" in answer) putBack();
        else confirmed.current = notify;
      }, putBack);
    },
    [acts, key, standing],
  );
  // A phone iOS no longer lets notify draws no standing, whatever was read before.
  return { standing: key === undefined ? undefined : standing, choose };
}

/** Whether the choice named is one of "Notify me"'s, as a picker hands it back by its id. */
export function isPushNotify(id: string): id is PushNotify {
  return Object.values(PUSH_NOTIFY).some((notify) => notify === id);
}
