/**
 * task-list-row-readers.ts -- one listener per task-list collection that tells each reader of a row only when that row moves, which both clients' row reads stand on.
 *
 * A screen that draws one row of the task list, or a few by their keys,
 * listens for those rows alone. Every reader of a collection shares one
 * `subscribeChanges`, which routes each change to the readers of its key, so
 * a delivery costs the rows it moved rather than the readers standing. Both
 * clients read through it: the panel (`@repo/panel`'s
 * `task-list-collections.tsx`) and the iOS app (`apps/mobile`'s
 * `host-provider.tsx`), each from its own React.
 */

import type { Collection } from "@tanstack/db";

/** Hears that one row moved. */
export type RowHeard = () => void;

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
export function listenToRow<Row extends object>(
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
