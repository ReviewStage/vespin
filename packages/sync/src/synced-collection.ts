/**
 * synced-collection.ts -- a TanStack DB collection only sync writes: taken whole by key, one sync transaction writing each row that moved and nothing for the rest, and each row read out as the very object until it moves.
 *
 * Note that it never truncates, because TanStack's truncate deletes every
 * row and inserts it again, moved or not. Every collection here lives for as
 * long as the scope that made it, never by TanStack's own timer: `gcTime` 0
 * turns that timer off and the scope's close cleans the collection up, so a
 * test's clock stays its own.
 */

import { type Collection, createCollection, type SyncConfig, type UtilsRecord } from "@tanstack/db";
import { Effect, Equal, type Scope } from "effect";

/** TanStack's own garbage collection turned off, so a collection, or a live query, lives as long as the scope that made it. */
export const KEPT_BY_SCOPE = 0;

/** A collection of `Row`s keyed by `Key`, made with no schema of TanStack's, since a row is decoded by Effect's at the boundary. */
export type RowCollection<Row extends object, Key extends string> = Collection<
  Row,
  Key,
  UtilsRecord,
  never
>;

/** One change to a row: a new row, a row replaced whole, or a row gone by its key. */
type RowChange<Row extends object, Key extends string> =
  | { readonly type: "insert"; readonly value: Row }
  | { readonly type: "update"; readonly value: Row }
  | { readonly type: "delete"; readonly key: Key };

/** What a sync config is handed to write a collection's synced rows with. */
type SyncWriter<Row extends object, Key extends string> = Parameters<
  SyncConfig<Row, Key>["sync"]
>[0];

/**
 * The changes that take `held` to `next`: a delete for each key gone, an
 * insert for each new one, and an update, the row whole, for each that
 * moved; none for a row that did not.
 */
export function rowChanges<Row extends object, Key extends string>(
  held: ReadonlyMap<Key, Row>,
  next: ReadonlyMap<Key, Row>,
): RowChange<Row, Key>[] {
  const gone = [...held.keys()].flatMap((key) =>
    next.has(key) ? [] : [{ type: "delete" as const, key }],
  );

  const moved = [...next].flatMap(([key, row]): RowChange<Row, Key>[] => {
    const was = held.get(key);

    if (was === undefined) return [{ type: "insert", value: row }];

    return Equal.equals(was, row) ? [] : [{ type: "update", value: row }];
  });

  return [...gone, ...moved];
}

/** Each row `rowOf` read, by the stored row TanStack handed out, which it hands out again until the row moves. */
const readRows = new WeakMap<object, object>();

/**
 * A row as the collection holds it, without the virtual fields TanStack
 * reads it out with (`$hasPendingWrites`, `$origin`, `$key`, and `$collectionId`) and without a key a
 * whole-row change left undefined, so it is the row as the read answered it.
 * Note that a row read again while it stands is the very object read
 * before, so a reader of a row that did not move holds the same object.
 */
export function rowOf<Row extends object, Stored extends object>(stored: Stored): Row {
  let read = readRows.get(stored);

  if (read === undefined) {
    read = Object.fromEntries(
      Object.entries(stored).filter(
        ([name, value]) => !name.startsWith("$") && value !== undefined,
      ),
    );
    readRows.set(stored, read);
  }

  // SAFETY: only the virtual fields and keys left undefined are dropped, neither of which a row of ours carries.
  return read as Row;
}

/** `make`'s collection, or live query, kept until the scope closes, which cleans it up. */
export function scopedCollection<Made extends { cleanup(): Promise<void> }>(
  make: () => Made,
): Effect.Effect<Made, never, Scope.Scope> {
  return Effect.acquireRelease(Effect.sync(make), (made) => Effect.promise(() => made.cleanup()));
}

/** A collection only sync writes, and the door its rows come in by. */
export interface SyncedCollection<Row extends object, Key extends string> {
  readonly collection: RowCollection<Row, Key>;
  /** The rows the collection holds now, by key, as they were taken. */
  readonly held: () => ReadonlyMap<Key, Row>;
  /**
   * Takes the rows `next` holds as the synced ones, whole: one sync
   * transaction writing each that moved, or none where nothing did, answering
   * the keys it wrote.
   */
  readonly take: (next: ReadonlyMap<Key, Row>) => readonly Key[];
  /**
   * Takes `upserted` and lets `deleted`, none of them, go, leaving every other row as it
   * is: one sync transaction writing each that moved, as `take` does, in
   * work as large as the change rather than the collection.
   */
  readonly patch: (upserted: ReadonlyMap<Key, Row>, deleted: readonly Key[]) => readonly Key[];
}

/** A collection of rows keyed by `getKey`, ready and empty until rows are first taken, for as long as the scope stands. */
export function syncedCollection<Row extends object, Key extends string>(
  getKey: (row: Row) => Key,
): Effect.Effect<SyncedCollection<Row, Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let writer: SyncWriter<Row, Key> | undefined;
    // Note that `held` is the collection's own, written in place by `patch`, so `take` holds a copy of the map it is handed.
    let held = new Map<Key, Row>();

    const collection = yield* scopedCollection(() =>
      createCollection<Row, Key>({
        getKey,
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        sync: {
          rowUpdateMode: "full",
          sync: (handed) => {
            writer = handed;
            handed.begin();
            handed.commit();
            handed.markReady();

            return () => {
              writer = undefined;
            };
          },
        },
      }),
    );

    /** Writes `changes` in one sync transaction, answering their keys; none where the collection is not synced yet or nothing moved. */
    const written = (changes: readonly RowChange<Row, Key>[]): readonly Key[] | undefined => {
      if (writer === undefined || changes.length === 0) return undefined;
      writer.begin();

      for (const change of changes) writer.write(change);
      // Note that the receipt is never awaited, since a commit held behind a standing transaction lands only once that transaction settles.
      writer.commit();

      return changes.map((change) =>
        change.type === "delete" ? change.key : getKey(change.value),
      );
    };

    const take = (next: ReadonlyMap<Key, Row>): readonly Key[] => {
      const keys = written(rowChanges(held, next));

      if (keys === undefined) return [];
      held = new Map(next);

      return keys;
    };

    const patch = (upserted: ReadonlyMap<Key, Row>, deleted: readonly Key[]): readonly Key[] => {
      const changes: RowChange<Row, Key>[] = deleted.flatMap((key) =>
        held.has(key) ? [{ type: "delete" as const, key }] : [],
      );

      for (const [key, row] of upserted) {
        const was = held.get(key);

        if (was === undefined) changes.push({ type: "insert", value: row });
        else if (!Equal.equals(was, row)) changes.push({ type: "update", value: row });
      }

      const keys = written(changes);

      if (keys === undefined) return [];

      for (const change of changes) {
        if (change.type === "delete") held.delete(change.key);
        else held.set(getKey(change.value), change.value);
      }

      return keys;
    };

    return { collection, held: () => held, take, patch };
  });
}
