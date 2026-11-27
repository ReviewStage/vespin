/**
 * push-device.ts -- the phone registered with the service for pushes while an account is signed in and iOS lets it notify, unregistered before a sign-out, and its "Notify me" and how its pushes fare as Settings reads and sets them.
 *
 * The phone is named by the raw APNs token iOS hands the app
 * (`getDevicePushTokenAsync`, never an Expo push token, so a notification's
 * words go only to Apple) and the gateway the token belongs to, which the
 * build decides (`BUILD_ENVIRONMENT`). The token is read once a launch and
 * followed while the app runs (`addPushTokenListener`), as Expo's guide has
 * it, since iOS may hand a new one after a restore, a reinstall, or at any
 * time, and the phone is registered again under each, so the service always
 * holds the token iOS hands now; a register is idempotent.
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

import { signedInAccountId } from "@repo/credentials/snapshot";
import { PUSH_NOTIFY_REFUSED } from "@repo/features/push-device-model";
import {
  PUSH_ENVIRONMENT,
  PUSH_NOTIFY,
  type PushDeviceStatusAnswer,
  type PushEnvironment,
  type PushNotify,
} from "@repo/features/push-device-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import type { ActPortClient } from "@repo/host/contract";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Predicate } from "effect";
import Constants from "expo-constants";
import {
  addPushTokenListener,
  type DevicePushToken,
  getDevicePushTokenAsync,
} from "expo-notifications";
import { useEffect, useState } from "react";
import { useChosenWorkspace } from "./chosen-workspace.js";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";
import {
  NOTIFICATION_STANDING,
  type NotificationStanding,
  useNotificationPermission,
} from "./notification-permission.js";
import { useWrite } from "./use-write.js";

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

/** The key iOS handed last, by this launch's read or a change since; none until iOS answers one. */
let keyRead: PushDeviceKey | undefined;

/** Whether the phone's token is followed: begun with the first read and kept for the launch. */
let tokenFollowed = false;

/** The screens told of a token iOS hands while the app runs. */
const keyHeard = new Set<(key: PushDeviceKey) => void>();

/** The key a fixture run names the phone by. */
const FIXTURE_KEY: PushDeviceKey = { token: FIXTURE_PUSH_TOKEN, environment: BUILD_ENVIRONMENT };

/** The key a token names, or none for one iOS handed empty. */
function keyOf(token: DevicePushToken): PushDeviceKey | undefined {
  return Predicate.isString(token.data) && token.data !== ""
    ? { token: token.data, environment: BUILD_ENVIRONMENT }
    : undefined;
}

/**
 * Follows the phone's token for the launch, so one iOS hands while the app
 * runs replaces the key read and reaches every screen holding it. Note that
 * the listener never reads the token itself, because Expo warns that a read
 * inside it can loop.
 */
function followDeviceKey(): void {
  if (tokenFollowed) return;
  tokenFollowed = true;
  addPushTokenListener((token) => {
    const key = keyOf(token);

    if (key === undefined || key.token === keyRead?.token) return;
    keyRead = key;
    tokenRead = Promise.resolve(key);

    for (const heard of keyHeard) heard(key);
  });
}

/** The phone's key, read once a launch: a fixture run's synthetic one, or iOS's own; none where iOS hands no token. */
function readDeviceKey(fixture: boolean): Promise<PushDeviceKey | undefined> {
  if (fixture) return Promise.resolve(FIXTURE_KEY);
  followDeviceKey();
  tokenRead ??= getDevicePushTokenAsync().then(
    (token) => {
      keyRead = keyOf(token) ?? keyRead;

      return keyRead;
    },
    (cause: unknown) => {
      // Note that a refusal is not kept, so the next screen to ask reads again.
      tokenRead = undefined;
      console.error("The phone's push token could not be read.", cause);

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

/**
 * Whether the phone counts as letting the app notify: iOS's permission
 * granted, or a fixture run, which stands for a phone that allowed
 * notifications, since a CI simulator never answers the permission's read.
 */
export function notificationsAllowed(
  fixture: boolean,
  standing: NotificationStanding | undefined,
): boolean {
  return fixture || standing === NOTIFICATION_STANDING.ALLOWED;
}

/** The phone's key once iOS lets it notify, read once a launch and followed after; none until then, or where iOS hands no token. */
export function usePushDeviceKey(): PushDeviceKey | undefined {
  const { standing } = useNotificationPermission();
  const fixture = useFixtureRun();
  const [key, setKey] = useState<PushDeviceKey | undefined>(undefined);
  const allowed = notificationsAllowed(fixture, standing);
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    readDeviceKey(fixture).then((read) => {
      if (live) setKey(read);
    });
    keyHeard.add(setKey);

    return () => {
      live = false;
      keyHeard.delete(setKey);
    };
  }, [allowed, fixture]);

  return allowed ? key : undefined;
}

/** The workspace the phone works in, as the app's screens last chose it, which each register names; none until the account's workspaces are read. */
let workspaceChosen: string | undefined;

/** This launch's register of the phone under the account signed in, and the token and workspace it named, which a read of its standing waits for. */
let registration:
  | {
      readonly token: string;
      readonly workspaceId: string | undefined;
      readonly done: Promise<void>;
    }
  | undefined;

/** The latest register sent, which the next one waits on, so a late answer for an account signed out of can never land after the next account's. */
let lastRegister: Promise<void> = Promise.resolve();

/**
 * The phone registered under the account signed in, once for its token and
 * the workspace it works in until a sign-out unregisters it: the register
 * under way, or done, where one was asked already. The workspace is named so
 * the badge a push sets counts the threads of the Inbox the phone lists,
 * that workspace's alone, and a choice of another registers it again. Note
 * that a read of the phone's standing, and a Live Activity's token
 * (`live-activity/`), wait on it, so the service holds the phone each names.
 */
export function registeredPushDevice(acts: ActPortClient, key: PushDeviceKey): Promise<void> {
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;

  if (bundleId === undefined) return Promise.resolve();

  const workspaceId = workspaceChosen;

  if (registration?.token === key.token && registration.workspaceId === workspaceId) {
    return registration.done;
  }

  const done = lastRegister
    .then(() =>
      acts[ACT_KIND.PUSH_DEVICE_REGISTER]({
        ...key,
        bundleId,
        ...(workspaceId === undefined ? undefined : { workspaceId }),
      }),
    )
    .then(
      (answer) => {
        // Note that a register the service did not take is asked again by the next screen that reads.
        if ("failure" in answer) registration = undefined;
      },
      (cause: unknown) => {
        registration = undefined;
        console.error("The phone was not registered for notifications.", cause);
      },
    );

  registration = { token: key.token, workspaceId, done };
  lastRegister = done;

  return done;
}

/**
 * The phone registered under the account signed in, once a launch while iOS
 * lets it notify, and again as another workspace is chosen; nothing while
 * signed out. Note that nothing here asks iOS's
 * prompt: the Inbox asks it in place, saying why first (`notification-ask.tsx`),
 * since iOS raises it once an install and a prompt raised the moment an
 * account signs in was refused before any ask had been seen.
 */
export function usePushRegistration(signedIn: boolean): void {
  const acts = useHostActs();
  const key = usePushDeviceKey();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const workspaceId = useChosenWorkspace(workspaces).chosen?.id;
  useEffect(() => {
    workspaceChosen = workspaceId;

    if (!signedIn) {
      // Note that a sign-out the app did not start, such as a refused renewal, runs no unregister, so the next account registers afresh.
      registration = undefined;

      return;
    }

    if (key === undefined) return;
    registeredPushDevice(acts, key).catch(() => undefined);
  }, [acts, signedIn, key, workspaceId]);
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
      (cause: unknown) => console.error("The phone was not unregistered.", cause),
    );
  });

  lastRegister = done;

  return done;
}

