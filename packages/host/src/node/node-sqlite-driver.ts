/**
 * node-sqlite-driver.ts -- the Mac's driver for the account's local database, over Node's built-in `node:sqlite`.
 *
 * The module is reached only as the first database opens, through
 * `process.getBuiltinModule`, so a Node whose build ships without the
 * binding (Electron 37.2.0 once did) fails that open, which
 * `openLocalDatabase` answers as `LocalDatabaseFailed`, rather than failing
 * the process as it loads this file.
 */

import { Layer } from "effect";
import {
  type LocalDatabaseConnection,
  LocalDatabaseDriver,
  type LocalDatabaseDriverSeam,
} from "../local-database.js";

/** Node's `node:sqlite`, or a throw where this Node has none. */
function nodeSqlite(): typeof import("node:sqlite") {
  const sqlite = process.getBuiltinModule("node:sqlite");

  if (sqlite === undefined) throw new Error("this Node has no node:sqlite");

  return sqlite;
}

/** Opens `file` on `node:sqlite`. */
function open(file: string): LocalDatabaseConnection {
  const database = new (nodeSqlite().DatabaseSync)(file);

  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql);

      return {
        run: (...parameters) => {
          statement.run(...parameters);
        },
        all: (...parameters) => statement.all(...parameters),
      };
    },
    close: () => database.close(),
  };
}

const nodeSqliteDriver: LocalDatabaseDriverSeam = { open };

/** The local database's driver on Node, for the desktop's main process to provide. */
export const nodeSqliteDriverLayer = Layer.succeed(LocalDatabaseDriver, nodeSqliteDriver);
