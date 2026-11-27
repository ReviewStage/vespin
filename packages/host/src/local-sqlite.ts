/**
 * local-sqlite.ts -- the local copy's backend on the platform's SQLite driver: the account's database under the state root, its kept reads, its two queues, and its collections kept on disk whole, deleted with the account's folder at sign-out.
 *
 * The Mac and the iPhone each provide a `LocalDatabaseDriver`; this is the
 * one backend (`LocalStoreBackendSeam`) both stand on. Every table is the
 * account's own file (`local-database.ts`), so the kept reads
 * (`local-rows.ts`) and the queues (`local-queues.ts`) are opened over one
 * connection.
 */

import { Context, Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { LocalStoreBackendSeam } from "./local-copy.js";
import {
  forgetLocalDatabase,
  LocalDatabaseDriver,
  openKeptCollections,
  openLocalDatabase,
} from "./local-database.js";
import { localOutbox, localRefused } from "./local-queues.js";
import { localRows } from "./local-rows.js";

/** The SQLite backend over `stateRoot`, on the platform's driver. */
export const sqliteBackend = Effect.fn("host/sqliteBackend")(function* (stateRoot: string) {
  // Note that only the platform's services are kept, never the caller's scope, so each open's database closes with the scope it was opened in.
  const context = Context.pick(
    LocalDatabaseDriver,
    FileSystem.FileSystem,
    Path.Path,
  )(yield* Effect.context<LocalDatabaseDriver | FileSystem.FileSystem | Path.Path>());

  const keepsCollections = (yield* LocalDatabaseDriver).collections !== undefined;

  return {
    keepsCollections,
    open: (accountId) =>
      Effect.map(openLocalDatabase(stateRoot, accountId), (connection) => ({
        rows: localRows(connection),
        queues: { outbox: localOutbox(connection), refused: localRefused(connection) },
        collections: openKeptCollections(stateRoot, accountId).pipe(Effect.provideContext(context)),
      })).pipe(Effect.provideContext(context)),
    forget: (accountId) =>
      forgetLocalDatabase(stateRoot, accountId).pipe(Effect.provideContext(context)),
  } satisfies LocalStoreBackendSeam;
});
