/**
 * local-copy.ts -- the signed-in account's local store as the sync engine's store: opened at sign-in on the platform's backend, written as the pool answers and its writes wait, read back as each kept read first stands and as its waiting writes and refused agent messages are laid over the pool, and deleted at sign-out.
 *
 * The pool is handed one store for its life (`PoolOptions.store`), which
 * forwards to the store open now and does nothing while none is, so a
 * sign-in opens it without rebuilding the pool. The store stands on a
 * backend (`LocalStoreBackendSeam`): the account's SQLite database on the Mac
 * and the iPhone (`local-sqlite.ts`), whose kept reads' answers go to
 * `localRows`, its waiting writes to `localOutbox`, and the agent messages
 * the service refused to `localRefused`, each move written whole; and the
 * browser's IndexedDB in a tab (`apps/web`), which keeps the kept reads
 * alone, so a tab's waiting writes and refused messages stay in memory for
 * its life, as they did before it kept any store.
 *
 * Each kept read draws from it as it first stands (`loaded`), before the
 * service answers, as Linear's local bootstrap does, and its follow reads
 * past the cursor it kept; a read stood while none is open loads nothing.
 *
 * The outbox, where the backend keeps one, is the only place waiting writes
 * are kept: an open answers them oldest first, for the caller to lay back
 * over the pool (`requeue`) before any read draws. A store that will not
 * open leaves it doing nothing for that sign-in, which runs in memory, and
 * the failure is reported to Sentry by its tag and its cause's kind, never
 * by a row or a path, which is what the release's gate reads.
 *
 * The `refused` table is likewise the only place the agent messages the
 * service refused are kept: an open lays back what it holds, and keeps them
 * as they move. Where the store will not open, its table will not read, or
 * its backend keeps no queues, none are laid back and they are kept in
 * memory for that launch alone, as the waiting writes are.
 */

import { failureKind, reportUnexpected } from "@repo/runtime/effect";
import type {
  CollectionsStore,
  KeptAnswer,
  OutboxStore,
  PoolStore,
  QueuedEntry,
  RowsStore,
} from "@repo/sync";
import { Context, Effect, Exit, Result, Scope, Stream } from "effect";
import type { KeptCollectionsDatabase, LocalDatabaseFailed } from "./local-database.js";
import type { LocalOutbox, LocalQueueReadFailed, LocalRefused } from "./local-queues.js";

