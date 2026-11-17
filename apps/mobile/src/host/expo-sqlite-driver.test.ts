// expo-sqlite-driver.test.ts -- the account's local database opened through the iPhone's driver, over a stand-in for `expo-sqlite` that answers its calls on `node:sqlite`: a row written, the database closed, and the row read back on the next open.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { LocalDatabaseDriver, openLocalDatabase } from "@repo/host/local-database";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer } from "effect";
import type { SQLiteBindValue } from "expo-sqlite";
import { expect } from "vitest";
import { expoSqliteDriver } from "./expo-sqlite-driver.js";

const ACCOUNT = "account-1";

/** The values the driver binds, as `node:sqlite` takes them. */
function nodeValues(params: readonly SQLiteBindValue[]): SQLInputValue[] {
  // SAFETY: the driver binds the shared code's values, never a boolean, which `expo-sqlite` takes and `node:sqlite` refuses.
  return params as SQLInputValue[];
}

/** `expo-sqlite`'s `openDatabaseSync` as its native side answers it: the file `name` in `directory`, each call run on `node:sqlite`. */
const nodeOpenDatabase: Parameters<typeof expoSqliteDriver>[0] = (name, _options, directory) => {
  const database = new DatabaseSync(`${directory}/${name}`);

  return {
    execSync: (source) => database.exec(source),
    runSync: (source, params) => {
      database.prepare(source).run(...nodeValues(params));
    },
    getAllSync: (source, params) => database.prepare(source).all(...nodeValues(params)),
    closeSync: () => database.close(),
  };
};

const device = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  Layer.succeed(LocalDatabaseDriver, expoSqliteDriver(nodeOpenDatabase)),
);

it.effect("keeps a row written through the driver for the next open", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();

    yield* Effect.scoped(
      Effect.map(openLocalDatabase(root, ACCOUNT), (database) =>
        database.prepare("INSERT INTO row VALUES (?, ?, ?)").run("plan", "p1", '{"title":"Ship"}'),
      ),
    );

    const rows = yield* Effect.scoped(
      Effect.map(openLocalDatabase(root, ACCOUNT), (database) =>
        database.prepare("SELECT kind, key, row FROM row WHERE kind = ?").all("plan"),
      ),
    );

    expect(rows).toEqual([{ kind: "plan", key: "p1", row: '{"title":"Ship"}' }]);
  }).pipe(Effect.scoped, Effect.provide(device)),
);
