/**
 * task-list-collections.tsx -- the window's task-list collections handed to every surface beneath, and its reads of them: one row that draws again only when that row moves, a task by id with its typed name, every task in the list's order, and rows looked up by id.
 *
 * The collections and the feed the window's follow writes them through are
 * `@repo/host/task-list-following`'s, shared with the iOS app; what is here
 * is the panel's React over them, bound to the panel's own React.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import {
  renamedTask,
  renamedTasks,
  sidebarTasks,
  type TaskNames,
} from "@repo/features/tasks-model";
import type { TaskListCollections } from "@repo/host/task-list-following";
import { type Collection, eq, inArray, useLiveQuery } from "@tanstack/react-db";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

/** No name typed: what a read of the rows as listed draws over them. */
const NO_NAMES_TYPED: TaskNames = new Map();

/** The live queries' keys: the rows of each collection a reader by id has asked for. */
const ROWS_KEY = {
  TASKS: "task-list-rows-tasks",
  AGENTS: "task-list-rows-agents",
} as const;

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

  const read = (): Row | undefined => (key === undefined ? undefined : collection.get(key));

  // Note that a render to markup reads the row as it stands, as a window's first frame does.
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The task `taskId` names as the list holds it (`useTaskListRow`), its name
 * drawn as it is being typed where it is (`typedNames`); none where the list
 * holds no such task, or no id is given. The same object until that row or
 * its typed name moves.
 */
export function useNamedTask(
  taskId: string | undefined,
  typedNames: TaskNames,
): TaskSummary | undefined {
  const row = useTaskListRow(useTaskListCollections().tasks, taskId);
  const typed = taskId === undefined ? undefined : typedNames.get(taskId);

  return useMemo(
    () => (row === undefined || typed === undefined ? row : { ...row, name: typed }),
    [row, typed],
  );
}

/**
 * Every task the list holds, newest started first as the host lists them,
 * held to the workspace `workspaceId` names where it names one, each name
 * drawn as it is being typed where it is (`typedNames`). One live query
 * keeps them, so the list is the same array until one of them moves; for a
 * reader that walks the whole list, as the palette's task rows do. Note that
 * these rows are the live query's, never the same objects `.get` answers.
 */
export function useNamedTasks(
  typedNames: TaskNames,
  workspaceId?: string | undefined,
): readonly TaskSummary[] {
  const collections = useTaskListCollections();

  const every = useLiveQuery({
    query: (q) => {
      const all = q
        .from({ task: collections.tasks })
        .orderBy(({ task }) => task.createdAt, "desc")
        .orderBy(({ task }) => task.id, { direction: "desc", stringSort: "lexical" });

      return workspaceId === undefined
        ? all
        : all.where(({ task }) => eq(task.workspaceId, workspaceId));
    },
  }).data;

  return useMemo(() => renamedTasks(every, typedNames), [every, typedNames]);
}

/**
 * The tasks the sidebar lists (`useNamedTasks` held to the workspace
 * `workspaceId` names, every task while it names none) in the sidebar's
 * order: the pinned ones first, newest pinned first, then the rest as the
 * host lists them. The same array until one of them or a typed name moves;
 * for a reader that walks the listed workspace's whole list, as the Tasks
 * page and the Inbox's counts do.
 */
export function useListedTasks(
  workspaceId: string | undefined,
  typedNames: TaskNames,
): readonly TaskSummary[] {
  const named = useNamedTasks(typedNames, workspaceId);

  return useMemo(() => {
    const { pinned, rest } = sidebarTasks(named);

    return [...pinned, ...rest];
  }, [named]);
}

/** The task list's rows read by id, as the collections hold them now. */
export interface TaskListRows {
  /** The task listed under `taskId`, its name as it is being typed where it is; none where the list holds none. */
  readonly task: (taskId: string) => TaskSummary | undefined;
  /** The agent listed under `agentId`; none where the list holds none. */
  readonly agent: (agentId: string) => ListedAgent | undefined;
}

/** The ids asked for that the live query does not yet follow, all of them sorted, or none where it follows each. */
function widened(
  asked: ReadonlySet<string>,
  followed: readonly string[],
): readonly string[] | undefined {
  if (asked.size === followed.length) return undefined;

  return [...asked].sort();
}

/**
 * The task list's rows read by id (`.get`), for a reader that looks up a
 * handful of rows in a plain function or a callback, each task's name drawn
 * as it is being typed where it is (`typedNames`). Each id asked is followed
 * from the next commit on by a live query over the ids asked (`inArray`), so
 * the reader is drawn again when one of those rows moves and holds across a
 * delivery moving any other; a lookup always reads the collection as it
 * stands, so an id asked for the first time reads its row at once.
 */
export function useTaskListRows(typedNames: TaskNames = NO_NAMES_TYPED): TaskListRows {
  const collections = useTaskListCollections();
  // The ids asked for, which the live queries follow once committed. Note that they only grow, as the rows a reader looks up are few.
  const asked = useRef({ tasks: new Set<string>(), agents: new Set<string>() }).current;

  const [followed, setFollowed] = useState<{
    readonly tasks: readonly string[];
    readonly agents: readonly string[];
  }>({ tasks: [], agents: [] });

  const followedTasks = useLiveQuery({
    queryKey: [ROWS_KEY.TASKS, followed.tasks],
    query: (q) =>
      q
        .from({ task: collections.tasks })
        .where(({ task }) => inArray(task.id, [...followed.tasks])),
  }).data;

  const followedAgents = useLiveQuery({
    queryKey: [ROWS_KEY.AGENTS, followed.agents],
    query: (q) =>
      q
        .from({ agent: collections.agents })
        .where(({ agent }) => inArray(agent.id, [...followed.agents])),
  }).data;

  useEffect(() => {
    const tasks = widened(asked.tasks, followed.tasks);
    const agents = widened(asked.agents, followed.agents);

    if (tasks === undefined && agents === undefined) return;
    setFollowed({ tasks: tasks ?? followed.tasks, agents: agents ?? followed.agents });
  });

  // Note that the lookups are made again only once a row followed or a typed name moves, so what reads them holds across every other delivery.
  return useMemo(
    () => ({
      task: (taskId: string) => {
        asked.tasks.add(taskId);
        const row = collections.tasks.get(taskId);

        return row === undefined ? undefined : renamedTask(row, typedNames);
      },
      agent: (agentId: string) => {
        asked.agents.add(agentId);

        return collections.agents.get(agentId);
      },
    }),
    [collections, asked, typedNames, followedTasks, followedAgents],
  );
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
