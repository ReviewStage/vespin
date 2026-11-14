/**
 * task-list-collections.tsx -- the window's task-list collections handed to every surface beneath, and a read of one row of them that draws again only when that row moves.
 *
 * The collections and the feed the window's follow writes them through are
 * `@repo/host/task-list-following`'s, shared with the iOS app; what is here
 * is the panel's React over them, bound to the panel's own React.
 */

import type { TaskListCollections } from "@repo/host/task-list-following";
import type { Collection } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useCallback, useSyncExternalStore } from "react";

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
