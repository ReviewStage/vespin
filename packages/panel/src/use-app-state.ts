import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import type { AppStateDelivery, AppStateSnapshot, TaskListDelivery } from "@repo/host/app-state";
import {
  type AppStateBridgeReads,
  followAppStateOver,
  shareAppState,
} from "@repo/host/app-state-reads";
import { type TaskListCollections, taskListFollowing } from "@repo/host/task-list-following";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { Data, Effect, Predicate } from "effect";
import { appBridge } from "./app-bridge.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise } from "./renderer-runtime.js";
import { onFixtureMoved } from "./tasks/fixture-moves.js";
import {
  handFixtureClient,
  loadedTasksFixture,
  loadTasksFixture,
} from "./tasks/tasks-fixture-loader.js";

/**
 * What a surface reads of the document is said once beneath the panel and
 * the Expo app (`@repo/host/app-state-reads`); the panel's readers reach it
 * here, as they always have.
 */
export {
  memoizedSelect,
  type SignedInAccount,
  sameAccount,
  selectAccount,
  selectAdminAccess,
  selectAdminAccessPending,
  selectAppSettingsView,
  selectAudio,
  selectCapability,
  selectExperiment,
  selectFailedRuns,
  selectInbox,
  selectInboxTasks,
  selectInboxWaiting,
  selectMachineCommandDevice,
  selectMachineCommands,
  selectMirrors,
  selectNetwork,
  selectNotifications,
  selectPortForwarding,
  selectPullRequestPublished,
  selectRefusedAgents,
  selectRun,
  selectSessionReplay,
  selectSettingsHeld,
  selectSignedIn,
  selectStoredExperimentChoices,
  selectTaskListStanding,
  selectTaskSendRefused,
  selectTasks,
  selectVoiceCall,
  selectWorkspaces,
  supportAccessStanding,
} from "@repo/host/app-state-reads";

/** The bridge refused the one read, so this window has no document to draw. */
class AppStateUnread extends Data.TaggedError("AppStateUnread")<{
  readonly cause: unknown;
}> {}

/**
 * The document as this window draws it: main's, but in a fixture run, which
 * signs in to nothing, with what its profile stages laid over it, such as a
 * synthetic account signed in (`tasks-fixture.ts`'s `fixtureAppState`). Note
 * that the fixture is imported before the run's first document is handed
 * on, because no reader may draw that document unstaged first.
 */
function staged(state: AppStateSnapshot): Promise<AppStateSnapshot> {
  return loadTasksFixture().then(() => loadedTasksFixture()?.fixtureAppState(state) ?? state);
}

/** The document as main holds it, read once and staged in a fixture run. */
const firstRead: Effect.Effect<AppStateSnapshot, AppStateUnread> = Effect.flatMap(
  Effect.tryPromise({
    try: () => appBridge().requestAppState(),
    catch: (cause) => new AppStateUnread({ cause }),
  }),
  (read) => (read.run.fixtureMode ? Effect.promise(() => staged(read)) : Effect.succeed(read)),
);

/**
 * The document as one TanStack Query query, which a surface reads its part of
 * with `useQuery({ ...appStateQuery, select })` and a callback that cannot
 * wait a render with `getQueryData(appStateQuery.queryKey)` on the client
 * `useQueryClient` hands it. Every reading is written into the cache as it
 * arrives (`followAppState`), the first before anything is drawn, so it is
 * never stale (`staleTime: Infinity`, as the docs' guide to data pushed over
 * a socket has it) and never read again; its `queryFn`, a read of its own, stands only for a reader on a
 * client nothing follows into. A read the bridge refused is not tried
 * again, since the window shows that failure at once. Its structural
 * sharing, which every reader's `select` answer shares as well, keeps the
 * readers on the document's own objects (`shareAppState`).
 *
 * Note that the read answers the document the client holds where that is as
 * new, because the subscription may have written a later reading while the
 * read was in flight, and Query lays what the `queryFn` answers over it.
 */
export const appStateQuery = queryOptions({
  queryKey: [QUERY_ROOT.APP_STATE],
  queryFn: ({ client }) =>
    rendererPromise(firstRead).then((read) => {
      const held: AppStateSnapshot | undefined = client.getQueryData([QUERY_ROOT.APP_STATE]);

      return held !== undefined && held.version >= read.version ? held : read;
    }),
  staleTime: Infinity,
  structuralSharing: shareAppState,
  retry: false,
});

