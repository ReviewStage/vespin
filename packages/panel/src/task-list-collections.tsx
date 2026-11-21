/**
 * task-list-collections.tsx -- the window's task-list collections handed to every surface beneath, and its reads of them: one row that draws again only when that row moves, a task by id with its typed name, every task in an order, the tasks an address's step names, and rows looked up by id.
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
import { type Collection, eq, or, useLiveQuery } from "@tanstack/react-db";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";

/** The order a read of the whole list lists its tasks in. */
export const NAMED_ORDER = {
  /** Newest started first, as the host lists them. */
  STARTED: "started",
  /** The sidebar's: the pinned ones first, newest pinned first, then the rest, newest started first. */
  PINNED_FIRST: "pinned-first",
} as const;

export type NamedOrder = (typeof NAMED_ORDER)[keyof typeof NAMED_ORDER];

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

/** A task step naming a task by its number in its workspace, as no id is. */
const NUMBER_STEP = /^\d+$/u;

/** No step asked: what a read of the tasks a step names answers. */
const NO_STEPPED: readonly TaskSummary[] = [];

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
 * Every task the list holds in `order`, held to the workspace `workspaceId`
 * names where it names one, each name drawn as it is being typed where it
 * is (`typedNames`). One live query keeps them, so the list is the same
 * array until one of them or a typed name moves; for a reader that walks
 * the whole list, as the palette's task rows, the Tasks page, and the
 * Inbox's counts do. Note that these rows are the live query's, never the
 * same objects `.get` answers.
 */
export function useNamedTasks(
  typedNames: TaskNames,
  order: NamedOrder,
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

  return useMemo(() => {
    const named = renamedTasks(every, typedNames);

    if (order === NAMED_ORDER.STARTED) return named;
    const { pinned, rest } = sidebarTasks(named);

    return [...pinned, ...rest];
  }, [every, typedNames, order]);
}

/**
 * The tasks an address's step may name, as the list holds them: the one
 * whose id it is, and, for a step reading as a number, each numbered so in
 * any workspace, for the reader to hold to the workspace the address names;
 * none while no step is given. One live query over those rows keeps them,
 * so the list is the same array across a delivery moving any other task.
 */
export function useSteppedTasks(step: string | undefined): readonly TaskSummary[] {
  const collections = useTaskListCollections();

  const stepped = useLiveQuery({
    query: (q) => {
      if (step === undefined) return undefined;
      const from = q.from({ task: collections.tasks });

      if (!NUMBER_STEP.test(step)) return from.where(({ task }) => eq(task.id, step));
      const number = Number(step);

      return from.where(({ task }) => or(eq(task.id, step), eq(task.number, number)));
    },
  }).data;

  return stepped ?? NO_STEPPED;
}

/** The task list's rows read by id, as the collections hold them now. */
export interface TaskListRows {
  /** The task listed under `taskId`, its name as it is being typed where it is; none where the list holds none. */
  readonly task: (taskId: string) => TaskSummary | undefined;
  /** The agent listed under `agentId`; none where the list holds none. */
  readonly agent: (agentId: string) => ListedAgent | undefined;
}

/** The rows a reader by id asked for, by id, each as it read it last, and the stops of the listens following them. */
interface AskedRows<Row> {
  readonly read: Map<string, Row | undefined>;
  readonly stops: Map<string, () => void>;
}

/** Counts one more move of a row a reader asked for. */
const countMove = (moves: number): number => moves + 1;

/**
 * Follows each row of `collection` asked for and not yet followed, telling
 * `moved` of a row that moved between its read and now, since its listen
 * hears only what moves after it.
 */
function followAsked<Row extends object>(
  collection: Collection<Row, string>,
  asked: AskedRows<Row>,
  moved: RowHeard,
): void {
  for (const [key, read] of asked.read) {
    if (asked.stops.has(key)) continue;
    asked.stops.set(key, listenToRow(collection, key, moved));

    if (collection.get(key) !== read) moved();
  }
}

/** Stops following every row asked for, so the next commit follows them afresh. */
function stopFollowing(asked: AskedRows<object>): void {
  for (const stop of asked.stops.values()) stop();
  asked.stops.clear();
}

/**
 * The task list's rows read by id (`.get`), for a reader that looks up a
 * handful of rows in a plain function or a callback, each task's name drawn
 * as it is being typed where it is (`typedNames`). Each id asked is followed
 * from the next commit on, through the collection's one listen by key
 * (`listenToRow`), so the reader is drawn again when one of those rows moves
 * and holds across a delivery moving any other; a lookup always reads the
 * collection as it stands, so an id asked for the first time reads its row at
 * once, and asking it draws nothing again.
 */
export function useTaskListRows(typedNames: TaskNames = NO_NAMES_TYPED): TaskListRows {
  const collections = useTaskListCollections();

  // The ids asked for, followed once committed. Note that they only grow, as the rows a reader looks up are few.
  const asked = useRef<{ tasks: AskedRows<TaskSummary>; agents: AskedRows<ListedAgent> }>({
    tasks: { read: new Map(), stops: new Map() },
    agents: { read: new Map(), stops: new Map() },
  }).current;

  const [moves, moved] = useReducer(countMove, 0);
  useEffect(() => {
    followAsked(collections.tasks, asked.tasks, moved);
    followAsked(collections.agents, asked.agents, moved);
  });
  useEffect(
    () => () => {
      stopFollowing(asked.tasks);
      stopFollowing(asked.agents);
    },
    [collections, asked],
  );

  // Note that the lookups are made again only once a row followed or a typed name moves, so what reads them holds across every other delivery.
  return useMemo(
    () => ({
      task: (taskId: string) => {
        const row = collections.tasks.get(taskId);
        asked.tasks.read.set(taskId, row);

        return row === undefined ? undefined : renamedTask(row, typedNames);
      },
      agent: (agentId: string) => {
        const row = collections.agents.get(agentId);
        asked.agents.read.set(agentId, row);

        return row;
      },
    }),
    // Note that `moves` is read only to make the lookups again.
    [collections, asked, typedNames, moves],
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
