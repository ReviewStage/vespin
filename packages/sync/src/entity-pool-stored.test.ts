// entity-pool-stored.test.ts -- a kind kept on disk whole: its rows and a kept read's cursor outlast the pool, only the read that answers every row removes one, and one account's database never shows another's rows. Kept apart from `entity-pool.test.ts` because each case opens TanStack DB's own persistence over a SQLite file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { createLiveQueryCollection } from "@tanstack/db";
import { Effect, Exit, Scope } from "effect";
import {
  type CollectionsStore,
  type EntityPool,
  entityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type PoolRead,
  type RowKind,
} from "./entity-pool.js";
import { nodeKeptCollections } from "./testing/index.js";

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

/** An account's database at `file`, opened as a store opens it for a sign-in, for as long as the scope it hands back stands. */
function opened(file: string) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const database = nodeKeptCollections(file);
    yield* Scope.addFinalizer(
      scope,
      Effect.promise(() => database.close()),
    );

    const collections: CollectionsStore = { keep: database.keep, scope };

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