/** The bridge's reads of `app:state`, and its pushes of the task list's rows beside them. */
interface BridgeHeard extends AppStateBridgeReads {
  readonly onTaskList: (listener: (delivery: TaskListDelivery) => void) => () => void;
}

/** Hears nothing, for a bridge that pushes no task list, as a test's fake answering the document alone. */
const hearsNothing = (): (() => void) => () => undefined;

/**
 * The bridge's reads of `app:state` and `app:task-list`; none where the
 * bridge cannot be heard, as a test's fake answering other calls alone
 * cannot (`testing/app-bridge.ts` leaves a call it does not answer
 * undefined), which leaves the client on the document seeded into it.
 */
function heard(): BridgeHeard | undefined {
  try {
    const bridge = appBridge();

    if (!Predicate.isFunction(bridge.onAppState)) return undefined;
    const onTaskList = Predicate.isFunction(bridge.onTaskList) ? bridge.onTaskList : hearsNothing;

    return {
      requestAppState: () => bridge.requestAppState(),
      onAppState: (listener) => bridge.onAppState(listener),
      onTaskList: (listener) => onTaskList(listener),
    };
  } catch {
    return undefined;
  }
}

/** A window's following of `app:state` into its Query client: its first whole read written, the task list's collections it feeds beside it, and how it stops. */
export interface AppStateFollowing {
  /** Settles once the first whole read is written into the client, and fails where the bridge refused it. */
  readonly written: Promise<void>;
  /** The task list's rows as collections, written from the very documents the client is (`task-list-collections.tsx`). */
  readonly taskList: TaskListCollections;
  readonly stop: () => void;
}

/**
 * Writes every reading of the document into `client` with `setQueryData`,
 * as the docs' guide to data pushed over a socket does, from the moment it
 * is called until it is stopped. A root calls it once per window, before
 * anything is drawn, and draws once `written` settles, so the window's
 * first frame holds what moved while it was being read; a test's tree calls
 * it beside its own client (`testing/copy-feedback.ts`). How each delivery
 * is laid over the document held is the host's own rule
 * (`@repo/host/app-state-reads`'s `followAppStateOver`).
 *
 * A fixture run's stage moving on its own (`fixture-moves.ts`) hands the
 * document held on to be staged anew, and its staging waits on the fixture,
 * so its writes queue behind one another; one that throws is reported and
 * passed over. The client is handed to the fixture while it is written
 * into, whose staged acts read the run from it (`act.ts`).
 *
 * The task list's collections are fed beside the client: each push of the
 * rows a drawing moved (`app:task-list`), which the bridge sends just before
 * the document they moved in, and a whole read or a fixture run's staging
 * as the list it lists from (`selectListedTasks`) under its version; a
 * staging that throws leaves their rows standing and says so on them. A
 * fixture run's list is its own synthetic one, so the host's pushes of
 * the account's rows are passed over there, and those heard before the
 * first read lands wait to learn whether it is one.
 */
