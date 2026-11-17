// local-queues.test.ts -- the account's two durable queues on real `node:sqlite`: the outbox and the refused messages each read back after a reopen in the order kept, and an entry removed is gone.
import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer } from "effect";
import { openLocalDatabase } from "./local-database.js";
import { localOutbox, localRefused } from "./local-queues.js";
import { nodeSqliteDriverLayer } from "./node/index.js";

const ACCOUNT = "account-1";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeSqliteDriverLayer);

const RENAME = { name: "renameTask", key: "k1", input: { taskId: "t1", name: "First" } };
const PIN = { name: "pinTask", key: "k2", input: { taskId: "t2", pinned: true } };
const MOVE = { name: "moveTask", key: "k3", input: { taskId: "t3", status: "done" } };

it.effect("reads the waiting writes back oldest first after a reopen, less those removed", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const outbox = localOutbox(yield* openLocalDatabase(root, ACCOUNT));

        yield* outbox.added(RENAME);
        yield* outbox.added(PIN);
        yield* outbox.added(MOVE);
        yield* outbox.removed(PIN);
      }),
    );

    const waiting = yield* Effect.scoped(
      Effect.flatMap(openLocalDatabase(root, ACCOUNT), (database) =>
        localOutbox(database).restored([]),
      ),
    );

    assert.deepEqual(waiting, [RENAME, MOVE]);
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect(
  "imports entities.sealed's writes behind the outbox's own once the file was read, and only once",
  () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectoryScoped();
      const outbox = localOutbox(yield* openLocalDatabase(root, ACCOUNT));
      yield* outbox.added(RENAME);

      const unread = yield* outbox.restored(undefined);
      const imported = yield* outbox.restored([PIN, RENAME]);
      yield* outbox.removed(PIN);
      const again = yield* outbox.restored([PIN]);

      assert.deepEqual(unread, [RENAME]);
      assert.deepEqual(imported, [RENAME, PIN]);
      assert.deepEqual(again, [RENAME]);
    }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("reads the refused messages back in order after a reopen, less those let go", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const first = { agentId: "a1", id: "m1", text: "First" };
    const second = { agentId: "a1", id: "m2", text: "Second" };
    const third = { agentId: "a2", id: "m3", text: "Third" };

    yield* Effect.scoped(
      Effect.gen(function* () {
        const refused = localRefused(yield* openLocalDatabase(root, ACCOUNT));

        yield* refused.keep([first, second]);
        yield* refused.keep([first, second, third]);
        yield* refused.keep([first, third]);
      }),
    );

    const kept = yield* Effect.scoped(
      Effect.flatMap(openLocalDatabase(root, ACCOUNT), (database) => localRefused(database).kept),
    );

    assert.deepEqual(kept, [first, third]);
  }).pipe(Effect.scoped, Effect.provide(platform)),
);
