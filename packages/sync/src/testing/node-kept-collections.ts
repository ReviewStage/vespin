/**
 * node-kept-collections.ts -- a database of collections kept on disk whole on Node's own SQLite, through TanStack DB's persistence core, as a platform hands one to the pool: what the tests keep a stored kind in, the iPhone's being Expo's.
 *
 * The persistence drives SQLite through its own driver contract, answered
 * here over one `node:sqlite` connection, each call in turn and a nested
 * transaction a savepoint, as the Expo adapter answers it over
 * `expo-sqlite`'s async API.
 */

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  createSQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
  SingleProcessCoordinator,
  type SQLiteDriver,
} from "@tanstack/db-sqlite-persistence-core";
import type { StoredKind } from "../entity-pool.js";
import type { KeepCollection } from "../synced-collection.js";

/** The values a statement binds, as `node:sqlite` takes them. */
function bound(params: readonly unknown[]): SQLInputValue[] {
  // SAFETY: the persistence binds SQLite's own values alone, text, numbers, null, and blobs, each of which `node:sqlite` takes.
  return params as SQLInputValue[];
}

/** TanStack's SQLite driver over one `node:sqlite` connection, each call in turn, a nested transaction a savepoint. */
function nodeDriver(database: DatabaseSync): SQLiteDriver {
  let queue: Promise<unknown> = Promise.resolve();
  let savepoints = 0;

  const inTurn = <T>(step: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(step, step);
    queue = next.catch(() => undefined);

    return next;
  };

  const direct: SQLiteDriver = {
    exec: async (sql) => {
      database.exec(sql);
    },
    // SAFETY: each statement the persistence reads names the columns of the row type it asks for, which is what a row of `node:sqlite` holds.
    query: (async (sql: string, params: readonly unknown[] = []) =>
      database.prepare(sql).all(...bound(params))) as SQLiteDriver["query"],
    run: async (sql, params = []) => {
      database.prepare(sql).run(...bound(params));
    },
    transaction: async (fn) => {
      savepoints += 1;
      const name = `sp_${savepoints}`;
      database.exec(`SAVEPOINT ${name}`);

      try {
        const result = await fn(direct);
        database.exec(`RELEASE SAVEPOINT ${name}`);

        return result;
      } catch (cause) {
        database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
        database.exec(`RELEASE SAVEPOINT ${name}`);
        throw cause;
      }
    },
  };

  return {
    exec: (sql) => inTurn(() => direct.exec(sql)),
    query: (sql, params) => inTurn(() => direct.query(sql, params)),
    run: (sql, params) => inTurn(() => direct.run(sql, params)),
    transaction: (fn) =>
      inTurn(async () => {
        database.exec("BEGIN IMMEDIATE");

        try {
          const result = await fn(direct);
          database.exec("COMMIT");

          return result;
        } catch (cause) {
          database.exec("ROLLBACK");
          throw cause;
        }
      }),
  };
}

/** A database of kept collections as a platform opened it: how a stored kind's collection is kept in it, and its close. */
export interface NodeKeptCollections {
  readonly keep: (stored: StoredKind) => KeepCollection;
  readonly close: () => Promise<void>;
  /** The persistence's cache generations, as a platform hands them for its retired kinds to be dropped. */
  readonly generations: ReturnType<typeof createSQLiteCorePersistenceAdapter>;
}

/** The database of kept collections at `file`, each stored kind's collection kept on demand as the iPhone keeps it. */
export function nodeKeptCollections(file: string): NodeKeptCollections {
  const database = new DatabaseSync(file);

  const persistence = {
    adapter: createSQLiteCorePersistenceAdapter({ driver: nodeDriver(database) }),
    coordinator: new SingleProcessCoordinator(),
  };

  return {
    keep: (stored) => (config) =>
      persistedCollectionOptions({
        ...config,
        id: stored.name,
        schemaVersion: stored.version,
        persistence,
        syncMode: "on-demand",
      }),
    close: async () => database.close(),
    generations: persistence.adapter,
  };
}
