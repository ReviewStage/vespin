import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import type { AppStateSnapshot, TaskListDelivery } from "@repo/host/app-state";
import {
  type AppStateBeside,
  type AppStateBridgeReads,
  followAppStateOver,
  shareAppState,
} from "@repo/host/app-state-reads";
import { type TaskListCollections, taskListFollowing } from "@repo/host/task-list-following";
import { type QueryClient, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Data, Effect, Predicate } from "effect";
import { useSyncExternalStore } from "react";
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
  selectInboxOn,
  selectInboxTasks,
  selectInboxWaiting,
  selectMachineCommandDevice,
  selectMachineCommands,
  selectMirrors,
  selectNetwork,
  selectNewAgentServersOff,
  selectNotifications,
  selectPortForwarding,
  selectRefusedAgents,
  selectRun,
  selectSessionReplay,
  selectSettingsHeld,
  selectSharesUsageData,
  selectSignedIn,
  selectStoredExperimentChoices,
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
  // Note that the lists the read answers beside the document are the collections', never the client's.
  ({ taskList: _lists, ...read }) =>
    read.run.fixtureMode ? Effect.promise(() => staged(read)) : Effect.succeed(read),
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

/**
 * The bridge's reads of `app:state`; none where the bridge cannot be heard,
 * as a test's fake answering other calls alone cannot (`testing/app-bridge.ts`
 * leaves a call it does not answer undefined), which leaves the client on
 * the document seeded into it.
 */
function heard(): AppStateBridgeReads | undefined {
  try {
    const bridge = appBridge();

    if (!Predicate.isFunction(bridge.onAppState)) return undefined;

    return {
      requestAppState: () => bridge.requestAppState(),
      onAppState: (listener) => bridge.onAppState(listener),
    };
  } catch {
    return undefined;
  }
}

/**
 * Writes drawn over a window's document before main's carries them.
 *
 * Why: main draws a pin's or a section's new place the moment it is asked,
 * but over IPC, so the window hears it a few frames later, and a list a drop
 * just reordered stood back in its old order meanwhile. So a write that moves
 * rows patches the document the window draws from at once, as React Query's
 * optimistic updates do, and since main's every delivery is written over the
 * document whole (`followAppStateOver`), one written before main took the ask
 * would undo the patch: each patch is laid again over every document main
 * delivers until its ask settles, by when main's own document carries it, or
 * has put it back. Nothing compares a patch with what main delivers.
 */
type AppStatePatch = (state: AppStateSnapshot) => AppStateSnapshot;

/** A window's document as main last delivered it, the patches drawn over it, and the document last written so. */
interface DrawnAhead {
  handed: AppStateSnapshot | undefined;
  patches: readonly AppStatePatch[];
  written: AppStateSnapshot | undefined;
}

/** Each window's document and patches, by the Query client the window holds. */
const drawnAhead = new WeakMap<QueryClient, DrawnAhead>();

/** The patches drawn over `client`'s document, kept for it. */
function aheadOf(client: QueryClient): DrawnAhead {
  const held = drawnAhead.get(client);

  if (held !== undefined) return held;
  const made: DrawnAhead = { handed: undefined, patches: [], written: undefined };
  drawnAhead.set(client, made);

  return made;
}

/** Writes `state`, as main delivered it, into `client`, every patch still out laid over it. */
function writeHanded(client: QueryClient, state: AppStateSnapshot): void {
  const ahead = aheadOf(client);
  ahead.handed = state;
  ahead.written = client.setQueryData(
    appStateQuery.queryKey,
    ahead.patches.reduce((drawn, patch) => patch(drawn), state),
  );
}

