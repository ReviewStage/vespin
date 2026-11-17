/**
 * local-copy.ts -- the signed-in account's local database as the sync engine's store: opened at sign-in, written as the pool answers and its writes wait, the account's refused agent messages kept in it and laid back from it, and deleted at sign-out.
 *
 * This is the shadow release of the local database (`local-database.ts`).
 * The pool is handed one store for its life (`PoolOptions.store`), which
 * forwards to the database open now and does nothing while none is, so a
 * sign-in opens it without rebuilding the pool. Its kept reads' answers go
 * to `localRows`, its waiting writes to `localOutbox`, and the agent
 * messages the service refused to `localRefused`, each move written whole.
 *
 * The refused messages are kept here alone: an open lays back what the
 * `refused` table holds, and the first open whose table holds none takes
 * the ones `entities.sealed` kept for this account (`SealedRefusals`)
 * once, then tells that file to drop them, so a later open never brings
 * back one let go since. The lists still draw first from
 * `entities.sealed`, since the store's `loaded` answers none, and the
 * waiting writes are still laid back from there.
 *
 * A database that will not open leaves the store doing nothing for that
 * sign-in, and the failure is reported to Sentry by its tag and its
 * cause's kind, never by a row or a path, which is what the release's gate
 * reads. Its refusals are then laid back from `entities.sealed`, which
 * keeps them until an open takes them.
 */