/**
 * The phone registered again under the account still signed in, where a
 * sign-out unregistered it and then did not go, so its pushes come back at
 * once rather than at the next launch. It names the phone by the token this
 * launch read, as the unregister did; nothing where none was read.
 */
export function reregisterPushDevice(acts: ActPortClient, fixture: boolean): Promise<void> {
  const key = fixture ? FIXTURE_KEY : keyRead;

  return key === undefined ? Promise.resolve() : registeredPushDevice(acts, key);
}

type UsePushDeviceStandingResult = {
  readonly standing: PushDeviceStatusAnswer | undefined;
  readonly choose: (notify: PushNotify) => void;
};

/** Where the phone's standing is kept among the app's queries, and its "Notify me" writes among its mutations. */
const PUSH_STANDING_QUERY = "push-device-standing";

/**
 * The phone's standing as Settings draws it, none until the service
 * answers, and the "Notify me" choice made from it, as the panel's
 * `useFavoriteMutation` keeps a starred row. One query, kept under the
 * account signed in, is shared by Settings' list and its Notifications
 * page, so a choice made on the page reads at once on the list beneath it.
 * The choices share one scope, so they reach the service in the order they
 * were made; the newest still out is drawn over what the service last held,
 * so a refused one falls back to the choice the service took, and a landed
 * one is laid into the query once any read still out is let go.
 */
export function usePushDeviceStanding(key: PushDeviceKey | undefined): UsePushDeviceStandingResult {
  const acts = useHostActs();
  const write = useWrite();
  const queries = useQueryClient();

  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const queryKey = [PUSH_STANDING_QUERY, accountId, key?.token];
  const mutationKey = [PUSH_STANDING_QUERY, accountId];

  // A phone the service does not hold yet, or a read it did not answer, draws no standing.
  const { data: read } = useQuery({
    queryKey,
    enabled: key !== undefined,
    retry: false,
    queryFn: () =>
      key === undefined
        ? null
        : registeredPushDevice(acts, key)
            .then(() => acts[ACT_KIND.PUSH_DEVICE_STATUS](key))
            .then((answer) => ("failure" in answer ? null : answer)),
  });

  const { mutate } = useMutation({
    mutationKey,
    scope: { id: PUSH_STANDING_QUERY },
    // Note that a pick offers no Try again, which could replay an older choice over a newer one; picking again is the retry.
    mutationFn: (notify: PushNotify) =>
      key === undefined
        ? Promise.resolve(false)
        : write(() => acts[ACT_KIND.PUSH_DEVICE_NOTIFY]({ ...key, notify }), {
            refused: (answer) => ("failure" in answer ? PUSH_NOTIFY_REFUSED : undefined),
          }),
    onMutate: () => queries.cancelQueries({ queryKey }),
    onSuccess: async (went, notify) => {
      if (!went) return;
      await queries.cancelQueries({ queryKey });
      queries.setQueryData<PushDeviceStatusAnswer | null>(
        queryKey,
        (held) => held && { ...held, notify },
      );
    },
  });

  const picked = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables,
  }).findLast(isPushNotify);

  const standing =
    read == null ? undefined : picked === undefined ? read : { ...read, notify: picked };

  // A phone iOS no longer lets notify draws no standing, whatever was read before.
  return {
    standing: key === undefined ? undefined : standing,
    choose: (notify) => {
      if (standing !== undefined) mutate(notify);
    },
  };
}

/** Whether the choice named is one of "Notify me"'s, as a picker hands it back by its id. */
export function isPushNotify(id: unknown): id is PushNotify {
  return Object.values(PUSH_NOTIFY).some((notify) => notify === id);
}
