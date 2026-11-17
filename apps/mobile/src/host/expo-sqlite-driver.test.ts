// expo-sqlite-driver.test.ts -- the account's local database opened through the iPhone's driver and file system, over stand-ins for `expo-sqlite` and `expo-file-system` that answer their calls on `node:sqlite` and `node:fs`: a row written, the database closed, and the row read back on the next open.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { LocalDatabaseDriver, openLocalDatabase } from "@repo/host/local-database";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer } from "effect";
import type { SQLiteBindValue } from "expo-sqlite";
import { expect } from "vitest";
import { expoFileSystem } from "./expo-file-system.js";
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

/** `expo-file-system`'s `Directory` as its native side answers it, on `node:fs`. */
class NodeDirectory {
  private readonly path: string;

  constructor(uri: string) {
    this.path = fileURLToPath(uri);
  }

  get exists(): boolean {
    return existsSync(this.path) && statSync(this.path).isDirectory();
  }

  create(options: { readonly intermediates: boolean; readonly idempotent: boolean }): void {
    if (options.idempotent && this.exists) return;
    mkdirSync(this.path, { recursive: options.intermediates });
  }

  list(): readonly unknown[] {
    return readdirSync(this.path);
  }

  delete(): void {
    rmSync(this.path, { recursive: true });
  }
}

/** `expo-file-system`'s `File` as its native side answers it, on `node:fs`. */
class NodeFile {
  private readonly path: string;

  constructor(uri: string) {
    this.path = fileURLToPath(uri);
  }

  get exists(): boolean {
    return existsSync(this.path) && statSync(this.path).isFile();
  }

  get parentDirectory(): NodeDirectory {
    return new NodeDirectory(pathToFileURL(dirname(this.path)).href);
  }

  textSync(): string {
    return readFileSync(this.path, "utf8");
  }

  writeSync(content: string | Uint8Array): void {
    writeFileSync(this.path, content);
  }

  moveSync(destination: NodeFile): void {
    renameSync(this.path, destination.path);
  }

  delete(): void {
    rmSync(this.path);
  }
}

const device = Layer.mergeAll(
  expoFileSystem({ File: NodeFile, Directory: NodeDirectory }),
  NodePath.layer,
  Layer.succeed(LocalDatabaseDriver, expoSqliteDriver(nodeOpenDatabase)),
);

it.effect("keeps a row written through the driver for the next open", () =>
  Effect.gen(function* () {
    // Note that the folder is made on Node's own file system, since the device's makes no temporary folders.
    const root = yield* temporaryDirectoryScoped().pipe(Effect.provide(NodeFileSystem.layer));

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
