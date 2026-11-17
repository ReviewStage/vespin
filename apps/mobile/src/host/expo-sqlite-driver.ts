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
 * The file needs no protection of its own: iOS keeps every file the app
 * creates, the database and its WAL files among them, under the Data
 * Protection class `completeUntilFirstUserAuthentication` by default, so
 * it is encrypted at rest until the device is first unlocked after boot.
 */

import type {
  LocalDatabaseConnection,
  LocalDatabaseDriverSeam,
  LocalDatabaseValue,
} from "@repo/host/local-database";
import type { SQLiteBindValue } from "expo-sqlite";

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

/** Opens `file`, a plain absolute path, as the folder and file name `expo-sqlite` takes. */
function openAt(openDatabase: OpenDatabase, file: string): LocalDatabaseConnection {
  const slash = file.lastIndexOf("/");

  if (slash <= 0 || slash === file.length - 1) throw new Error(`not a file in a folder: ${file}`);

  const database = openDatabase(file.slice(slash + 1), undefined, file.slice(0, slash));

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

/** The local database's driver on the device, over `openDatabase`: `expo-sqlite`'s own `openDatabaseSync` in the app. */
export function expoSqliteDriver(openDatabase: OpenDatabase): LocalDatabaseDriverSeam {
  return { open: (file) => openAt(openDatabase, file) };
}
