/**
 * drawn-rows.ts -- a read's rows as it draws them, each pending write drawn over its synced row, held in a TanStack DB collection a live query stands on, written only for the keys that moved.
 *
 * The pool's collection of a kind (`@repo/sync`) holds the synced rows
 * alone, and every read standing on the kind shares it: a write is drawn
 * over a row by the pool, never as a TanStack transaction, so a live query
 * over that collection would hear an archive or a delete only once the
 * service carried it back. So a read whose derivations are live queries
 * keeps its rows as it draws them in a collection of its own, written by
 * TanStack's custom sync (`begin`, `write`, `commit`), and only for the keys
 * the pool names as moved: those its own answer moved, took up, or let go,
 * and those a write or another read's answer drew again. Each is written as
 * the very row the pool draws, never copied, so no row is held twice. A
 * read takes a live query's rows as one list (`listedOf`), built again only
 * after the query changed, and logged with the rows that changed
 * (`list-moves.ts`).
 */

import { KEPT_BY_SCOPE, type RowCollection, scopedCollection } from "@repo/sync";
import {
  BasicIndex,
  type Collection,
  createCollection,
  type SyncConfig,
  type UtilsRecord,
  type WithVirtualProps,
} from "@tanstack/db";
import { Effect, type Scope } from "effect";
import { type ListMove, listMoveLog } from "./list-moves.js";

/** A live query's rows as another query joins them, each with TanStack's virtual fields. */
export type QueryCollection<Row extends object> = Collection<
  WithVirtualProps<Row, string | number>,
  string | number
>;

/** What a sync config is handed to write a collection's rows with. */
type SyncWriter<Row extends object> = Parameters<SyncConfig<Row, string>["sync"]>[0];

/** One write of a drawn row: new, replaced whole, or gone by its key. */
type DrawnChange<Row extends object> =
  | { readonly type: "insert" | "update"; readonly value: Row }
  | { readonly type: "delete"; readonly key: string };

/** A read's rows as it draws them, and the door the moved ones come in by. */
export interface DrawnRows<Row extends object> {
  /** The rows as the read draws them, by key, for live queries to stand on. */
  readonly collection: RowCollection<Row, string>;
  /**
   * Writes each of `keys` as `rowOf` draws it now, in one sync transaction:
   * an insert or an update for a row that is another object than the one
   * held, a delete for one the read no longer draws, and nothing for the
   * rest.
   */
  readonly drawn: (keys: readonly string[], rowOf: (key: string) => Row | undefined) => void;
}

/** An empty collection of a read's drawn rows keyed by `getKey`, for as long as the scope stands. */
export function drawnRows<Row extends object>(
  getKey: (row: Row) => string,
): Effect.Effect<DrawnRows<Row>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let writer: SyncWriter<Row> | undefined;
    /** The very rows written, by key, so a key named again with the same row writes nothing. */
    const held = new Map<string, Row>();

    const collection = yield* scopedCollection(() =>
      createCollection<Row, string>({
        getKey,
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        // Note that a live query correlating rows by a field (an include's `eq`) loads by an index, which TanStack makes only where asked.
        autoIndex: "eager",
        defaultIndexType: BasicIndex,
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

    const drawn = (keys: readonly string[], rowOf: (key: string) => Row | undefined): void => {
      const changes = [...new Set(keys)].flatMap((key): DrawnChange<Row>[] => {
        const was = held.get(key);
        const row = rowOf(key);

        if (row === was) return [];

        if (row === undefined) return was === undefined ? [] : [{ type: "delete", key }];

        return [{ type: was === undefined ? "insert" : "update", value: row }];
      });

      if (writer === undefined || changes.length === 0) return;
      writer.begin();

      for (const change of changes) {
        writer.write(change);

        if (change.type === "delete") held.delete(change.key);
        else held.set(getKey(change.value), change.value);
      }

      writer.commit();
    };

    return { collection, drawn };
  });
}

/**
 * The values `pick` takes from each of `collection`'s rows, in the
 * collection's order, as one list built again only once the collection
 * changed, until the scope closes. Each list built is logged with the rows
 * that moved since the one before (`list-moves.ts`), as the changes the
 * collection told name them, so a reader of two lists is told what moved
 * between them rather than walking both.
 */
export function listedOf<Row extends object, Value>(
  collection: Collection<Row, string | number, UtilsRecord>,
  pick: (row: Row) => Value | undefined,
): Effect.Effect<() => readonly Value[], never, Scope.Scope> {
  return Effect.gen(function* () {
    const log = listMoveLog<Value>();
    let listed: readonly Value[] | undefined;
    /** The keys of the list last built, in its order. */
    let listedKeys: readonly (string | number)[] = [];
    /** Each row that moved since the list last built, by key, as it stood then and stands now. */
    let moved = new Map<string | number, ListMove<Value>>();

    const subscription = collection.subscribeChanges((changes) => {
      listed = undefined;

      for (const change of changes) {
        // Note that a delete's value is the row as it stood, and an update's previous value too.
        const stood = change.type === "delete" ? change.value : change.previousValue;

        const was = moved.has(change.key)
          ? moved.get(change.key)?.was
          : stood === undefined
            ? undefined
            : pick(stood);

        moved.set(change.key, {
          was,
          now: change.type === "delete" ? undefined : pick(change.value),
        });
      }
    });

    yield* Effect.addFinalizer(() => Effect.sync(() => subscription.unsubscribe()));

    /** The list as the collection stands, logged with what moved since the one before. */
    const build = (): readonly Value[] => {
      const values: Value[] = [];
      const keys: (string | number)[] = [];
      let reordered = false;

      for (const [key, row] of collection.entries()) {
        const value = pick(row);

        if (value === undefined) continue;
        reordered ||= listedKeys[keys.length] !== key;
        keys.push(key);
        values.push(value);
      }

      reordered ||= keys.length !== listedKeys.length;
      listedKeys = keys;
      log.drawn(values, moved, reordered);
      moved = new Map();

      return values;
    };

    return () => {
      listed ??= build();

      return listed;
    };
  });
}
