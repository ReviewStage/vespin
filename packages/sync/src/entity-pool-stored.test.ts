// entity-pool-stored.test.ts -- a kind kept on disk whole: its rows and a kept read's cursor outlast the pool, only the read that answers every row removes one, and one account's database never shows another's rows. Kept apart from `entity-pool.test.ts` because each case opens TanStack DB's own persistence over a SQLite file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { it } from "@effect/vitest";
import { createLiveQueryCollection } from "@tanstack/db";
import {
  createSQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
  SingleProcessCoordinator,
  type SQLiteDriver,
} from "@tanstack/db-sqlite-persistence-core";
import { Deferred, Effect, Exit, Scope } from "effect";
import {
  type CollectionsStore,
  type EntityPool,
  entityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type PoolRead,
  ROW_GONE,
  type RowKind,
  type WriteDeclaration,
} from "./entity-pool.js";

interface Row {
  readonly id: string;
  readonly name: string;
}

/** A kind kept on disk whole where an account's database is open. */
const STORED: RowKind<Row, FieldChange<Row>> = {
  ...fieldKind((row: Row) => row.id),
  stored: { name: "row", version: 1 },
};

/** The kept read every case stands, whose cursor rides beside its rows. */
const KEPT = { name: "rows", kind: "row" } as const;

/** The values a statement binds, as `node:sqlite` takes them. */
function bound(params: readonly unknown[]): SQLInputValue[] {
  // SAFETY: the persistence binds SQLite's own values alone, text, numbers, null, and blobs, each of which `node:sqlite` takes.
  return params as SQLInputValue[];
}

/** TanStack's SQLite driver over one `node:sqlite` connection, each call in turn, a nested transaction a savepoint. */
function nodeDriver(database: DatabaseSync): SQLiteDriver {
  let queue: Promise<unknown> = Promise.resolve();
  let savepoints = 0;

  const inTurn = <T>(step: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(step, step);
    queue = next.catch(() => undefined);

    return next;
  };

  const direct: SQLiteDriver = {
    exec: async (sql) => {
      database.exec(sql);
    },
    // SAFETY: each statement the persistence reads names the columns of the row type it asks for, which is what a row of `node:sqlite` holds.
    query: (async (sql: string, params: readonly unknown[] = []) =>
      database.prepare(sql).all(...bound(params))) as SQLiteDriver["query"],
    run: async (sql, params = []) => {
      database.prepare(sql).run(...bound(params));
    },
    transaction: async (fn) => {
      savepoints += 1;
      const name = `sp_${savepoints}`;
      database.exec(`SAVEPOINT ${name}`);

      try {
        const result = await fn(direct);
        database.exec(`RELEASE SAVEPOINT ${name}`);

        return result;
      } catch (cause) {
        database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
        database.exec(`RELEASE SAVEPOINT ${name}`);
        throw cause;
      }
    },
  };

  return {
    exec: (sql) => inTurn(() => direct.exec(sql)),
    query: (sql, params) => inTurn(() => direct.query(sql, params)),
    run: (sql, params) => inTurn(() => direct.run(sql, params)),
    transaction: (fn) =>
      inTurn(async () => {
        database.exec("BEGIN IMMEDIATE");

        try {
          const result = await fn(direct);
          database.exec("COMMIT");

          return result;
        } catch (cause) {
          database.exec("ROLLBACK");
          throw cause;
        }
      }),
  };
}

/** An account's database at `file`, opened as a store opens it for a sign-in, for as long as the scope it hands back stands. */
function opened(file: string) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const database = new DatabaseSync(file);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => database.close()),
    );

    const persistence = {
      adapter: createSQLiteCorePersistenceAdapter({ driver: nodeDriver(database) }),
      coordinator: new SingleProcessCoordinator(),
    };

    const collections: CollectionsStore = {
      keep: (stored) => (config) =>
        persistedCollectionOptions({
          ...config,
          id: stored.name,
          schemaVersion: stored.version,
          persistence,
          syncMode: "on-demand",
        }),
      scope,
    };

    return { collections, close: Scope.close(scope, Exit.void) };
  });
}

/** A pool for as long as the caller's scope, keeping stored kinds in whichever database `open` names now. */
function poolOver(open: () => CollectionsStore | undefined) {
  return entityPool({
    mintKey: () => "key",
    replayRefused: Effect.void,
    store: { collections: open },
  });
}

