/**
 * task-list-collections.tsx -- the task list's tasks, agents, and agent pull requests as TanStack DB collections, fed by the window's one follow of its document.
 *
 * A screen that reads the task list off `appStateQuery` derives again from
 * every row whenever any row moves. These collections hold the same rows
 * keyed by id, so a live query (`useLiveQuery`) or a lookup (`findOne`,
 * `.get(key)`) is told only the rows that moved. They are fed from the
 * documents `followAppState` writes into the window's Query client, so the
 * two never disagree and `app:state` is still subscribed to once
 * (`AGENTS.md`'s "One state channel in").
 *
 * Each collection's sync is a custom one, as TanStack DB's Collection Options
 * Creator guide writes it: it listens before it reads, takes the document
 * held as its snapshot and marks itself ready, then writes each later
 * document's moved rows in one `begin()`/`write()`/`commit()`. The follow
 * (`followAppStateOver`) already buffers the deliveries heard before its
 * first read and drops one older than the document held, so the feed has
 * nothing left to buffer and only passes over a version older than its last.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import type { ListedPullRequest, TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { type Collection, type CollectionConfig, createCollection } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useCallback, useSyncExternalStore } from "react";

/** One document as the follow wrote it: its version and the task list it lists from. */
interface ListedView {
  readonly version: number;
  readonly view: TasksView;
}

/** What the feed tells a collection's sync. */
const FEED_TOLD = {
  VIEW: "view",
  TROUBLE: "trouble",
} as const;

type FeedTold =
  | { readonly kind: typeof FEED_TOLD.VIEW; readonly listed: ListedView }
  | { readonly kind: typeof FEED_TOLD.TROUBLE; readonly cause: unknown };

/** The feed between the follow and the collections: the last document written, and every one written or failed after it. */
interface TaskListFeed {
  readonly held: () => ListedView | undefined;
  readonly listen: (hear: (told: FeedTold) => void) => () => void;
}

/** The feed as the follow holds it: what it writes or fails to write, told to every collection listening. */
interface TaskListFeedWriter extends TaskListFeed {
  readonly write: (listed: ListedView) => void;
  readonly trouble: (cause: unknown) => void;
}

/** One collection of the task list: the part of the view it holds and the field its rows are keyed by. */
interface TaskListPart<Row extends object> {
  readonly id: string;
  readonly rowsOf: (view: TasksView) => readonly Row[] | undefined;
  readonly keyOf: (row: Row) => string;
}

const TASKS_PART: TaskListPart<TaskSummary> = {
  id: "task-list-tasks",
  rowsOf: (view) => view.tasks,
  keyOf: (task) => task.id,
};

const AGENTS_PART: TaskListPart<ListedAgent> = {
  id: "task-list-agents",
  rowsOf: (view) => view.taskAgents,
  keyOf: (agent) => agent.id,
};

const AGENT_PULL_REQUESTS_PART: TaskListPart<ListedPullRequest> = {
  id: "task-list-agent-pull-requests",
  rowsOf: (view) => view.agentPullRequests,
  keyOf: (listed) => listed.agentId,
};

/** The feed the follow writes into. */
function taskListFeed(): TaskListFeedWriter {
  let held: ListedView | undefined;
  const listeners = new Set<(told: FeedTold) => void>();

  const tell = (told: FeedTold): void => {
    for (const hear of listeners) hear(told);
  };

  return {
    held: () => held,
    listen: (hear) => {
      listeners.add(hear);

      return () => {
        listeners.delete(hear);
      };
    },
    write: (listed) => {
      held = listed;
      tell({ kind: FEED_TOLD.VIEW, listed });
    },
    trouble: (cause) => tell({ kind: FEED_TOLD.TROUBLE, cause }),
  };
}

/**
 * A collection holding one part of the task list, synced from `feed`; a part
 * whose list is the very one held is not walked at all. It is never
 * collected while the window stands (`gcTime: Infinity`), since the follow
 * feeds it for the window's life and a resync would write every row again.
 */
function partCollectionOptions<Row extends object>(
  part: TaskListPart<Row>,
  feed: TaskListFeed,
): CollectionConfig<Row, string> {
  return {
    id: part.id,
    getKey: part.keyOf,
    startSync: true,
    gcTime: Infinity,
    sync: {
      rowUpdateMode: "full",
      sync: ({ begin, write, commit, markReady, reportError, reportHealthy }) => {
        let version = -1;
        let list: readonly Row[] | undefined;
        let rows: Map<string, Row> | undefined;
        let troubled = false;

        const seed = (laid: readonly Row[]): void => {
          rows = new Map(laid.map((row) => [part.keyOf(row), row]));
          begin();

          for (const row of laid) write({ type: "insert", value: row });
          commit();
          markReady();
        };

        // Note that rows are compared by reference, because the follow keeps the identity of every row a delivery did not move (`withAppStateDelivery`), so a row that is not the one held is exactly one the delivery moved.
        const lay = (held: Map<string, Row>, laid: readonly Row[]): void => {
          const next = new Map(laid.map((row) => [part.keyOf(row), row]));
          const moved = laid.filter((row) => held.get(part.keyOf(row)) !== row);
          const gone = [...held].filter(([key]) => !next.has(key));

          rows = next;

          if (moved.length === 0 && gone.length === 0) return;
          begin();

          for (const row of moved) {
            write({ type: held.has(part.keyOf(row)) ? "update" : "insert", value: row });
          }

          for (const [, row] of gone) write({ type: "delete", value: row });
          commit();
        };

        const take = ({ version: at, view }: ListedView): void => {
          if (at < version) return;
          version = at;
          const laid = part.rowsOf(view) ?? [];

          if (troubled) {
            troubled = false;
            reportHealthy();
          }

          if (laid === list) return;
          list = laid;

          if (rows === undefined) seed(laid);
          else lay(rows, laid);
        };

        // Note that the feed is listened to before its document is read, as the guide orders it, so nothing written between is missed.
        const stop = feed.listen((told) => {
          if (told.kind === FEED_TOLD.VIEW) {
            take(told.listed);

            return;
          }

          // Note that trouble before the first snapshot is not reported, since the follow asks again on the next delivery, and reporting throws before `markReady`.
          if (rows === undefined) return;
          troubled = true;
          reportError(told.cause);
        });

        const held = feed.held();

        if (held !== undefined) take(held);

        return stop;
      },
    },
  };
}

