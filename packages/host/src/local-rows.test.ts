// local-rows.test.ts -- kept reads' rows on real `node:sqlite`: an answer reads back after a reopen with its rows in held order and its cursor, and a row two reads hold outlives one letting it go.
import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import type { KeptAnswer } from "@repo/sync";
import { Effect, Layer } from "effect";
import { openLocalDatabase } from "./local-database.js";
import { localRows } from "./local-rows.js";
import { nodeSqliteDriverLayer } from "./node/index.js";

const ACCOUNT = "account-1";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeSqliteDriverLayer);

const FIRST = { id: "p1", name: "First" };
const SECOND = { id: "p2", name: "Second" };
const THIRD = { id: "p3", name: "Third" };

/** An answer of `read` on plans in workspace `w1`, as `change` names it. */
const answer = (read: string, change: Partial<KeptAnswer>): KeptAnswer => ({
  read,
  kind: "plan",
  workspace: "w1",
  upserted: [],
  deleted: [],
  held: [],
  cursor: undefined,
  ...change,
});

it.effect("loads an answer back after a reopen with its rows in held order and its cursor", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const cursor = { syncId: "42", origin: "service" };

    yield* Effect.scoped(
      Effect.gen(function* () {
        const rows = localRows(yield* openLocalDatabase(root, ACCOUNT));

        yield* rows.answered(
          answer("taskList", {
            upserted: [
              { key: "p1", row: FIRST },
              { key: "p2", row: SECOND },
            ],
            held: ["p1", "p2"],
          }),
        );
        yield* rows.answered(
          answer("taskList", {
            upserted: [
              { key: "p3", row: THIRD },
              { key: "p1", row: { ...FIRST, name: "Renamed" } },
            ],
            deleted: ["p2"],
            held: ["p3", "p1"],
            cursor,
          }),
        );
      }),
    );

    const loaded = yield* Effect.scoped(
      Effect.flatMap(openLocalDatabase(root, ACCOUNT), (database) =>
        localRows(database).loaded({ read: "taskList", kind: "plan", workspace: "w1" }),
      ),
    );

    assert.deepEqual(loaded, { rows: [THIRD, { ...FIRST, name: "Renamed" }], cursor });
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("keeps a row two reads hold as one lets it go, and deletes it once neither does", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const rows = localRows(yield* openLocalDatabase(root, ACCOUNT));
    const shared = [{ key: "p1", row: FIRST }];

    yield* rows.answered(answer("taskList", { upserted: shared, held: ["p1"] }));
    yield* rows.answered(answer("sidebar", { upserted: shared, held: ["p1"] }));
    yield* rows.answered(answer("taskList", { deleted: ["p1"] }));

    const sidebar = { read: "sidebar", kind: "plan", workspace: "w1" };
    assert.deepEqual((yield* rows.loaded(sidebar))?.rows, [FIRST]);

    yield* rows.answered(answer("sidebar", { deleted: ["p1"] }));
    yield* rows.answered(answer("sidebar", { held: ["p1"] }));

    assert.deepEqual((yield* rows.loaded(sidebar))?.rows, []);
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("keeps no cursor while a held key has no row, so the read starts over", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const rows = localRows(yield* openLocalDatabase(root, ACCOUNT));
    const name = { read: "taskList", kind: "plan", workspace: "w1" };

    // Note that the second answer holds a key whose row an earlier, failed write never stored.
    yield* rows.answered(
      answer("taskList", { upserted: [{ key: "p1", row: FIRST }], held: ["p1"] }),
    );
    yield* rows.answered(answer("taskList", { held: ["p1", "p2"], cursor: { syncId: "42" } }));

    assert.deepEqual(yield* rows.loaded(name), { rows: [FIRST], cursor: undefined });
  }).pipe(Effect.scoped, Effect.provide(platform)),
);
