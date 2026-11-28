// local-rows.test.ts -- kept reads' rows on real `node:sqlite`: an answer, whole or naming only what moved, reads back after a reopen with its rows in held order and its cursor, and a row two reads hold outlives one letting it go.
import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import type { KeptAnswer } from "@repo/sync";
import { Effect, Fiber, Layer } from "effect";
import { openLocalDatabase } from "./local-database.js";
import { localRows } from "./local-rows.js";
import { nodeSqliteDriverLayer } from "./node/index.js";

const ACCOUNT = "account-1";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeSqliteDriverLayer);

const FIRST = { id: "p1", name: "First" };
const SECOND = { id: "p2", name: "Second" };
const THIRD = { id: "p3", name: "Third" };
const FOURTH = { id: "p4", name: "Fourth" };

/** An answer of `read` on plans in workspace `w1`, as `change` names it. */
const answer = (read: string, change: Partial<KeptAnswer>): KeptAnswer => ({
  read,
  kind: "plan",
  workspace: "w1",
  upserted: [],
  deleted: [],
  held: { every: [] },
  cursor: undefined,
  ...change,
});

it.effect(
  "loads answers back after a reopen with their rows in held order, one taken up past a whole answer last, and the last cursor",
  () =>
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
              held: { every: ["p1", "p2"] },
            }),
          );
          yield* rows.answered(
            answer("taskList", {
              upserted: [
                { key: "p3", row: THIRD },
                { key: "p1", row: { ...FIRST, name: "Renamed" } },
              ],
              deleted: ["p2"],
              held: { every: ["p3", "p1"] },
            }),
          );
          // Past it, an answer that moved only some takes up Fourth and Second again and lets Third go.
          yield* rows.answered(
            answer("taskList", {
              upserted: [
                { key: "p4", row: FOURTH },
                { key: "p2", row: SECOND },
              ],
              deleted: ["p3"],
              held: { appended: ["p4", "p2"] },
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

      assert.deepEqual(loaded, { rows: [{ ...FIRST, name: "Renamed" }, FOURTH, SECOND], cursor });
    }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("keeps a row two reads hold as one lets it go, and deletes it once neither does", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const rows = localRows(yield* openLocalDatabase(root, ACCOUNT));
    const shared = [{ key: "p1", row: FIRST }];

    yield* rows.answered(answer("taskList", { upserted: shared, held: { every: ["p1"] } }));
    yield* rows.answered(answer("sidebar", { upserted: shared, held: { every: ["p1"] } }));
    yield* rows.answered(answer("taskList", { deleted: ["p1"] }));

    const sidebar = { read: "sidebar", kind: "plan", workspace: "w1" };
    assert.deepEqual((yield* rows.loaded(sidebar))?.rows, [FIRST]);

    yield* rows.answered(answer("sidebar", { deleted: ["p1"] }));
    yield* rows.answered(answer("sidebar", { held: { every: ["p1"] } }));

    assert.deepEqual((yield* rows.loaded(sidebar))?.rows, []);
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect(
  "loads a large keep a slice at a time, so other work runs before it is read back whole",
  () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectoryScoped();

      // Note that the rows come to some 1.5 MB of JSON, several slices' worth, as a busy account's Inbox is many.
      const kept = Array.from({ length: 150 }, (_, at) => ({
        id: `p${at}`,
        name: "x".repeat(10_000),
      }));

      const order: string[] = [];

      const loaded = yield* Effect.scoped(
        Effect.gen(function* () {
          const rows = localRows(yield* openLocalDatabase(root, ACCOUNT));

          yield* rows.answered(
            answer("inbox", {
              upserted: kept.map((row) => ({ key: row.id, row })),
              held: { every: kept.map((row) => row.id) },
              cursor: { syncId: "7" },
            }),
          );

          const loading = yield* Effect.forkChild(
            Effect.tap(rows.loaded({ read: "inbox", kind: "plan", workspace: "w1" }), () =>
              Effect.sync(() => order.push("loaded")),
            ),
          );

          yield* Effect.forkChild(Effect.sync(() => order.push("other")));

          return yield* Fiber.join(loading);
        }),
      );

      assert.deepEqual(order, ["other", "loaded"], "the load yields between its slices");
      assert.deepEqual(loaded, { rows: kept, cursor: { syncId: "7" } });
    }).pipe(Effect.scoped, Effect.provide(platform)),
);