import { failureKind, reportUnexpected } from "@repo/runtime/effect";
import type { KeptAnswer, OutboxStore, PoolStore, QueuedEntry, RowsStore } from "@repo/sync";
import { Effect, Exit, type Path, Result, Scope, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import {
  forgetLocalDatabase,
  type LocalDatabaseDriver,
  type LocalDatabaseFailed,
  openLocalDatabase,
} from "./local-database.js";
import { type LocalQueueReadFailed, localOutbox, localRefused } from "./local-queues.js";
import { localRows } from "./local-rows.js";

/** What Sentry is told of a local database that would not open, be deleted, or read its refused messages back. */
const LOCAL_DATABASE_REPORT = {
  OPEN_FAILED: "host.localDatabase.openFailed",
  FORGET_FAILED: "host.localDatabase.forgetFailed",
  REFUSED_READ_FAILED: "host.localDatabase.refusedReadFailed",
} as const;

/** The agent messages the service refused, as the agents' composer hands them out (`compose-agents.ts`). */
export interface RefusedMessages {
  /** The signed-in account's, whole. */
  readonly kept: () => readonly unknown[];
  /** Each moving of them. */
  readonly moves: Stream.Stream<void>;
  /** `account`'s, as they were kept, laid back. */
  readonly restored: (account: string, kept: readonly unknown[]) => Effect.Effect<void>;
}

/** The refused messages an older build kept in `entities.sealed` for this account, which an open takes once. */
export interface SealedRefusals {
  /** As the file held them. */
  readonly entries: readonly unknown[];
  /** Has the file drop them, since the database holds them now. */
  readonly imported: Effect.Effect<void>;
}

/** No file, so no refusals to take. */
const NO_SEALED_REFUSALS: SealedRefusals = { entries: [], imported: Effect.void };

/** The account's database, from its sign-in until its sign-out. */
export interface LocalCopy {
  /** The pool's store for its life: the database open now, or nothing while none is. */
  readonly store: PoolStore;
  /** Opens `accountId`'s database where none stands, its refused messages laid back from it, or from `sealed` the first time, and kept as they move; a failure is reported, leaves none open, and lays back `sealed`'s. */
  readonly open: (
    accountId: string,
    refused: RefusedMessages,
    sealed?: SealedRefusals,
  ) => Effect.Effect<void>;
  /** Closes the database and deletes the folder of the account it was last opened for, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
}

/** The stores over one open database, and the scope it closes with. */
interface Opened {
  readonly rows: RowsStore;
  readonly outbox: OutboxStore;
  readonly scope: Scope.Closeable;
}

/** Reports `failure` by its tag and its cause's kind alone. */
function reported(
  kind: string,
  failure: LocalDatabaseFailed | LocalQueueReadFailed,
): Effect.Effect<void> {
  return reportUnexpected(kind, { failure: failure._tag, cause: failureKind(failure.cause) });
}

/**
 * The local copy over `stateRoot`, on the platform's driver, for as long as
 * the caller's scope stands, which closes a database still open.
 */
export const localCopy = Effect.fn("host/localCopy")(function* (stateRoot: string) {
  const context = yield* Effect.context<LocalDatabaseDriver | FileSystem.FileSystem | Path.Path>();
  let opened: Opened | undefined;
  /** The account the last open was for, whose folder a sign-out deletes even where it would not open. */
  let account: string | undefined;

  const close = Effect.suspend(() => {
    const standing = opened;
    opened = undefined;

    return standing === undefined ? Effect.void : Scope.close(standing.scope, Exit.void);
  });

  yield* Effect.addFinalizer(() => close);

  // Note that nothing is loaded in this release, so every read draws first from `entities.sealed`.
  const store: PoolStore = {
    outbox: {
      added: (entry: QueuedEntry) => opened?.outbox.added(entry) ?? Effect.void,
      removed: (entry: QueuedEntry) => opened?.outbox.removed(entry) ?? Effect.void,
    },
    rows: {
      answered: (answer: KeptAnswer) => opened?.rows.answered(answer) ?? Effect.void,
      loaded: () => Effect.undefined,
    },
  };

  const open = (
    accountId: string,
    refused: RefusedMessages,
    sealed: SealedRefusals = NO_SEALED_REFUSALS,
  ) =>
    Effect.gen(function* () {
      if (opened !== undefined) return;
      account = accountId;
      const scope = yield* Scope.make();

      const connection = yield* Effect.result(
        openLocalDatabase(stateRoot, accountId).pipe(Scope.provide(scope)),
      );

      if (Result.isFailure(connection)) {
        yield* Scope.close(scope, Exit.void);
        yield* reported(LOCAL_DATABASE_REPORT.OPEN_FAILED, connection.failure);

        return yield* refused.restored(accountId, sealed.entries);
      }

      const kept = localRefused(connection.success);
      const stored = yield* Effect.result(kept.kept);

      // Note that a table that will not read is left as it stands, and the file keeps its refusals for the next open.
      if (Result.isFailure(stored)) {
        yield* Scope.close(scope, Exit.void);
        yield* reported(LOCAL_DATABASE_REPORT.REFUSED_READ_FAILED, stored.failure);

        return yield* refused.restored(accountId, sealed.entries);
      }

      // Note that an empty table takes the file's refusals, which a database opened before this build mirrored, so a table that holds any is the newer word.
      yield* refused.restored(
        accountId,
        stored.success.length === 0 ? sealed.entries : stored.success,
      );
      const keep = Effect.suspend(() => kept.keep(refused.kept()));
      // Note that the file drops its refusals only once they were written to the table.
      yield* keep;
      yield* sealed.imported;
      yield* Effect.forkIn(
        Stream.runForEach(refused.moves, () => keep),
        scope,
      );
      opened = {
        rows: localRows(connection.success),
        outbox: localOutbox(connection.success),
        scope,
      };
    }).pipe(Effect.provideContext(context));

  const forget = Effect.gen(function* () {
    yield* close;
    const forgotten = account;
    account = undefined;

    if (forgotten === undefined) return;

    yield* forgetLocalDatabase(stateRoot, forgotten).pipe(
      Effect.catch((failure) => reported(LOCAL_DATABASE_REPORT.FORGET_FAILED, failure)),
    );
  }).pipe(Effect.provideContext(context));

  return { store, open, forget } satisfies LocalCopy;
});
