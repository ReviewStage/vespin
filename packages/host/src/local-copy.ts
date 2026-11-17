/**
 * local-copy.ts -- the signed-in account's local database as the sync engine's store: opened at sign-in, written as the pool answers and its writes wait, its waiting writes and refused agent messages read back to be laid over the pool, and deleted at sign-out.
 *
 * The pool is handed one store for its life (`PoolOptions.store`), which
 * forwards to the database open now and does nothing while none is, so a
 * sign-in opens it without rebuilding the pool. Its kept reads' answers go
 * to `localRows`, its waiting writes to `localOutbox`, and the agent
 * messages the service refused to `localRefused`, each move written whole.
 *
 * The outbox is the only place waiting writes are kept: an open answers
 * them oldest first, for the caller to lay back over the pool (`requeue`)
 * before any read draws, having imported once the queue an older build
 * kept in `entities.sealed`. The rows are not loaded yet: the store's
 * `loaded` answers none, so each read still draws first from
 * `entities.sealed`. A database that will not open leaves the store doing
 * nothing for that sign-in and answers the sealed queue, which the file
 * goes on carrying until a database imports it, so this launch
 * still sends it, and the failure is reported to Sentry by its tag and its
 * cause's kind, never by a row or a path, which is what the release's gate
 * reads.
 *
 * The `refused` table is likewise the only place the agent messages the
 * service refused are kept: an open lays back what it holds, and the first
 * open whose table holds none takes the ones an older build kept in
 * `entities.sealed` (`sealed.refused`), telling the file to drop them only
 * once the table reads them all back. Where the database will not open, or
 * its table will not read, they are laid back from the file and kept in
 * memory for that launch alone, as the waiting writes are.
 */

import { failureKind, reportUnexpected } from "@repo/runtime/effect";
import type { KeptAnswer, OutboxStore, PoolStore, QueuedEntry, RowsStore } from "@repo/sync";
import { Effect, Exit, type Path, Result, Scope, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type { SealedRefusals, SealedWrites } from "./entity-store.js";
import {
  forgetLocalDatabase,
  type LocalDatabaseDriver,
  type LocalDatabaseFailed,
  openLocalDatabase,
} from "./local-database.js";
import {
  type LocalQueueReadFailed,
  type LocalRefused,
  localOutbox,
  localRefused,
} from "./local-queues.js";
import { localRows } from "./local-rows.js";

/** What Sentry is told of a local database that would not open, read a queue back, or be deleted. */
const LOCAL_DATABASE_REPORT = {
  OPEN_FAILED: "host.localDatabase.openFailed",
  OUTBOX_UNREAD: "host.localDatabase.outboxUnread",
  REFUSED_UNREAD: "host.localDatabase.refusedUnread",
  FORGET_FAILED: "host.localDatabase.forgetFailed",
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

/** What `entities.sealed` held of the account's queues as it opened, read once for the database to import. */
export interface SealedQueues {
  /** The row writes an older build kept waiting there, which the file carries until told they were imported; none where the file was not read, which imports and marks nothing. */
  readonly queue: SealedWrites | undefined;
  /** The messages refused an older build kept there, carried the same way; none where the file was not read. */
  readonly refused?: SealedRefusals | undefined;
}

/** The account's database, from its sign-in until its sign-out. */
export interface LocalCopy {
  /** The pool's store for its life: the database open now, or nothing while none is. */
  readonly store: PoolStore;
  /**
   * Opens `accountId`'s database where none stands, its refused messages
   * laid back from it, or from `sealed.refused` the first time, and kept as
   * they move, and answers its waiting writes, oldest first,
   * `sealed.queue` imported once first and the file told so; a failure is
   * reported, leaves none open, answers `sealed.queue`'s entries, and leaves
   * the file carrying them. One standing already
   * answers none, since its writes were laid back as it opened.
   */
  readonly open: (
    accountId: string,
    refused: RefusedMessages,
    sealed: SealedQueues,
  ) => Effect.Effect<readonly QueuedEntry[]>;
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

  // Note that no rows are loaded in this release, so every read draws first from `entities.sealed`.
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

  const open = (accountId: string, refused: RefusedMessages, sealed: SealedQueues) =>
    Effect.gen(function* () {
      /**
       * The refused messages laid back from the table, or from the file where
       * it holds none, and kept as they move. Note that a table that will not
       * read is left as it stands, and the file keeps carrying its refusals.
       */
      const refusedOpened = (kept: LocalRefused, scope: Scope.Scope) =>
        Effect.gen(function* () {
          const stored = yield* Effect.result(kept.kept);

          if (Result.isFailure(stored)) {
            yield* reported(LOCAL_DATABASE_REPORT.REFUSED_UNREAD, stored.failure);

            return yield* refused.restored(accountId, sealed.refused?.entries ?? []);
          }

          // Note that an empty table takes the file's refusals, which a database opened before this build mirrored, so a table that holds any is the newer word.
          yield* refused.restored(
            accountId,
            stored.success.length === 0 ? (sealed.refused?.entries ?? []) : stored.success,
          );
          const keep = Effect.suspend(() => kept.keep(refused.kept()));
          yield* keep;
          // Note that a write to the table logs its failure rather than failing, so the file drops its refusals only once the table reads them all back.
          const written = yield* Effect.result(kept.kept);

          if (Result.isSuccess(written) && written.success.length === refused.kept().length) {
            if (sealed.refused !== undefined) yield* sealed.refused.imported;
          }

          yield* Effect.forkIn(
            Stream.runForEach(refused.moves, () => keep),
            scope,
          );
        });

      if (opened !== undefined) return [];
      account = accountId;
      const scope = yield* Scope.make();

      const connection = yield* Effect.result(
        openLocalDatabase(stateRoot, accountId).pipe(Scope.provide(scope)),
      );

      if (Result.isFailure(connection)) {
        yield* Scope.close(scope, Exit.void);
        yield* reported(LOCAL_DATABASE_REPORT.OPEN_FAILED, connection.failure);
        yield* refused.restored(accountId, sealed.refused?.entries ?? []);

        return sealed.queue?.entries ?? [];
      }

      yield* refusedOpened(localRefused(connection.success), scope);
      const outbox = localOutbox(connection.success);
      opened = { rows: localRows(connection.success), outbox, scope };

      // Note that an outbox that will not read back leaves its writes on disk for the next launch, and this one sends the sealed queue.
      const restored = yield* Effect.result(outbox.restored(sealed.queue?.entries));

      if (Result.isFailure(restored)) {
        yield* reported(LOCAL_DATABASE_REPORT.OUTBOX_UNREAD, restored.failure);

        return sealed.queue?.entries ?? [];
      }

      // Note that the file is told only once the import is committed, so it never drops a write the database does not hold.
      if (sealed.queue !== undefined) yield* sealed.queue.imported;

      return restored.success;
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