/** A read of the stored kind in a scope of its own, which the test closes to let it go. */
function standing(pool: EntityPool, read: Partial<PoolRead<Row, FieldChange<Row>>> = {}) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();

    const rows: HeldRows<Row, FieldChange<Row>> = yield* Scope.provide(scope)(
      pool.stand(STORED, { redraw: () => Effect.void, confirmation: () => undefined, ...read }),
    );

    return { rows, letGo: Scope.close(scope, Exit.void) };
  });
}

/** The ids of every row the database open now keeps of the stored kind, as a live query loads them from it. */
function keptIds(pool: EntityPool) {
  return Effect.flatMap(pool.collection(STORED), (collection) =>
    Effect.promise(async () => {
      const query = createLiveQueryCollection({
        query: (q) => q.from({ row: collection }),
        startSync: true,
        gcTime: 0,
      });

      await query.preload();
      const ids = query.toArray.map((row) => row.id).sort();
      await query.cleanup();

      return ids;
    }),
  );
}

/** A fresh folder for a case's databases, removed as its scope closes. */
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "stored-kind-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

/** `step` run over a pool on the database at `file`, opened for it and closed after, as one launch of the app. */
function launch<A>(file: string, step: (pool: EntityPool) => Effect.Effect<A>) {
  return Effect.gen(function* () {
    const database = yield* opened(file);

    const answer = yield* Effect.scoped(
      Effect.flatMap(
        poolOver(() => database.collections),
        step,
      ),
    );

    yield* database.close;

    return answer;
  });
}

const ADA = { id: "a", name: "Ada" };
const BO = { id: "b", name: "Bo" };
const CY = { id: "c", name: "Cy" };

it.effect(
  "a stored kind's rows and its kept read's cursor outlast the launch, and a read letting go of a row, by its answer or its scope, leaves it kept",
  () =>
    Effect.gen(function* () {
      const file = join(yield* folder, "account.sqlite");

      yield* launch(file, (pool) =>
        Effect.gen(function* () {
          const owner = yield* standing(pool, { owns: true, kept: KEPT });
          yield* owner.rows.answer([ADA, BO], { cursor: { at: "7" } });
          const plan = yield* standing(pool);
          yield* plan.rows.answer([ADA]);
          yield* plan.rows.answer([]);
          yield* plan.letGo;
          yield* owner.letGo;
        }),
      );

      const next = yield* launch(file, (pool) =>
        Effect.gen(function* () {
          const owner = yield* standing(pool, { owns: true, kept: KEPT });

          return {
            stored: owner.rows.stored,
            loaded: owner.rows.loaded,
            ids: yield* keptIds(pool),
          };
        }),
      );

      assert.deepEqual(next, { stored: { at: "7" }, loaded: true, ids: ["a", "b"] });
    }),
);

it.effect(
  "only the read that answers every row removes a kept one: its gone deletes a row it never took this launch, and its whole answer replaces what is kept, but what another read holds",
  () =>
    Effect.gen(function* () {
      const file = join(yield* folder, "account.sqlite");

      yield* launch(file, (pool) =>
        Effect.gen(function* () {
          const owner = yield* standing(pool, { owns: true, kept: KEPT });
          yield* owner.rows.answer([ADA, BO, CY], { cursor: { at: "1" } });
        }),
      );

      const ids = yield* launch(file, (pool) =>
        Effect.gen(function* () {
          const plan = yield* standing(pool);
          yield* plan.rows.answer([CY], { gone: ["a"] });
          const afterPlan = yield* keptIds(pool);
          const owner = yield* standing(pool, { owns: true, kept: KEPT });
          yield* owner.rows.answer([], { gone: ["a"], cursor: { at: "2" } });
          const afterGone = yield* keptIds(pool);
          yield* owner.rows.answer([{ id: "d", name: "Di" }], { cursor: { at: "3" } });

          return { afterPlan, afterGone, afterWhole: yield* keptIds(pool) };
        }),
      );

      assert.deepEqual(ids, {
        afterPlan: ["a", "b", "c"],
        afterGone: ["b", "c"],
        afterWhole: ["c", "d"],
      });
    }),
);

