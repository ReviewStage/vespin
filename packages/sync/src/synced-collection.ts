/**
 * synced-collection.ts -- a TanStack DB collection only sync writes: taken whole by key, one sync transaction writing each row that moved and nothing for the rest, and each row read out as the very object until it moves.
 *
 * Note that a collection held in memory never truncates, because TanStack's
 * truncate deletes every row and inserts it again, moved or not. Every
 * collection here lives for as long as the scope that made it, never by
 * TanStack's own timer: `gcTime` 0 turns that timer off and the scope's
 * close cleans the collection up, so a test's clock stays its own.
 *
 * A collection may be kept on disk (`KeepCollection`): its config handed to
 * the store, which wraps it in TanStack DB's own persistence, so every sync
 * transaction is written to the database as it commits and a live query
 * loads from there the rows it asks for. Such a collection holds in memory
 * only the rows taken or loaded since it was made, so a delete is written by
 * key whether or not its row was taken here; it may be replaced whole
 * (`replace`), a truncate and every row inserted in one transaction, which
 * the persistence takes as the authoritative set and over which a live
 * query hears only the rows that moved; and it keeps marks of its own
 * (`mark`), each written in the transaction that moves it, as a read's
 * cursor is. It closes only once every transaction it wrote is on disk, so
 * the database it is kept in closes after the last of them.
 */

import {
  type Collection,
  type CollectionConfig,
  createCollection,
  type SyncConfig,
  type UtilsRecord,
  whenSyncAccepted,
} from "@tanstack/db";
import { Deferred, Effect, Equal, type Scope } from "effect";

/** TanStack's own garbage collection turned off, so a collection, or a live query, lives as long as the scope that made it. */
export const KEPT_BY_SCOPE = 0;

/** A collection of `Row`s keyed by `Key`, made with no schema of TanStack's, since a row is decoded by Effect's at the boundary. */
export type RowCollection<Row extends object, Key extends string> = Collection<
  Row,
  Key,
  UtilsRecord,
  never
>;

/** A collection's config as `syncedCollection` makes it, which a store wraps to keep its rows on disk. */
export type RowCollectionConfig<Row extends object, Key extends string> = CollectionConfig<
  Row,
  Key,
  never,
  UtilsRecord
>;

/** How a store keeps a collection on disk: its config wrapped in the store's persistence, for as long as the collection stands. */
export type KeepCollection = <Row extends object, Key extends string>(
  config: RowCollectionConfig<Row, Key>,
) => RowCollectionConfig<Row, Key>;

/** A mark a kept collection holds beside its rows, by its name, written in the transaction that moves rows with it. */
export interface CollectionMark {
  readonly name: string;
  readonly value: unknown;
}

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
    // Note that the row is copied field by field rather than through `Object.entries`, because a launch reads every kept row through here, thousands of them, and the entries' arrays were most of its cost.
    // SAFETY: a stored row holds the row's own fields, each one of its values, beside TanStack's virtual fields, which are left out here.
    const fields = stored as Readonly<Partial<Record<string, Row[keyof Row]>>>;
    const copy: Partial<Record<string, Row[keyof Row]>> = {};

    for (const name of Object.keys(fields)) {
      const value = fields[name];

      if (value !== undefined && !name.startsWith("$")) copy[name] = value;
    }

    read = copy;
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
  /** Whether its rows are kept on disk, so it holds in memory only those taken or loaded since it was made. */
  readonly kept: boolean;
  /** The rows taken since the collection was made, by key, as they were taken. */
  readonly held: () => ReadonlyMap<Key, Row>;
  /**
   * Takes the rows `next` holds as the synced ones, whole: one sync
   * transaction writing each that moved, and `mark` where one is given, or
   * none where nothing did, answering the keys it wrote.
   */
  readonly take: (next: ReadonlyMap<Key, Row>, mark?: CollectionMark) => readonly Key[];
  /**
   * Takes `upserted` and lets `deleted`, none of them, go, leaving every other row as it
   * is: one sync transaction writing each that moved, and `mark` where one
   * is given, as `take` does, in work as large as the change rather than the
   * collection. A kept collection deletes each of `deleted` whether or not
   * it was taken here, since its row may stand on disk alone.
   */
  readonly patch: (
    upserted: ReadonlyMap<Key, Row>,
    deleted: readonly Key[],
    mark?: CollectionMark,
  ) => readonly Key[];
  /**
   * Replaces a kept collection's rows with `rows`, whole: one sync
   * transaction truncating it, inserting each of them, and writing `mark`
   * where one is given, so every row kept on disk that `rows` leaves out is
   * gone; answering the keys of `rows` and of those taken before that it
   * leaves out. A collection held in memory alone takes `rows` as `take`
   * does, since there a truncate would draw every row again.
   */
  readonly replace: (rows: ReadonlyMap<Key, Row>, mark?: CollectionMark) => readonly Key[];
  /** The mark `name` names as the collection last wrote it, kept on disk where the collection is; none where it wrote none. */
  readonly mark: (name: string) => CollectionMark | undefined;
  /**
   * The synced row `key` names as the collection last wrote it, or as it
   * holds it where it wrote none: loaded from disk, for a kept collection.
   * Note that a kept collection answers each row it wrote from what it
   * wrote, because its persistence publishes a transaction to the
   * collection only after the commit returns, and a reader drawn again at
   * once must see the rows it moved.
   */
  readonly row: (key: Key) => Row | undefined;
}

