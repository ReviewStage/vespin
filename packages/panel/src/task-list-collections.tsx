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
import { type Collection, eq, useLiveQuery } from "@tanstack/react-db";
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

/** The tasks a collection holds by their number, in any workspace, and each numbered task's number, as the deliveries left them. */
interface NumberIndex {
  readonly byNumber: Map<number, Set<string>>;
  readonly numberOf: Map<string, number>;
}

/** Each task collection's numbers, kept from the first read of a step for the collection's life. */
const numberIndexes = new WeakMap<object, NumberIndex>();

/** Files the task under `key` under its number now, out from under the one it had; none takes it out. */
function fileNumber(index: NumberIndex, key: string, number: number | undefined): void {
  const was = index.numberOf.get(key);

  if (was === number) return;

  if (was !== undefined) {
    const filed = index.byNumber.get(was);
    filed?.delete(key);

    if (filed?.size === 0) index.byNumber.delete(was);
    index.numberOf.delete(key);
  }

  if (number === undefined) return;
  index.numberOf.set(key, number);
  index.byNumber.set(number, (index.byNumber.get(number) ?? new Set<string>()).add(key));
}

/**
 * The tasks' numbers, read once from the rows held and kept by the rows
 * each delivery moves, so a step finds the tasks it names without walking
 * the list, as `history-rows.ts` keeps the tasks ever listed.
 */
function numberIndexOf(tasks: Collection<TaskSummary, string>): NumberIndex {
  const known = numberIndexes.get(tasks);

  if (known !== undefined) return known;
  const index: NumberIndex = { byNumber: new Map(), numberOf: new Map() };

  for (const [key, task] of tasks.entries()) fileNumber(index, key, task.number);
  tasks.subscribeChanges((changes) => {
    for (const change of changes) {
      fileNumber(index, change.key, change.type === "delete" ? undefined : change.value.number);
    }
  });
  numberIndexes.set(tasks, index);

  return index;
}

/** The tasks `step` names as `tasks` holds them now: the one whose id it is, then each numbered so where it reads as a number. */
function steppedOf(
  tasks: Collection<TaskSummary, string>,
  step: string | undefined,
): readonly TaskSummary[] {
  if (step === undefined) return NO_STEPPED;
  const byId = tasks.get(step);

  const numbered = NUMBER_STEP.test(step)
    ? numberIndexOf(tasks).byNumber.get(Number(step))
    : undefined;

  const stepped = byId === undefined ? [] : [byId];

  for (const key of numbered ?? []) {
    const task = key === step ? undefined : tasks.get(key);

    if (task !== undefined) stepped.push(task);
  }

  return stepped.length === 0 ? NO_STEPPED : stepped;
}

/** Whether two reads of a step hold the same rows, in the same order. */
function sameStepped(one: readonly TaskSummary[], other: readonly TaskSummary[]): boolean {
  return one.length === other.length && one.every((task, at) => other[at] === task);
}

/** A task as a reader naming tasks reads it: its id and its name. */
export interface TaskName {
  readonly id: string;
  readonly name: string;
}

/**
 * Every task the list holds as its id and its name, each name drawn as it
 * is being typed where it is (`typedNames`), in no order. The live query
 * selects only the two, so the list is the same array across a delivery
 * moving any other field of a task, as each turn of its agents does; for a
 * reader that names tasks, as an `@`'s agents name the tasks they work on.
 */
export function useTaskNames(typedNames: TaskNames): readonly TaskName[] {
  const collections = useTaskListCollections();

  const listed = useLiveQuery((q) =>
    q.from({ task: collections.tasks }).select(({ task }) => ({ id: task.id, name: task.name })),
  ).data;

  return useMemo(() => renamedTasks(listed, typedNames), [listed, typedNames]);
}

/**
 * The tasks an address's step may name, as the list holds them: the one
 * whose id it is, and, for a step reading as a number, each numbered so in
 * any workspace, for the reader to hold to the workspace the address names;
 * none while no step is given. Note that they are looked up by id and by
 * number (`numberIndexOf`) rather than by a query over the list, because the
 * step moves with every step between tasks, and a query made for each walked
 * every task; the list is the same array across a delivery moving any other
 * task.
 */
export function useSteppedTasks(step: string | undefined): readonly TaskSummary[] {
  const { tasks } = useTaskListCollections();
  const held = useRef<readonly TaskSummary[]>(NO_STEPPED);

  const subscribe = useCallback(
    (heard: RowHeard) => {
      if (step === undefined) return LISTEN_TO_NOTHING();
      const number = NUMBER_STEP.test(step) ? Number(step) : undefined;
      const index = numberIndexOf(tasks);

      // Note that a row read last is heard too, since a task numbered so no longer is filed under its new number by now.
      const subscription = tasks.subscribeChanges((changes) => {
        const moved = changes.some(
          ({ key }) =>
            key === step ||
            (number !== undefined && index.numberOf.get(key) === number) ||
            held.current.some((task) => task.id === key),
        );

        if (moved) heard();
      });

      return () => subscription.unsubscribe();
    },
    [tasks, step],
  );

  const read = (): readonly TaskSummary[] => {
    const stepped = steppedOf(tasks, step);

    if (!sameStepped(stepped, held.current)) held.current = stepped;

    return held.current;
  };

  return useSyncExternalStore(subscribe, read, read);
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