it.effect(
  "a pool on another account's database shows none of the first's rows, nor its cursor",
  () =>
    Effect.gen(function* () {
      const root = yield* folder;
      const first = yield* opened(join(root, "first.sqlite"));
      const second = yield* opened(join(root, "second.sqlite"));
      let open: CollectionsStore | undefined = first.collections;

      const seen = yield* Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* poolOver(() => open);
          const owner = yield* standing(pool, { owns: true, kept: KEPT });
          yield* owner.rows.answer([ADA], { cursor: { at: "9" } });
          yield* owner.letGo;
          yield* first.close;
          open = second.collections;
          const next = yield* standing(pool, { owns: true, kept: KEPT });

          return {
            stored: next.rows.stored,
            row: pool.row(STORED, "a"),
            ids: yield* keptIds(pool),
          };
        }),
      );

      yield* second.close;
      assert.deepEqual(seen, { stored: undefined, row: undefined, ids: [] });
    }),
);

/** Every row the database open now keeps of the stored kind, as a live query loads it, by id and name. */
function keptRows(pool: EntityPool) {
  return Effect.flatMap(pool.collection(STORED), (collection) =>
    Effect.promise(async () => {
      const query = createLiveQueryCollection({
        query: (q) => q.from({ row: collection }),
        startSync: true,
        gcTime: 0,
      });

      await query.preload();
      const rows = query.toArray.map((row) => [row.id, row.name] as const).sort();
      await query.cleanup();

      return rows;
    }),
  );
}

/** A write of `change` over the row it names, carried by a service that answers the transaction `txid` names, or none. */
function writing(
  change: FieldChange<Row>,
  txid: string | undefined,
): WriteDeclaration<Row, FieldChange<Row>, string, void> {
  return {
    kind: STORED,
    keys: (id) => [id],
    change: () => change,
    send: () => Effect.succeed({ answer: undefined, txid }),
  };
}

const RENAMED: FieldChange<Row> = () => ({ name: "Renamed" });
const REMOVED: FieldChange<Row> = () => ROW_GONE;

it.effect(
  "a write over a row a launch only loaded from disk stands until the read that answers every row carries it, and lands there, a removal included, where the service names no transaction",
  () =>
    Effect.gen(function* () {
      const file = join(yield* folder, "account.sqlite");

      yield* launch(file, (pool) =>
        Effect.gen(function* () {
          const owner = yield* standing(pool, { owns: true, kept: KEPT });
          yield* owner.rows.answer([ADA, BO, CY], { cursor: { at: "1" } });
        }),
      );

      const during = yield* launch(file, (pool) =>
        Effect.gen(function* () {
          const confirmed = yield* Deferred.make<void>();

          yield* standing(pool, {
            owns: true,
            kept: KEPT,
            confirmation: () => () => Deferred.await(confirmed),
          });

          // Note that the row is loaded from disk by a live query alone, as a screen loads it; no answer of this launch carries it.
          yield* keptRows(pool);
          yield* pool.write(writing(RENAMED, "tx-1"), "a");
          yield* Effect.repeat(Effect.yieldNow, { times: 20 });
          const shown = pool.row(STORED, "a")?.name;
          yield* Deferred.succeed(confirmed, undefined);

          return shown;
        }),
      );

      yield* launch(file, (pool) =>
        Effect.gen(function* () {
          yield* standing(pool, { owns: true, kept: KEPT });
          yield* keptRows(pool);
          yield* pool.write(writing(RENAMED, undefined), "b");
          yield* pool.write(writing(REMOVED, undefined), "c");
          yield* Effect.repeat(Effect.yieldNow, { times: 20 });
        }),
      );

      const kept = yield* launch(file, keptRows);

      assert.equal(during, "Renamed", "the write stands while the read has not carried it");
      assert.deepEqual(kept, [
        ["a", "Ada"],
        ["b", "Renamed"],
      ]);
    }),
);

it.effect(
  "a stored kind whose database fails as it starts ends the read's wait with that failure",
  () =>
    Effect.gen(function* () {
      const file = join(yield* folder, "account.sqlite");
      // Note that the file holds no database, so the persistence's first read of it fails after it was handed the collection.
      writeFileSync(file, "not a database, only words long enough to stand where a header would");
      const database = yield* opened(file);

      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.flatMap(
            poolOver(() => database.collections),
            (pool) => pool.collection(STORED),
          ),
        ),
      );

      yield* database.close;
      assert.equal(Exit.hasDies(exit), true);
    }),
);