/** Hears that one row moved. */
type RowHeard = () => void;

/** The readers of each collection's rows, by key, told through the one subscription each collection holds while it has any. */
const rowReaders = new WeakMap<
  object,
  { readonly readers: Map<string, Set<RowHeard>>; stop: (() => void) | undefined }
>();

/**
 * Listens for the row `key` names in `collection` to move. Every reader of
 * a collection shares one `subscribeChanges`, which routes each change to the
 * readers of its key alone, so a delivery costs the rows it moved rather than
 * the readers standing; it unsubscribes once its last reader goes.
 */
function listenToRow<Row extends object>(
  collection: Collection<Row, string>,
  key: string,
  heard: RowHeard,
): () => void {
  let held = rowReaders.get(collection);

  if (held === undefined) {
    held = { readers: new Map(), stop: undefined };
    rowReaders.set(collection, held);
  }

  const { readers } = held;

  if (held.stop === undefined) {
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) for (const hear of readers.get(change.key) ?? []) hear();
    });

    held.stop = () => subscription.unsubscribe();
  }

  const ofKey = readers.get(key) ?? new Set();
  ofKey.add(heard);
  readers.set(key, ofKey);
  const standing = held;

  return () => {
    ofKey.delete(heard);

    if (ofKey.size === 0) readers.delete(key);

    if (readers.size > 0) return;
    standing.stop?.();
    standing.stop = undefined;
  };
}

/** Nothing to listen for: what a read with no key subscribes with. */
const LISTEN_TO_NOTHING = (): (() => void) => () => {};

/**
 * The row `key` names in `collection` (`.get(key)`), drawn again only when
 * that row moves, and the same object until it does; none where the
 * collection holds no such row, or no key is given. A screen with many
 * readers of single rows, a transcript's chips say, reads through this
 * rather than a live query each.
 */
export function useTaskListRow<Row extends object>(
  collection: Collection<Row, string>,
  key: string | undefined,
): Row | undefined {
  const subscribe = useCallback(
    (heard: RowHeard) =>
      key === undefined ? LISTEN_TO_NOTHING() : listenToRow(collection, key, heard),
    [collection, key],
  );

  return useSyncExternalStore(subscribe, () =>
    key === undefined ? undefined : collection.get(key),
  );
}

/** The task list's collections, one per part, each keyed by its rows' id. */
export interface TaskListCollections {
  /** The account's tasks, by task id. */
  readonly tasks: Collection<TaskSummary, string>;
  /** Every agent on a task, the archived among them, by agent id. */
  readonly agents: Collection<ListedAgent, string>;
  /** The pull request of every agent that opened one, by agent id. */
  readonly agentPullRequests: Collection<ListedPullRequest, string>;
}

/** A window's collections and the feed its follow writes them through. */
export interface TaskListFollowing {
  readonly collections: TaskListCollections;
  /** Hands on one document the follow wrote: its version and the task list it lists from. */
  readonly write: (version: number, view: TasksView) => void;
  /** Says a document could not be written; the rows held stay, and the next write clears it. */
  readonly trouble: (cause: unknown) => void;
  /** Stops every collection's sync. */
  readonly stop: () => void;
}

/** The collections of one window's task list, syncing from the moment they are made, and the feed its follow writes them through. */
export function taskListFollowing(): TaskListFollowing {
  const feed = taskListFeed();

  const collections: TaskListCollections = {
    tasks: createCollection(partCollectionOptions(TASKS_PART, feed)),
    agents: createCollection(partCollectionOptions(AGENTS_PART, feed)),
    agentPullRequests: createCollection(partCollectionOptions(AGENT_PULL_REQUESTS_PART, feed)),
  };

  return {
    collections,
    write: (version, view) => feed.write({ version, view }),
    trouble: feed.trouble,
    stop: () => {
      for (const collection of Object.values(collections))
        void collection.cleanup({ dependents: true });
    },
  };
}

const TaskListCollectionsContext = createContext<TaskListCollections | undefined>(undefined);

/** Hands the window's task-list collections to every surface beneath, mounted by each root beside its Query client. */
export function TaskListCollectionsProvider({
  collections,
  children,
}: {
  collections: TaskListCollections;
  children: ReactNode;
}) {
  return <TaskListCollectionsContext value={collections}>{children}</TaskListCollectionsContext>;
}

/** The window's task-list collections, for a live query or a lookup by id; throws outside a root that mounts them. */
export function useTaskListCollections(): TaskListCollections {
  const collections = use(TaskListCollectionsContext);

  if (collections === undefined) {
    throw new Error("The task list's collections are read outside the root that mounts them.");
  }

  return collections;
}