/** Draws `patch` over `client`'s document at once, and over every document main delivers, until `settled` settles. */
export function drawAhead(
  client: QueryClient,
  patch: AppStatePatch,
  settled: Promise<unknown>,
): void {
  const ahead = aheadOf(client);
  ahead.patches = [...ahead.patches, patch];
  const now = appStateIn(client);

  if (now !== undefined) ahead.written = client.setQueryData(appStateQuery.queryKey, patch(now));

  // Note that a settled patch is taken off main's document only where nothing but this layer wrote the document since, as a test's tree does, the document compared being the one the client keeps, which shares what did not move with the one before (`shareAppState`).
  const done = () => {
    ahead.patches = ahead.patches.filter((each) => each !== patch);

    if (ahead.handed !== undefined && appStateIn(client) === ahead.written) {
      writeHanded(client, ahead.handed);
    }
  };

  settled.then(done, done);
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
 * The task list's collections are fed beside the client: the task list's
 * rows each delivery carries beside the document (its `taskList`), handed on
 * as the delivery is heard and before the document it came with is written,
 * the lists a whole read answers beside the document under its version, and
 * a fixture run's staging as the list it lists from (`selectListedTasks`)
 * under its version; a staging that throws leaves
 * their rows standing and says so on them. A fixture run's list is its own
 * synthetic one, so the account's rows the host delivers are passed over
 * there, and those heard before the first read lands wait to learn whether
 * it is one.
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

  // Note that a fixture run's list is staged into the collections with its document, since the account's lists the host answers are passed over there.
  const shown = (state: AppStateSnapshot): void => {
    writeHanded(client, state);

    const staged = loadedTasksFixture()?.fixtureTasksView(state.run);

    if (staged !== undefined) taskList.write(state.version, staged);
  };

  // Answers the staging the state waits on in a fixture run, and nothing where it is written at once.
  const write = (state: AppStateSnapshot): Promise<void> | undefined => {
    if (fixtureRun === undefined) heardRun(state.run.fixtureMode);

    if (!state.run.fixtureMode && staging === undefined) {
      shown(state);
      takeRowsHeard();

      return undefined;
    }

    // Note that a staging that throws is reported and passed over, because the readings queued behind it must still land.
    const next = (staging ?? Promise.resolve())
      .then(() => staged(state))
      .then(
        (stagedState) => {
          if (following) shown(stagedState);
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

  // Hands on the task list's rows a delivery carries, those heard before the first document waiting on it, and the lists a whole read answers beside it.
  const beside: AppStateBeside = {
    heard: ({ taskList: rows }) => {
      if (rows === undefined) return;

      if (fixtureRun === undefined) rowsHeard.push(rows);
      else if (!fixtureRun) taskList.deliver(rows);
    },
    read: (read, lists) => {
      if (fixtureRun === undefined) heardRun(read.run.fixtureMode);

      if (!fixtureRun) taskList.write(read.version, lists);
    },
  };

  const followed =
    hearing === undefined
      ? undefined
      : followAppStateOver(
          hearing,
          write,
          (message, cause) => {
            console.error(message, cause);
          },
          beside,
        );

  const stopMoves = onFixtureMoved(() => {
    const held = followed?.held();

    if (held !== undefined) write(held);
  });

  return {
    written: followed?.written ?? Promise.resolve(),
    taskList: taskList.collections,
    stop: () => {
      following = false;
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

/** One slice of a client's document, as every reader of it shares it: the slice now, and a door to hear it change. */
interface SharedSlice<Slice> {
  readonly now: () => Slice | undefined;
  readonly subscribe: (heard: () => void) => () => void;
}

/** The document a slice was last cut from, and the slice it cut. */
interface SliceRead<Slice> {
  readonly state: AppStateSnapshot | undefined;
  readonly slice: Slice | undefined;
}

/** Who hears each client's document written, and the one cache listener they share while any does. */
interface DocumentHearing {
  readonly heard: Set<(state: AppStateSnapshot | undefined) => void>;
  stop: (() => void) | undefined;
}

/** Each client's hearing of its document's writes (`onDocumentWritten`). */
const documentHearings = new WeakMap<QueryClient, DocumentHearing>();

/** The slices read through `useAppStateSlice`, by the client they are read from and the select that cuts each. */
const sharedSlices = new WeakMap<QueryClient, Map<unknown, SharedSlice<unknown>>>();

/** Whether a cache event is the document's own. */
function isAppStateQuery(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && queryKey[0] === QUERY_ROOT.APP_STATE;
}

/**
 * Hears each write of `client`'s document, with the document written, until
 * the returned call stops it. Every hearer shares one listener on the
 * client's cache, which hears only the document's own write: the cache tells
 * each of its listeners of every observer a write updates too, hundreds on
 * one write, so a listener of each hearer's own was called hundreds of times
 * over on every write.
 */
export function onDocumentWritten(
  client: QueryClient,
  heard: (state: AppStateSnapshot | undefined) => void,
): () => void {
  const hearing = documentHearings.get(client) ?? { heard: new Set(), stop: undefined };
  documentHearings.set(client, hearing);
  hearing.heard.add(heard);

  hearing.stop ??= client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || !isAppStateQuery(event.query.queryKey)) return;
    // SAFETY: the document's query holds the document.
    const state = event.query.state.data as AppStateSnapshot | undefined;

    for (const each of [...hearing.heard]) each(state);
  });

  return () => {
    hearing.heard.delete(heard);

    if (hearing.heard.size > 0) return;
    hearing.stop?.();
    hearing.stop = undefined;
  };
}

/**
 * The slice `select` cuts from `client`'s document, shared by every reader:
 * one listener on the client's cache, which tells its readers only as the
 * slice itself changes. Note that a reader of its own (`useQuery` with a
 * `select`) is an observer the document query notifies on every write,
 * whatever moved, and a reader drawn once a row, as a chip's workspaces
 * are, made hundreds of them.
 */
function sharedSlice<Slice>(
  client: QueryClient,
  select: (state: AppStateSnapshot) => Slice,
): SharedSlice<Slice> {
  const byClient = sharedSlices.get(client) ?? new Map<unknown, SharedSlice<unknown>>();
  sharedSlices.set(client, byClient);
  const held = byClient.get(select);

  if (held !== undefined) {
    // SAFETY: a slice is kept under the select that cuts it, so the one found under `select` is a `Slice`'s.
    return held as SharedSlice<Slice>;
  }

  let read: SliceRead<Slice> = { state: undefined, slice: undefined };

  const sliced = (state: AppStateSnapshot | undefined): Slice | undefined => {
    if (state !== read.state)
      read = { state, slice: state === undefined ? undefined : select(state) };

    return read.slice;
  };

  const now = () => sliced(appStateIn(client));
  const readers = new Set<() => void>();
  let told = now();
  let stop: (() => void) | undefined;

  const heard = (state: AppStateSnapshot | undefined) => {
    const slice = sliced(state);

    if (slice === told) return;
    told = slice;

    for (const reader of readers) reader();
  };

  const made: SharedSlice<Slice> = {
    now,
    subscribe: (reader) => {
      if (readers.size === 0) {
        told = now();
        stop = onDocumentWritten(client, heard);
      }

      readers.add(reader);

      return () => {
        readers.delete(reader);

        if (readers.size > 0) return;
        stop?.();
        stop = undefined;
      };
    },
  };

  byClient.set(select, made);

  return made;
}

/**
 * The slice `select` cuts from the window's document, drawn again only as the
 * slice changes; none before the first read. For a slice many rows read, as
 * the workspaces and the account are: every reader shares one listener
 * rather than each being an observer the document query notifies on every
 * write (`sharedSlice`). `select` is a module's own function, so every
 * reader of a slice names the same one.
 */
export function useAppStateSlice<Slice>(
  select: (state: AppStateSnapshot) => Slice,
): Slice | undefined {
  const slice = sharedSlice(useQueryClient(), select);

  // Note that a surface drawn to a string (`renderToString`) reads the document the client holds, as `useQuery` does there.
  return useSyncExternalStore(slice.subscribe, slice.now, slice.now);
}
