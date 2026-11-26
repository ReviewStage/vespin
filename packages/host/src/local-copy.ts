/**
 * local-copy.ts -- the signed-in account's local database as the sync engine's store: opened at sign-in, written as the pool answers and its writes wait, read back as each kept read first stands and as its waiting writes and refused agent messages are laid over the pool, and deleted at sign-out.
 *
 * The pool is handed one store for its life (`PoolOptions.store`), which
 * forwards to the database open now and does nothing while none is, so a
 * sign-in opens it without rebuilding the pool. Its kept reads' answers go
 * to `localRows`, its waiting writes to `localOutbox`, and the agent
 * messages the service refused to `localRefused`, each move written whole.
 *
 * Each kept read draws from it as it first stands (`loaded`), before the
 * service answers, as Linear's local bootstrap does, and its follow reads
 * past the cursor it kept; a read stood while none is open loads nothing.
 *
 * The outbox is the only place waiting writes are kept: an open answers
 * them oldest first, for the caller to lay back over the pool (`requeue`)
 * before any read draws. A database that will not open leaves the store
 * doing nothing for that sign-in, which runs in memory, and the failure is
 * reported to Sentry by its tag and its cause's kind, never by a row or a
 * path, which is what the release's gate reads.
 *
 * The `refused` table is likewise the only place the agent messages the
 * service refused are kept: an open lays back what it holds, and keeps them
 * as they move. Where the database will not open, or its table will not
 * read, none are laid back and they are kept in memory for that launch
 * alone, as the waiting writes are.
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
import { Effect, Exit, type Path, Result, Scope, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { type KeptWords, keptWordsInMemory } from "./kept-words.js";
import {
  forgetLocalDatabase,
  LocalDatabaseDriver,
  type LocalDatabaseFailed,
  openKeptCollections,
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

/** The account's database, from its sign-in until its sign-out. */
export interface LocalCopy {
  /** The pool's store for its life: the database open now, or nothing while none is. */
  readonly store: PoolStore;
  /**
   * Opens `accountId`'s database where none stands, its refused messages
   * laid back from it and kept as they move, and answers its waiting
   * writes, oldest first; a failure is reported, leaves none open, and
   * answers none. One standing already answers none, since its writes were
   * laid back as it opened.
   */
  readonly open: (
    accountId: string,
    refused: RefusedMessages,
  ) => Effect.Effect<readonly QueuedEntry[]>;
  /** Closes the database and deletes the folder of the account it was last opened for, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
  /** Whether the platform keeps collections on disk beside the database (`LocalDatabaseDriverSeam.collections`), as the iPhone does, which keeps the Inbox lean. */
  readonly keepsCollections: boolean;
  /** The words the kept Inbox messages say, in the database open now, or in memory while none keeps them. */
  readonly words: KeptWords;
}

/** The stores over one open database, and the scope it closes with. */
interface Opened {
  readonly rows: RowsStore;
  readonly outbox: OutboxStore;
  /** The database the stored kinds' collections are kept in beside it, where the platform keeps one and it opened. */
  readonly collections: CollectionsStore | undefined;
  /** The words its kept messages say, beside the collections where they opened, else in memory. */
  readonly words: KeptWords;
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
  const keepsCollections = (yield* LocalDatabaseDriver).collections !== undefined;
  let opened: Opened | undefined;
  /** The words kept while no database is open, which a sign-out lets go. */
  let unopenedWords = keptWordsInMemory();
  /** The account the last open was for, whose folder a sign-out deletes even where it would not open. */
  let account: string | undefined;

  const close = Effect.suspend(() => {
    const standing = opened;
    opened = undefined;

    return standing === undefined ? Effect.void : Scope.close(standing.scope, Exit.void);
  });

  yield* Effect.addFinalizer(() => close);

  const store: PoolStore = {
    outbox: {
      added: (entry: QueuedEntry) => opened?.outbox.added(entry) ?? Effect.void,
      removed: (entry: QueuedEntry) => opened?.outbox.removed(entry) ?? Effect.void,
    },
    rows: {
      answered: (answer: KeptAnswer) => opened?.rows.answered(answer) ?? Effect.void,
      loaded: (name) => opened?.rows.loaded(name) ?? Effect.undefined,
    },
    collections: () => opened?.collections,
  };

  /** Note that each call is handed to the words open as it runs, so a sign-in opens them without the follow or a search being handed them anew. */
  const wordsNow = () => opened?.words ?? unopenedWords;

  const words: KeptWords = {
    replaced: (rows) => wordsNow().replaced(rows),
    moved: (rows, gone) => wordsNow().moved(rows, gone),
    threadsSaying: (tokens) => wordsNow().threadsSaying(tokens),
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

      const connection = yield* Effect.result(
        openLocalDatabase(stateRoot, accountId).pipe(Scope.provide(scope)),
      );

      if (Result.isFailure(connection)) {
        yield* Scope.close(scope, Exit.void);
        yield* reported(LOCAL_DATABASE_REPORT.OPEN_FAILED, connection.failure);

        return [];
      }

      yield* refusedOpened(localRefused(connection.success), scope);
      const outbox = localOutbox(connection.success);

      // Note that a database of kept collections that will not open leaves each stored kind in memory for that sign-in, as it is where the platform keeps none.
      const kept = yield* Effect.result(
        openKeptCollections(stateRoot, accountId).pipe(Scope.provide(scope)),
      );

      if (Result.isFailure(kept))
        yield* reported(LOCAL_DATABASE_REPORT.COLLECTIONS_FAILED, kept.failure);
      const keep = Result.isSuccess(kept) ? kept.success : undefined;

      opened = {
        rows: localRows(connection.success),
        outbox,
        collections: keep === undefined ? undefined : { keep: keep.keep, scope },
        words: keep?.words ?? keptWordsInMemory(),
        scope,
      };

      // Note that an outbox that will not read back leaves its writes on disk for the next launch.
      const restored = yield* Effect.result(outbox.restored);

      if (Result.isFailure(restored)) {
        yield* reported(LOCAL_DATABASE_REPORT.OUTBOX_UNREAD, restored.failure);

        return [];
      }

      return restored.success;
    }).pipe(Effect.provideContext(context));

  const forget = Effect.gen(function* () {
    yield* close;
    unopenedWords = keptWordsInMemory();
    const forgotten = account;
    account = undefined;

    if (forgotten === undefined) return;

    yield* forgetLocalDatabase(stateRoot, forgotten).pipe(
      Effect.catch((failure) => reported(LOCAL_DATABASE_REPORT.FORGET_FAILED, failure)),
    );
  }).pipe(Effect.provideContext(context));

  return { store, open, forget, keepsCollections, words } satisfies LocalCopy;
});
