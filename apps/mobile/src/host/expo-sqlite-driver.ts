/**
 * expo-sqlite-driver.ts -- the iPhone's driver for the account's local database, over `expo-sqlite`'s synchronous API.
 *
 * The shared code (`@repo/host/local-database`) names the database by a
 * plain absolute path and drives it through `LocalDatabaseDriverSeam`, as
 * the Mac's `node:sqlite` driver answers it; this answers the same seam on
 * the device. `expo-sqlite` opens a database by a file name in a folder,
 * so the path is split into the two here and nowhere else.
 *
 * Each statement is run through the connection's `runSync` and
 * `getAllSync`, which prepare, run, and finalize it in one call, rather
 * than kept prepared: the shared code prepares a statement where it runs
 * it, and one kept would hold native memory until the connection closed.
 *
 * Beside it the account's collections kept on disk whole stand in a
 * database of their own (`KeptCollectionsDatabase`), opened through
 * `expo-sqlite`'s async API, whose statements run off the JavaScript thread,
 * and kept by TanStack DB's own persistence for Expo
 * (`@tanstack/expo-db-sqlite-persistence`), each stored kind's collection
 * loaded on demand: a live query reads from SQLite only the rows its filter
 * finds there.
 *
 * The file needs no protection of its own: iOS keeps every file the app
 * creates, the database and its WAL files among them, under the Data
 * Protection class `completeUntilFirstUserAuthentication` by default, so
 * it is encrypted at rest until the device is first unlocked after boot.
 */

import type {
  KeptCollectionsDatabase,
  KeptWordsDatabase,
  LocalDatabaseConnection,
  LocalDatabaseDriverSeam,
  LocalDatabaseValue,
} from "@repo/host/local-database";
import {
  createExpoSQLitePersistence,
  type ExpoSQLiteDatabaseLike,
  persistedCollectionOptions,
} from "@tanstack/expo-db-sqlite-persistence";
import type { SQLiteBindValue } from "expo-sqlite";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";

/** The values a statement binds, as `expo-sqlite` takes them. */
type BindValues = SQLiteBindValue[];

/** The shared code's values as `expo-sqlite` binds them. */
function bindValues(parameters: readonly LocalDatabaseValue[]): BindValues {
  // SAFETY: every value but a `bigint` is one `expo-sqlite` types, and its native side binds a `bigint` as a 64-bit integer (`SQLiteBindValue.swift`), though its types leave one out.
  return parameters as BindValues;
}

/** What the driver calls of an open `expo-sqlite` database (`SQLiteDatabase`). */
interface ExpoDatabase {
  readonly execSync: (source: string) => void;
  readonly runSync: (source: string, params: BindValues) => void;
  readonly getAllSync: (
    source: string,
    params: BindValues,
  ) => readonly Readonly<Record<string, LocalDatabaseValue>>[];
  readonly closeSync: () => void;
}

/** `expo-sqlite`'s `openDatabaseSync`, as the driver calls it: a file name in a folder. */
type OpenDatabase = (databaseName: string, options: undefined, directory: string) => ExpoDatabase;

/** An open database as the async API answers it: what TanStack's persistence drives, and its close. */
type ExpoAsyncDatabase = ExpoSQLiteDatabaseLike & { readonly closeAsync: () => Promise<void> };

/** `expo-sqlite`'s `openDatabaseAsync`, as the driver calls it: a file name in a folder. */
type OpenDatabaseAsync = (
  databaseName: string,
  options: undefined,
  directory: string,
) => Promise<ExpoAsyncDatabase>;

/** A database's file as `expo-sqlite` names it: its name in its folder. */
interface PlacedFile {
  readonly name: string;
  readonly folder: string;
}

/** `file`, a plain absolute path, as the file name and folder `expo-sqlite` takes. */
function placed(file: string): PlacedFile {
  const slash = file.lastIndexOf("/");

  if (slash <= 0 || slash === file.length - 1) throw new Error(`not a file in a folder: ${file}`);

  return { name: file.slice(slash + 1), folder: file.slice(0, slash) };
}

/** Opens `file`, a plain absolute path, as the folder and file name `expo-sqlite` takes. */
function openAt(openDatabase: OpenDatabase, file: string): LocalDatabaseConnection {
  const { name, folder } = placed(file);
  const database = openDatabase(name, undefined, folder);
  // Note that the launch's first open is noted as its local phase, which `app:ready` counts.
  noteLaunchPhase(LAUNCH_PHASE.LOCAL);

  return {
    exec: (sql) => database.execSync(sql),
    prepare: (sql) => ({
      run: (...parameters) => {
        database.runSync(sql, bindValues(parameters));
      },
      all: (...parameters) => database.getAllSync(sql, bindValues(parameters)),
    }),
    close: () => database.closeSync(),
  };
}

/** Opens the database of collections kept on disk whole at `file`, each stored kind's kept by TanStack's persistence and loaded on demand. */
async function collectionsAt(
  openDatabaseAsync: OpenDatabaseAsync,
  file: string,
): Promise<KeptCollectionsDatabase> {
  const { name, folder } = placed(file);
  const database = await openDatabaseAsync(name, undefined, folder);
  const persistence = createExpoSQLitePersistence({ database });

  return {
    keep: (stored) => (config) =>
      persistedCollectionOptions({
        ...config,
        id: stored.name,
        schemaVersion: stored.version,
        persistence,
        syncMode: "on-demand",
      }),
    close: () => database.closeAsync(),
    generations: persistence.adapter,
  };
}

/** Opens the database the kept messages' words stand in at `file`, each statement run through `expo-sqlite`'s async API, off the JavaScript thread. */
async function wordsAt(
  openDatabaseAsync: OpenDatabaseAsync,
  file: string,
): Promise<KeptWordsDatabase> {
  const { name, folder } = placed(file);
  const database = await openDatabaseAsync(name, undefined, folder);

  return {
    exec: (sql) => database.execAsync(sql),
    run: async (sql, params) => {
      await database.runAsync(sql, [...params]);
    },
    all: (sql, params) =>
      database.getAllAsync<Readonly<Record<string, LocalDatabaseValue>>>(sql, [...params]),
    close: () => database.closeAsync(),
  };
}

/**
 * The local database's driver on the device, over `openDatabase`, and its
 * kept collections' over `openDatabaseAsync`: `expo-sqlite`'s own
 * `openDatabaseSync` and `openDatabaseAsync` in the app.
 */
export function expoSqliteDriver(
  openDatabase: OpenDatabase,
  openDatabaseAsync: OpenDatabaseAsync,
): LocalDatabaseDriverSeam {
  return {
    open: (file) => openAt(openDatabase, file),
    collections: (file) => collectionsAt(openDatabaseAsync, file),
    words: (file) => wordsAt(openDatabaseAsync, file),
  };
}
