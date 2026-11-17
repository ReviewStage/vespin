/**
 * local-copy.ts -- the signed-in account's local database as the sync engine's store: opened at sign-in, written as the pool answers and its writes wait, its waiting writes read back to be laid over the pool, and deleted at sign-out.
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
 * nothing for that sign-in and answers the sealed queue, so this launch
 * still sends it, and the failure is reported to Sentry by its tag and its
 * cause's kind, never by a row or a path, which is what the release's gate
 * reads.
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

/** What Sentry is told of a local database that would not open or be deleted. */
const LOCAL_DATABASE_REPORT = {
  OPEN_FAILED: "host.localDatabase.openFailed",
  OUTBOX_UNREAD: "host.localDatabase.outboxUnread",
  FORGET_FAILED: "host.localDatabase.forgetFailed",
} as const;

/** The agent messages the service refused, as the agents' composer hands them out (`compose-agents.ts`). */
export interface RefusedMessages {
  /** The signed-in account's, whole. */
  readonly kept: () => readonly unknown[];
  /** Each moving of them. */
  readonly moves: Stream.Stream<void>;
}

/** What `entities.sealed` held of the account's queues as it opened, read once for the database to import. */
export interface SealedQueues {
  /** The row writes an older build kept waiting there, oldest first. */
  readonly queue: readonly QueuedEntry[];
}

/** The account's database, from its sign-in until its sign-out. */
export interface LocalCopy {
  /** The pool's store for its life: the database open now, or nothing while none is. */
  readonly store: PoolStore;
  /**
   * Opens `accountId`'s database where none stands, its refused messages
   * kept as they move, and answers its waiting writes, oldest first,
   * `sealed.queue` imported once first; a failure is reported, leaves none
   * open, and answers `sealed.queue`. One standing already
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
      if (opened !== undefined) return [];
      account = accountId;
      const scope = yield* Scope.make();

      const connection = yield* Effect.result(
        openLocalDatabase(stateRoot, accountId).pipe(Scope.provide(scope)),
      );

      if (Result.isFailure(connection)) {
        yield* Scope.close(scope, Exit.void);
        yield* reported(LOCAL_DATABASE_REPORT.OPEN_FAILED, connection.failure);

        return sealed.queue;
      }

      const kept = localRefused(connection.success);
      const keep = Effect.suspend(() => kept.keep(refused.kept()));
      // Note that the messages are kept once as they stand, since they were laid back before the database opened.
      yield* keep;
      yield* Effect.forkIn(
        Stream.runForEach(refused.moves, () => keep),
        scope,
      );
      const outbox = localOutbox(connection.success);
      opened = { rows: localRows(connection.success), outbox, scope };

      // Note that an outbox that will not read back leaves its writes on disk for the next launch, and this one sends the sealed queue.
      return yield* outbox
        .restored(sealed.queue)
        .pipe(
          Effect.catch((failure) =>
            Effect.as(reported(LOCAL_DATABASE_REPORT.OUTBOX_UNREAD, failure), sealed.queue),
          ),
        );
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
