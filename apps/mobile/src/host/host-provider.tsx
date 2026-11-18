// host-provider.tsx -- the host started as the app mounts, its document followed into the Query client every screen reads.

import NetInfo from "@react-native-community/netinfo";
import type { ListedAgent } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import type { ActPortClient } from "@repo/host/contract";
import {
  type TaskListCollections,
  type TaskListFollowing,
  taskListFollowing,
} from "@repo/host/task-list-following";
import { type Collection, useLiveQuery } from "@tanstack/react-db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import Constants from "expo-constants";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Platform } from "react-native";
import { crashReportsErrorReporting, reportHostFailure } from "../crash-reports.js";
import { noteHostStarting, noteHostStood } from "../launch-phases.js";
import { HostFailedScreen } from "../screens/host-failed.js";
import { releaseSplashAfterFrame } from "../splash.js";
import { followAppStateInto } from "./app-state-query.js";
import { deviceSeams, hostStateRoot } from "./device-seams.js";
import { type HostCount, type HostToCome, hostToCome } from "./host-to-come.js";
import {
  launchFixtureProfile,
  launchInboxOff,
  launchMachineAsk,
  launchRefusesWrites,
  launchSetupOwed,
  launchStubsAuthServer,
  launchUpdateNeeded,
} from "./launch-arguments.js";
import {
  type HostFollow,
  type MobileHostStartOptions,
  type StandingMobileHost,
  startMobileHost,
} from "./mobile-runtime.js";
import { followQueryLifecycle } from "./query-lifecycle.js";
import { standStubAuthServer, stubAuthSession } from "./stub-auth-server.js";

/** The version a build that names none reports, which no shipped build is. */
const UNVERSIONED = "0.0.0";

/** The app's version, as the host and the share sheet name it to the service. */
export const APP_VERSION = Constants.expoConfig?.version ?? UNVERSIONED;

export type { HostCount };

/**
 * One start of the host, as the screens are handed it from the first frame:
 * the client its document is followed into, the task list's collections,
 * and the host to come, whose acts, follows and counts wait for it to stand.
 */
interface Launching {
  readonly client: QueryClient;
  readonly taskList: TaskListFollowing;
  readonly host: HostToCome;
}

/** A start of the host not yet begun: an empty client, the task list's collections, and the host to come. */
function launching(): Launching {
  return { client: new QueryClient(), taskList: taskListFollowing(), host: hostToCome() };
}

/** The act port the screens act through, once the host stands. */
const HostActs = createContext<ActPortClient | undefined>(undefined);

/** The follows a screen holds open on the host, once it stands. */
const HostFollows = createContext<HostFollow | undefined>(undefined);

/** The counts a screen sends through the host, once it stands. */
const HostCounts = createContext<HostCount | undefined>(undefined);

/** The task list's collections, fed from the document the client holds, once the host stands. */
const TaskListCollectionsContext = createContext<TaskListCollections | undefined>(undefined);

/** The host's act port, for a screen drawn under `HostProvider`. */
export function useHostActs(): ActPortClient {
  const acts = useContext(HostActs);

  if (acts === undefined) throw new Error("A screen acted outside the host's provider.");

  return acts;
}

/** How a screen drawn under `HostProvider` holds a follow open on the host, such as a transcript's, until it lets it go. */
export function useHostFollow(): HostFollow {
  const follow = useContext(HostFollows);

  if (follow === undefined) throw new Error("A screen followed outside the host's provider.");

  return follow;
}

/** How a screen drawn under `HostProvider` counts a moment through the host (`surface-open.ts`). */
export function useHostCount(): HostCount {
  const count = useContext(HostCounts);

  if (count === undefined) throw new Error("A screen counted outside the host's provider.");

  return count;
}

/** The task list's collections, for a live query over its tasks or agents, for a screen drawn under `HostProvider`. */
export function useTaskListCollections(): TaskListCollections {
  const collections = useContext(TaskListCollectionsContext);

  if (collections === undefined) {
    throw new Error("A screen read the task list outside the host's provider.");
  }

  return collections;
}

/** Nothing to listen for: what a read with no key subscribes with. */
const LISTEN_TO_NOTHING = (): (() => void) => () => {};

/**
 * The row `key` names in one of the task list's collections (`.get(key)`),
 * drawn again only when that row moves, and the same object until it does;
 * none where the collection holds no such row, or no key is given.
 */
export function useTaskListRow<Row extends object>(
  collection: Collection<Row, string>,
  key: string | undefined,
): Row | undefined {
  const subscribe = useCallback(
    (heard: () => void) => {
      if (key === undefined) return LISTEN_TO_NOTHING();

      const subscription = collection.subscribeChanges((changes) => {
        if (changes.some((change) => change.key === key)) heard();
      });

      return () => subscription.unsubscribe();
    },
    [collection, key],
  );

  return useSyncExternalStore(subscribe, () =>
    key === undefined ? undefined : collection.get(key),
  );
}