/** What Sentry is told of a local database that would not open, read a queue back, or be deleted. */
const LOCAL_DATABASE_REPORT = {
  OPEN_FAILED: "host.localDatabase.openFailed",
  COLLECTIONS_FAILED: "host.localDatabase.collectionsFailed",
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

/** The account's two durable queues, where its backend keeps them. */
export interface LocalQueues {
  readonly outbox: LocalOutbox;
  readonly refused: LocalRefused;
}

/** One account's store as its backend opened it, for as long as the scope it opened in stands. */
export interface LocalStoreOpened {
  /** The pool's kept reads. */
  readonly rows: RowsStore;
  /** The waiting writes and refused messages; none where the backend keeps them in memory, as a browser tab does. */
  readonly queues: LocalQueues | undefined;
  /** Opens the database of collections kept on disk whole beside it, in the caller's scope; none where the platform keeps every kind in memory. */
  readonly collections: Effect.Effect<
    KeptCollectionsDatabase["keep"] | undefined,
    LocalDatabaseFailed,
    Scope.Scope
  >;
}

/** Where the platform keeps the account's store: opened per account for as long as the caller's scope stands, and deleted at its sign-out. */
export interface LocalStoreBackendSeam {
  /** Opens `accountId`'s store, creating it where it stands not, or fails so the caller runs in memory. */
  readonly open: (
    accountId: string,
  ) => Effect.Effect<LocalStoreOpened, LocalDatabaseFailed, Scope.Scope>;
  /** Deletes `accountId`'s store, as a sign-out does; one that stands not is already forgotten. */
  readonly forget: (accountId: string) => Effect.Effect<void, LocalDatabaseFailed>;
  /** Whether the platform keeps collections on disk beside the store (`LocalDatabaseDriverSeam.collections`), as the iPhone does, which keeps the Inbox kind there. */
  readonly keepsCollections: boolean;
}

/**
 * The store a platform keeps other than over the SQLite driver
 * (`LocalDatabaseDriver`): the browser tab's IndexedDB. A host given
 * neither keeps no store and runs in memory.
 */
export class LocalStoreBackend extends Context.Service<LocalStoreBackend, LocalStoreBackendSeam>()(
  "@repo/host/LocalStoreBackend",
) {}

/** The account's store, from its sign-in until its sign-out. */
export interface LocalCopy {
  /** The pool's store for its life: the store open now, or nothing while none is. */
  readonly store: PoolStore;
  /**
   * Opens `accountId`'s store where none stands, its refused messages
   * laid back from it and kept as they move, and answers its waiting
   * writes, oldest first, where its backend keeps them; a failure is
   * reported, leaves none open, and answers none. One standing already
   * answers none, since its writes were laid back as it opened.
   */
  readonly open: (
    accountId: string,
    refused: RefusedMessages,
  ) => Effect.Effect<readonly QueuedEntry[]>;
  /** Closes the store and deletes the one of the account it was last opened for, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
  /** Whether the platform keeps collections on disk beside the store (`LocalStoreBackendSeam.keepsCollections`). */
  readonly keepsCollections: boolean;
}

/** The stores over one open store, and the scope it closes with. */
interface Opened {
  readonly rows: RowsStore;
  readonly outbox: OutboxStore | undefined;
  /** The database the stored kinds' collections are kept in beside it, where the platform keeps one and it opened. */
  readonly collections: CollectionsStore | undefined;
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
 * The local copy on `backend`, for as long as the caller's scope stands,
 * which closes a store still open.
 */
export const localCopy = Effect.fn("host/localCopy")(function* (backend: LocalStoreBackendSeam) {
  const { keepsCollections } = backend;
  let opened: Opened | undefined;
  /** The account the last open was for, whose store a sign-out deletes even where it would not open. */
  let account: string | undefined;

  const close = Effect.suspend(() => {
    const standing = opened;
    opened = undefined;

    return standing === undefined ? Effect.void : Scope.close(standing.scope, Exit.void);
  });

  yield* Effect.addFinalizer(() => close);

  const store: PoolStore = {
    outbox: {
      added: (entry: QueuedEntry) => opened?.outbox?.added(entry) ?? Effect.void,
      removed: (entry: QueuedEntry) => opened?.outbox?.removed(entry) ?? Effect.void,
    },
    rows: {
      answered: (answer: KeptAnswer) => opened?.rows.answered(answer) ?? Effect.void,
      loaded: (name) => opened?.rows.loaded(name) ?? Effect.undefined,
    },
    collections: () => opened?.collections,
  };

  const open = (accountId: string, refused: RefusedMessages) =>
    Effect.gen(function* () {
      /** The refused messages laid back from the table, and kept as they move. Note that a table that will not read is left as it stands. */
      const refusedOpened = (kept: LocalRefused, scope: Scope.Scope) =>
        Effect.gen(function* () {
          const stored = yield* Effect.result(kept.kept);

          if (Result.isFailure(stored)) {
            return yield* reported(LOCAL_DATABASE_REPORT.REFUSED_UNREAD, stored.failure);
          }

          yield* refused.restored(accountId, stored.success);
          const keep = Effect.suspend(() => kept.keep(refused.kept()));
          yield* keep;

          yield* Effect.forkIn(
            Stream.runForEach(refused.moves, () => keep),
            scope,
          );
        });

      if (opened !== undefined) return [];
      account = accountId;
      const scope = yield* Scope.make();

      const store = yield* Effect.result(backend.open(accountId).pipe(Scope.provide(scope)));

      if (Result.isFailure(store)) {
        yield* Scope.close(scope, Exit.void);
        yield* reported(LOCAL_DATABASE_REPORT.OPEN_FAILED, store.failure);

        return [];
      }

      const { rows, queues } = store.success;

      if (queues !== undefined) yield* refusedOpened(queues.refused, scope);

      // Note that a database of kept collections that will not open leaves each stored kind in memory for that sign-in, as it is where the platform keeps none.
      const kept = yield* Effect.result(store.success.collections.pipe(Scope.provide(scope)));

      if (Result.isFailure(kept))
        yield* reported(LOCAL_DATABASE_REPORT.COLLECTIONS_FAILED, kept.failure);
      const keep = Result.isSuccess(kept) ? kept.success : undefined;

      opened = {
        rows,
        outbox: queues?.outbox,
        collections: keep === undefined ? undefined : { keep, scope },
        scope,
      };

      if (queues === undefined) return [];

      // Note that an outbox that will not read back leaves its writes on disk for the next launch.
      const restored = yield* Effect.result(queues.outbox.restored);

      if (Result.isFailure(restored)) {
        yield* reported(LOCAL_DATABASE_REPORT.OUTBOX_UNREAD, restored.failure);

        return [];
      }

      return restored.success;
    });

  const forget = Effect.gen(function* () {
    yield* close;
    const forgotten = account;
    account = undefined;

    if (forgotten === undefined) return;

    yield* backend
      .forget(forgotten)
      .pipe(Effect.catch((failure) => reported(LOCAL_DATABASE_REPORT.FORGET_FAILED, failure)));
  });

  return { store, open, forget, keepsCollections } satisfies LocalCopy;
});