export function followAppState(client: QueryClient): AppStateFollowing {
  let following = true;
  let staging: Promise<void> | undefined;
  const taskList = taskListFollowing();
  /** Whether the window draws a fixture run's list; unknown before the first read lands, while the pushes heard wait in `rowsHeard`. */
  let fixtureRun: boolean | undefined;
  let rowsHeard: TaskListDelivery[] = [];

  // Learns from the first document written whether the run is a fixture's, passing over the pushes heard before it where it is.
  const heardRun = (fixture: boolean): void => {
    fixtureRun = fixture;

    if (fixture) rowsHeard = [];
  };

  // Lays the pushes heard before the first document, once it is laid.
  const takeRowsHeard = (): void => {
    const waiting = rowsHeard;
    rowsHeard = [];

    for (const delivery of waiting) taskList.deliver(delivery);
  };

  const shown = (state: AppStateSnapshot, whole: boolean): void => {
    client.setQueryData(appStateQuery.queryKey, state);

    if (whole) taskList.write(state.version, selectListedTasks(state));
  };

  // Answers the staging the state waits on in a fixture run, and nothing where it is written at once.
  const write = (
    state: AppStateSnapshot,
    delivery?: AppStateDelivery,
  ): Promise<void> | undefined => {
    if (fixtureRun === undefined) heardRun(state.run.fixtureMode);

    if (!state.run.fixtureMode && staging === undefined) {
      shown(state, delivery === undefined);
      takeRowsHeard();

      return undefined;
    }

    // Note that a staging that throws is reported and passed over, because the readings queued behind it must still land.
    const next = (staging ?? Promise.resolve())
      .then(() => staged(state))
      .then(
        (stagedState) => {
          if (following) shown(stagedState, true);
        },
        (cause: unknown) => {
          console.error("A fixture run's document could not be staged.", cause);
          taskList.trouble(cause);
        },
      )
      .then(() => {
        if (staging === next) staging = undefined;
      });

    staging = next;

    return next;
  };

  const takeBack = handFixtureClient(client);
  const hearing = heard();

  // Note that the task list's pushes are heard before the document is read, as the document's are, so none sent meanwhile is lost.
  const stopRows = hearing?.onTaskList((delivery) => {
    if (fixtureRun === undefined) rowsHeard.push(delivery);
    else if (!fixtureRun) taskList.deliver(delivery);
  });

  const followed =
    hearing === undefined
      ? undefined
      : followAppStateOver(hearing, write, (message, cause) => {
          console.error(message, cause);
        });

  const stopMoves = onFixtureMoved(() => {
    const held = followed?.held();

    if (held !== undefined) write(held);
  });

  return {
    written: followed?.written ?? Promise.resolve(),
    taskList: taskList.collections,
    stop: () => {
      following = false;
      stopRows?.();
      followed?.stop();
      stopMoves();
      takeBack();
      taskList.stop();
    },
  };
}

/**
 * The task list the window lists from: main's document's, or a fixture run's
 * synthetic one, which main's document holds none of. Note that the fixture
 * has landed before a fixture run's first document is handed on (`staged`),
 * so the select reads it at once.
 */
export const selectListedTasks = (state: AppStateSnapshot): TasksView =>
  loadedTasksFixture()?.fixtureTasksView(state.run) ?? state.tasks;

/** Whether a fixture run's synthetic tasks stand in for the account's, so its writes go nowhere. */
export const selectFixtureStaged = (state: AppStateSnapshot): boolean =>
  loadedTasksFixture()?.fixtureTasksView(state.run) !== undefined;

/** Where the task list stands on its agents: carried, which it is only once followed live, failed before it was, or still being read. */
export const AGENTS_LISTED = {
  CARRIED: "carried",
  FAILED: "failed",
  READING: "reading",
} as const;

export type AgentsListed = (typeof AGENTS_LISTED)[keyof typeof AGENTS_LISTED];

/**
 * Where the task list the window lists from stands on its agents, which the
 * collections (`task-list-collections.tsx`) cannot say, since they hold a
 * list not yet carried as one with no rows: carried once the list says its
 * lists are drawn (`listed`).
 */
export const selectAgentsListed = (state: AppStateSnapshot): AgentsListed => {
  const listed = selectListedTasks(state);

  if (listed.listed === true) return AGENTS_LISTED.CARRIED;

  return listed.listStatus === TASKS_READ.FAILED ? AGENTS_LISTED.FAILED : AGENTS_LISTED.READING;
};

/** Whether the last read of the workspaces the window lists did not land, those held still drawn. */
export const selectWorkspacesFailed = (state: AppStateSnapshot): boolean =>
  selectListedTasks(state).workspacesStatus === TASKS_READ.FAILED;

/**
 * The document as `client` holds it, for a callback that cannot wait a
 * render: two acts asked in one breath arrive as two calls in one turn, and
 * the second has to read what the first left. The client is the caller's,
 * `useQueryClient`'s in a component and the one a test drew with in a test,
 * read with `getQueryData` as the docs' guide to reading the cache outside a
 * component does. Not a hook, so nothing redraws for it.
 */
export function appStateIn(client: QueryClient): AppStateSnapshot | undefined {
  return client.getQueryData(appStateQuery.queryKey);
}