/** Every row of one of the task list's pull-request collections, in no order, as one live query, drawn again only when one of them moves. */
export function useTaskListRows<Row extends object>(
  collection: Collection<Row, string>,
): readonly Row[] {
  return useLiveQuery((q) => q.from({ row: collection })).data;
}

/** The task list's tasks newest started first, as the document lists them, as one live query, drawn again only when one of them moves. */
export function useListedTasks(): readonly TaskSummary[] {
  const { tasks } = useTaskListCollections();

  return useLiveQuery((q) =>
    q
      .from({ task: tasks })
      .orderBy(({ task }) => task.createdAt, "desc")
      .orderBy(({ task }) => task.id, { direction: "desc", stringSort: "lexical" }),
  ).data;
}

/** The task list's agents, the archived among them, first started first, as the document lists them, as one live query, drawn again only when one of them moves. */
export function useListedAgents(): readonly ListedAgent[] {
  const { agents } = useTaskListCollections();

  return useLiveQuery((q) =>
    q
      .from({ agent: agents })
      .orderBy(({ agent }) => agent.createdAt)
      .orderBy(({ agent }) => agent.id, { stringSort: "lexical" }),
  ).data;
}

/**
 * What this launch starts the host on: the device, or, where a flow names
 * the stubbed account service, the device with its sign-in sheet and every
 * service call answered by the stub (`standStubAuthServer`) and its socket
 * never reached.
 */
function launchOptions(): MobileHostStartOptions {
  const device = deviceSeams();

  const base = {
    errorReporting: crashReportsErrorReporting,
    fixture: launchFixtureProfile(),
    fixtureUpdateNeeded: launchUpdateNeeded(),
    fixtureMachineAsk: launchMachineAsk(),
    fixtureSetupOwed: launchSetupOwed(),
    fixtureInboxOff: launchInboxOff(),
    fixtureRefusesWrites: launchRefusesWrites(),
    appVersion: APP_VERSION,
    stateRoot: hostStateRoot(),
  };

  if (!launchStubsAuthServer()) return { ...base, device };
  standStubAuthServer();

  return {
    ...base,
    device: {
      ...device,
      authSession: stubAuthSession,
      openSocket: () => Effect.succeed({ unreachable: true }),
    },
  };
}

/**
 * Starts the host once, and draws the screens at once over its client,
 * which its document is followed into as it stands, so a launch shows its
 * screens, the Inbox saying it reads until its first reading, rather than the
 * splash while the host starts; the launch splash goes a frame after the
 * screens first draw (`splash.ts`). What the screens act, follow, and count
 * through meanwhile waits for the host (`hostToCome`). A host that cannot
 * stand is said on the console, reported to Sentry, refuses what waited, and
 * is shown in the screens' place with Try again, which starts it again over
 * a client of its own; a host that stands but refuses its first read is
 * said on the console too, and the screens stand over the empty client,
 * which the next delivery fills. The host is drained as the tree unmounts,
 * which on a device is the app ending.
 */
export function HostProvider({ children }: { readonly children: ReactNode }) {
  useEffect(() => followQueryLifecycle(AppState, Platform, NetInfo.addEventListener), []);
  // Each press of Try again starts the host anew, over a client and collections of its own.
  const [current, setCurrent] = useState(launching);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let started: StandingMobileHost | undefined;
    let stopFollowing: (() => void) | undefined;
    noteHostStarting();
    startMobileHost(launchOptions()).then(
      async (host) => {
        started = host;
        const following = followAppStateInto(host.bridge, current.client, current.taskList);
        stopFollowing = following.stop;

        try {
          await following.written;
        } catch (error) {
          console.error(
            "The host's document could not be read; the next delivery asks again.",
            error,
          );
        }

        if (live) {
          noteHostStood();
          current.host.stand({
            acts: host.acts,
            follow: host.follow,
            count: host.bridge.recordSurfaceEvent,
          });
        } else void host.close();
      },
      (cause: unknown) => {
        console.error("The app's host could not start.", cause);
        reportHostFailure(cause);

        // Note that only the start still standing refuses what waits on it, so one an unmount left behind never refuses a press meant for the next.
        if (live) {
          current.host.fail(cause);
          setFailed(true);
        }
      },
    );

    return () => {
      live = false;
      stopFollowing?.();
      void started?.close();
    };
  }, [current]);
  // Note that the splash goes a frame after the screens first draw, the host's start or not, so it never stands over a launch longer than its own first frame.
  useEffect(() => releaseSplashAfterFrame(), []);

  if (failed) {
    return (
      <HostFailedScreen
        onRetry={() => {
          setFailed(false);
          setCurrent(launching());
        }}
      />
    );
  }

  return (
    <QueryClientProvider client={current.client}>
      <HostActs.Provider value={current.host.acts}>
        <HostFollows.Provider value={current.host.follow}>
          <HostCounts.Provider value={current.host.count}>
            <TaskListCollectionsContext.Provider value={current.taskList.collections}>
              {children}
            </TaskListCollectionsContext.Provider>
          </HostCounts.Provider>
        </HostFollows.Provider>
      </HostActs.Provider>
    </QueryClientProvider>
  );
}