/**
 * A collection of rows keyed by `getKey`, ready and empty until rows are
 * first taken, for as long as the scope stands; kept on disk where `keep`
 * is given, once the persistence hands it its sync.
 */
export function syncedCollection<Row extends object, Key extends string>(
  getKey: (row: Row) => Key,
  keep?: KeepCollection,
): Effect.Effect<SyncedCollection<Row, Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let writer: SyncWriter<Row, Key> | undefined;
    // Note that `held` is the collection's own, written in place by `patch`, so `take` holds a copy of the map it is handed.
    let held = new Map<Key, Row>();
    /** The keys a kept collection deleted since it was made, none taken again since, which its persistence may not have published yet. */
    const gone = new Set<Key>();
    /** Whether a kept collection was replaced whole since it was made, so it holds no row but those taken since. */
    let whole = false;
    const handedSync = yield* Deferred.make<void>();
    /** Settles once every transaction a kept collection wrote is on disk. */
    let durable: Promise<unknown> = Promise.resolve();

    const config: RowCollectionConfig<Row, Key> = {
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
          Deferred.doneUnsafe(handedSync, Effect.void);

          return () => {
            writer = undefined;
          };
        },
      },
    };

    // Note that a kept collection is cleaned up only once its writes are on disk, because its database closes right after.
    const collection = yield* Effect.acquireRelease(
      Effect.sync(() => createCollection<Row, Key>(keep === undefined ? config : keep(config))),
      (made) =>
        Effect.promise(async () => {
          await durable;
          await made.cleanup();
        }),
    );

    // Note that a kept collection's persistence hands it its sync only once its database answered, so no row is taken before it can be written.
    // A database that fails as it starts never hands it, so the failure ends the wait as a defect: the store opened that database, and nothing here goes on without it.
    const failed = (): void => {
      if (collection.status !== "error" && collection.status !== "crashed") return;
      const cause = collection.health.error;
      Deferred.doneUnsafe(
        handedSync,
        Effect.die(new Error("the kept collection failed as it started", { cause })),
      );
    };

    const unwatch = collection.on("status:change", failed);
    failed();
    yield* Effect.ensuring(Deferred.await(handedSync), Effect.sync(unwatch));

    /** Writes `changes` in one sync transaction, after a truncate where `truncated`, with `mark`, answering their keys; none where the collection is not synced or nothing moves. */
    const written = (
      changes: readonly RowChange<Row, Key>[],
      mark?: CollectionMark,
      truncated = false,
    ): readonly Key[] | undefined => {
      if (writer === undefined || (changes.length === 0 && mark === undefined && !truncated)) {
        return undefined;
      }

      writer.begin();

      if (truncated) writer.truncate();

      for (const change of changes) writer.write(change);

      if (mark !== undefined) writer.metadata?.collection.set(mark.name, mark.value);
      // Note that the receipt is never awaited here, since a commit held behind a standing transaction lands only once that transaction settles; a kept collection waits for it to be on disk only as it closes.
      const receipt = writer.commit();

      if (keep !== undefined && receipt !== true) {
        const accepted = whenSyncAccepted(receipt);
        durable = Promise.allSettled([durable, accepted]);
      }

      for (const change of changes) {
        if (change.type === "delete") gone.add(change.key);
        else gone.delete(getKey(change.value));
      }

      return changes.map((change) =>
        change.type === "delete" ? change.key : getKey(change.value),
      );
    };

    const take = (next: ReadonlyMap<Key, Row>, mark?: CollectionMark): readonly Key[] => {
      const keys = written(rowChanges(held, next), mark);

      if (keys === undefined) return [];
      held = new Map(next);

      return keys;
    };

    const replace = (rows: ReadonlyMap<Key, Row>, mark?: CollectionMark): readonly Key[] => {
      if (keep === undefined) return take(rows, mark);

      const inserted = [...rows.values()].map((row) => ({ type: "insert" as const, value: row }));
      const keys = written(inserted, mark, true);

      if (keys === undefined) return [];
      whole = true;
      gone.clear();
      const left = [...held.keys()].filter((key) => !rows.has(key));
      held = new Map(rows);

      return [...keys, ...left];
    };

    const patch = (
      upserted: ReadonlyMap<Key, Row>,
      deleted: readonly Key[],
      mark?: CollectionMark,
    ): readonly Key[] => {
      const changes: RowChange<Row, Key>[] = deleted.flatMap((key) =>
        keep !== undefined || held.has(key) ? [{ type: "delete" as const, key }] : [],
      );

      for (const [key, row] of upserted) {
        const was = held.get(key);

        if (was === undefined) changes.push({ type: "insert", value: row });
        else if (!Equal.equals(was, row)) changes.push({ type: "update", value: row });
      }

      const keys = written(changes, mark);

      if (keys === undefined) return [];

      for (const change of changes) {
        if (change.type === "delete") held.delete(change.key);
        else held.set(getKey(change.value), change.value);
      }

      return keys;
    };

    return {
      collection,
      kept: keep !== undefined,
      held: () => held,
      take,
      patch,
      replace,
      mark: (name) => {
        const value = writer?.metadata?.collection.get(name);

        return value === undefined ? undefined : { name, value };
      },
      row: (key) => {
        const taken = keep === undefined ? undefined : held.get(key);

        if (taken !== undefined || (keep !== undefined && (whole || gone.has(key)))) return taken;
        const stored = collection.get(key);

        return stored === undefined ? undefined : rowOf<Row, typeof stored>(stored);
      },
    };
  });
}
