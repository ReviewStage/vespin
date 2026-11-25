// host-provider.tsx -- the host started as the app mounts, its document followed into the Query client every screen reads.

import type { ListedAgent } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import type { AppBridge } from "@repo/host/bridge";
import type { ActPortClient } from "@repo/host/contract";
import type { InboxRowsSource } from "@repo/host/inbox-rows";
import type { TaskListCollections } from "@repo/host/task-list-following";
import { listenToRow } from "@repo/host/task-list-row-readers";
import { type Collection, useLiveQuery } from "@tanstack/react-db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import Constants from "expo-constants";
import { useIsFocused } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { crashReportsErrorReporting, reportHostFailure } from "../crash-reports.js";
import {
  LAUNCH_PHASE,
  noteHostStarting,
  noteHostStood,
  noteLaunchPhase,
} from "../launch-phases.js";
import { HostFailedScreen, HostStartingScreen } from "../screens/host-failed.js";
import { releaseSplashAfterFrame } from "../splash.js";
import { followAppStateInto } from "./app-state-query.js";
import { busyAccountAnswer } from "./busy-account-server.js";
import { deviceSeams, hostStateRoot, onNetworkChanged } from "./device-seams.js";
import {
  launchBusyAccount,
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

/** How a screen counts a moment of the panel's surface vocabulary, such as a surface opened, through the host's bridge. */
export type HostCount = AppBridge["recordSurfaceEvent"];

/** Where the host's start stands: not yet answered, standing with its document in a client and its task list in collections, its act port, and its counts, or failed. */
type Standing =
  | {
      readonly client: QueryClient;
      readonly taskList: TaskListCollections;
      readonly acts: ActPortClient;
      readonly follow: HostFollow;
      readonly count: HostCount;
      readonly inboxRows: InboxRowsSource;
    }
  | { readonly failed: true };

/** The act port the screens act through, once the host stands. */
const HostActs = createContext<ActPortClient | undefined>(undefined);

/** The follows a screen holds open on the host, once it stands. */
const HostFollows = createContext<HostFollow | undefined>(undefined);

/** The counts a screen sends through the host, once it stands. */
const HostCounts = createContext<HostCount | undefined>(undefined);

/** The task list's collections, fed from the document the client holds, once the host stands. */
const TaskListCollectionsContext = createContext<TaskListCollections | undefined>(undefined);

/** The pool's Inbox kind, which the screens read where its items are kept on disk, once the host stands. */
const InboxRowsContext = createContext<InboxRowsSource | undefined>(undefined);

/** The pool's Inbox kind, for a live query over its kept items, for a screen drawn under `HostProvider`. */
export function useInboxRowsSource(): InboxRowsSource {
  const source = useContext(InboxRowsContext);

  if (source === undefined) throw new Error("A screen read the Inbox outside the host's provider.");

  return source;
}

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

/** No rows: what a read naming no key, or none the collection holds, answers before any is read. */
const NO_ROWS: readonly never[] = [];

/** Nothing to listen for: what a read with no key subscribes with. */
const LISTEN_TO_NOTHING = (): (() => void) => () => {};

/**
 * The row `key` names in one of the task list's collections (`.get(key)`),
 * drawn again only when that row moves, as the collection's one listener
 * tells it (`listenToRow`), and the same object until it does;
 * none where the collection holds no such row, or no key is given.
 */
export function useTaskListRow<Row extends object>(
  collection: Collection<Row, string>,
  key: string | undefined,
): Row | undefined {
  const subscribe = useCallback(
    (heard: () => void) => {
      if (key === undefined) return LISTEN_TO_NOTHING();

      return listenToRow(collection, key, heard);
    },
    [collection, key],
  );

  return useSyncExternalStore(subscribe, () =>
    key === undefined ? undefined : collection.get(key),
  );
}

/**
 * Whether one of the task list's collections holds any row, drawn again only
 * as that answer changes, with no query built over its rows.
 */
export function useTaskListHoldsAny<Row extends object>(
  collection: Collection<Row, string>,
): boolean {
  const subscribe = useCallback(
    (heard: () => void) => {
      const subscription = collection.subscribeChanges(heard);

      return () => subscription.unsubscribe();
    },
    [collection],
  );

  return useSyncExternalStore(subscribe, () => collection.size > 0);
}

/**
 * The rows `keys` name in one of the task list's collections (`.get(key)`),
 * in the keys' order, a key it holds no row for left out, drawn again only
 * when one of those rows moves, and the same array until one does or the
 * keys change. Note that it reads no other row, so a list that needs a few
 * of the account's thousands of tasks, such as the Inbox's holders, is
 * neither read whole nor drawn again as any other task moves.
 */
export function useTaskListRowsOf<Row extends object>(
  collection: Collection<Row, string>,
  keys: readonly string[],
): readonly Row[] {
  const held = useRef<readonly Row[]>(NO_ROWS);

  const subscribe = useCallback(
    (heard: () => void) => {
      const stops = [...new Set(keys)].map((key) => listenToRow(collection, key, heard));

      return () => {
        for (const stop of stops) stop();
      };
    },
    [collection, keys],
  );

  // Note that the rows read are the very array read last while each is the very row it held, as `useSyncExternalStore` asks of a snapshot.
  return useSyncExternalStore(subscribe, () => {
    const rows = keys.flatMap((key) => {
      const row = collection.get(key);

      return row === undefined ? [] : [row];
    });

    const last = held.current;

    if (rows.length === last.length && rows.every((row, at) => row === last[at])) return last;
    held.current = rows;

    return rows;
  });
}

/** No row: what a list read while it is not asked for answers. */
const NOT_READ: readonly never[] = [];

/**
 * Whether a place reads the task list whole: once the tab it stands on has
 * come in front, and from then on. Note that every tab mounts at launch, so
 * a tab standing behind that read the list whole took each of an account's
 * thousands of rows through its sorted reads as they landed, and a first
 * read of all of them as they were drawn, both on the JS thread the Inbox
 * draws on in the launch's first seconds; behind, it reads nothing until
 * it is first brought forward. A read begun holds every row in its first
 * render, and stays, so a page pushed over the tab, or the tab left, never
 * drops what it read only to read it again. Note that the tab's coming in
 * front is read deferred (`useDeferredValue`), because a read's first render
 * builds its live queries over every row, about 0.3 s of JS at a busy
 * account's size, and inside the tap's own commit it held the tab's switch
 * that long: the tab now commits at once, saying it is reading, and React
 * renders the read right after.
 */
export function useWholeListRead(): boolean {
  const inFront = useDeferredValue(useIsFocused());
  const [begun, begin] = useState(false);
  const reading = begun || inFront;

  useEffect(() => {
    if (reading) begin(true);
  }, [reading]);

  return reading;
}

/** Every row of one of the task list's pull-request collections, in no order, as one live query, drawn again only when one of them moves; none while `reading` is false, when nothing is read and no change is heard. */
export function useTaskListRows<Row extends object>(
  collection: Collection<Row, string>,
  reading = true,
): readonly Row[] {
  return useLiveQuery((q) => (reading ? q.from({ row: collection }) : undefined)).data ?? NOT_READ;
}

/**
 * The task list's tasks newest started first, as the document lists them, as one live query, drawn again only when one of them moves; none while `reading` is false, when nothing is read and no change is heard.
 */
export function useListedTasks(reading = true): readonly TaskSummary[] {
  const { tasks } = useTaskListCollections();

  return (
    useLiveQuery((q) =>
      reading
        ? q
            .from({ task: tasks })
            .orderBy(({ task }) => task.createdAt, "desc")
            .orderBy(({ task }) => task.id, { direction: "desc", stringSort: "lexical" })
        : undefined,
    ).data ?? NOT_READ
  );
}

/**
 * The task list's agents, the archived among them, first started first, as the document lists them, as one live query, drawn again only when one of them moves; none while `reading` is false, when nothing is read and no change is heard.
 */
export function useListedAgents(reading = true): readonly ListedAgent[] {
  const { agents } = useTaskListCollections();

  return (
    useLiveQuery((q) =>
      reading
        ? q
            .from({ agent: agents })
            .orderBy(({ agent }) => agent.createdAt)
            .orderBy(({ agent }) => agent.id, { stringSort: "lexical" })
        : undefined,
    ).data ?? NOT_READ
  );
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
  standStubAuthServer(launchBusyAccount() ? busyAccountAnswer : undefined);

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
 * Starts the host once, follows its document into a Query client of the
 * app's own, and draws the screens once the first reading is in it, so no
 * screen draws an empty document first; the launch splash stands until then
 * (`splash.ts`). A host that cannot stand is said on
 * the console, reported to Sentry, and shown in the screens' place with Try again, which starts it
 * again, rather than drawing an empty Inbox over nothing; a host that stands
 * but refuses its first read is said on the console too, and the screens
 * draw over the empty client, which the next delivery fills. Until the host
 * stands, the brand's ground stands in the screens' place, under the splash,
 * so no frame shows the window's own black in dark mode, as an empty tree
 * once did. The host is drained as the tree
 * unmounts, which on a device is the app ending.
 */
export function HostProvider({ children }: { readonly children: ReactNode }) {
  useEffect(() => followQueryLifecycle(AppState, onNetworkChanged), []);
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  // Each press of Try again starts the host anew.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let started: StandingMobileHost | undefined;
    let stopFollowing: (() => void) | undefined;
    setStanding(undefined);
    noteHostStarting();
    startMobileHost(launchOptions()).then(
      async (host) => {
        started = host;
        noteLaunchPhase(LAUNCH_PHASE.STARTED);
        const client = new QueryClient();
        const following = followAppStateInto(host.bridge, client);
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
          setStanding({
            client,
            taskList: following.taskList,
            acts: host.acts,
            follow: host.follow,
            count: host.bridge.recordSurfaceEvent,
            inboxRows: host.inboxRows,
          });
        } else void host.close();
      },
      (cause: unknown) => {
        console.error("The app's host could not start.", cause);
        reportHostFailure(cause);

        if (live) setStanding({ failed: true });
      },
    );

    return () => {
      live = false;
      stopFollowing?.();
      void started?.close();
    };
  }, [attempt]);
  // Note that the splash stands over the launch until the screens, or the failure in their place, first draw, so no blank screen shows while the host starts.
  useEffect(() => (standing === undefined ? undefined : releaseSplashAfterFrame()), [standing]);

  if (standing === undefined) return <HostStartingScreen />;

  if ("failed" in standing) {
    return <HostFailedScreen onRetry={() => setAttempt((count) => count + 1)} />;
  }

  return (
    <QueryClientProvider client={standing.client}>
      <HostActs.Provider value={standing.acts}>
        <HostFollows.Provider value={standing.follow}>
          <HostCounts.Provider value={standing.count}>
            <TaskListCollectionsContext.Provider value={standing.taskList}>
              <InboxRowsContext.Provider value={standing.inboxRows}>
                {children}
              </InboxRowsContext.Provider>
            </TaskListCollectionsContext.Provider>
          </HostCounts.Provider>
        </HostFollows.Provider>
      </HostActs.Provider>
    </QueryClientProvider>
  );
}
