// local-database.test.ts -- the account's local database on real `node:sqlite`: its tables and its file's mode, its cached lists cleared and its queues kept across a moved schema hash, its folder forgotten, one account's never another's, and a missing binding answered as a typed failure.
import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Exit, Layer, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import { afterEach, vi } from "vitest";
import { forgetLocalDatabase, openLocalDatabase } from "./local-database.js";
import { nodeSqliteDriverLayer } from "./node/index.js";

const ACCOUNT = "account-1";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeSqliteDriverLayer);

afterEach(() => vi.restoreAllMocks());

/** The account's database file under `root`, as the plan names it. */
const databaseFile = (root: string, accountId: string) =>
  Effect.map(Path.Path, (path) => path.join(root, "accounts", accountId, "local.sqlite"));

/** How many rows `table` holds in the database `open` answers. */
const count = (root: string, accountId: string, table: string) =>
  Effect.scoped(
    Effect.map(
      openLocalDatabase(root, accountId),
      (database) => database.prepare(`SELECT count(*) AS n FROM ${table}`).all()[0]?.n,
    ),
  );

/** One row in each table, as the later leaves will write them. */
const filled = (root: string, accountId: string) =>
  Effect.scoped(
    Effect.map(openLocalDatabase(root, accountId), (database) => {
      database.prepare("INSERT INTO row VALUES (?, ?, ?)").run("plan", "p1", "{}");
      database.prepare("INSERT INTO held VALUES (?, ?, ?)").run("taskList", "", "p1");
      database.prepare("INSERT INTO cursor VALUES (?, ?, ?, ?)").run("taskList", "", "7", "{}");
      database
        .prepare("INSERT INTO outbox (name, idempotency_key, input) VALUES (?, ?, ?)")
        .run("renameTask", "k1", "{}");
      database.prepare("INSERT INTO refused (entry) VALUES (?)").run("{}");
    }),
  );

it.effect("opens a database the user alone may read, holding every table", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const fileSystem = yield* FileSystem.FileSystem;

    const tables = yield* Effect.scoped(
      Effect.map(openLocalDatabase(root, ACCOUNT), (database) =>
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all()
          .map((table) => table.name)
          .sort(),
      ),
    );

    assert.deepEqual(tables, ["cursor", "held", "meta", "outbox", "refused", "row"]);
    const info = yield* fileSystem.stat(yield* databaseFile(root, ACCOUNT));
    assert.equal(info.mode & 0o777, 0o600);
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect(
  "keeps the lists at the same row shapes, and clears them but not the queues at others",
  () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectoryScoped();
      yield* filled(root, ACCOUNT);

      assert.equal(yield* count(root, ACCOUNT, "row"), 1);

      // An older build's shapes, as a database it kept would hold them.
      yield* Effect.scoped(
        Effect.map(openLocalDatabase(root, ACCOUNT), (database) =>
          database.prepare("UPDATE meta SET value = ?").run("older shapes"),
        ),
      );

      const after = yield* Effect.all(
        ["row", "held", "cursor", "outbox", "refused"].map((table) => count(root, ACCOUNT, table)),
      );

      assert.deepEqual(after, [0, 0, 0, 1, 1]);
    }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("forgets the account's folder", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* filled(root, ACCOUNT);

    yield* forgetLocalDatabase(root, ACCOUNT);

    assert.equal(yield* fileSystem.exists(path.join(root, "accounts", ACCOUNT)), false);
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("never opens another account's database", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    yield* filled(root, ACCOUNT);

    assert.equal(yield* count(root, "account-2", "outbox"), 0);
    assert.equal(yield* count(root, ACCOUNT, "outbox"), 1);

    const climbed = yield* Effect.exit(Effect.scoped(openLocalDatabase(root, "../account-1")));
    assert.ok(Exit.isFailure(climbed));
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("fails as a typed error where Node ships no node:sqlite", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined);

    const error = yield* Effect.flip(Effect.scoped(openLocalDatabase(root, ACCOUNT)));

    assert.equal(error._tag, "LocalDatabaseFailed");
  }).pipe(Effect.scoped, Effect.provide(platform)),
);
