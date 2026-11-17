/**
 * local-copy.ts -- the signed-in account's local database as the sync engine's store: opened at sign-in, written as the pool answers and its writes wait, read back as each kept read first stands, and deleted at sign-out.
 *
 * This is the shadow release of the local database (`local-database.ts`).
 * The pool is handed one store for its life (`PoolOptions.store`), which
 * forwards to the database open now and does nothing while none is, so a
 * sign-in opens it without rebuilding the pool. Its kept reads' answers go
 * to `localRows`, its waiting writes to `localOutbox`, and the agent
 * messages the service refused to `localRefused`, each move written whole.
 *
 * Each kept read draws from it as it first stands (`loaded`), before the
 * service answers, as Linear's local bootstrap does, and its follow reads
 * past the cursor it kept; a read stood while none is open loads nothing.
 * The queues are still laid back from `entities.sealed`. A database that
 * will not open leaves the store doing nothing for that sign-in, and the failure is reported to Sentry by its
 * tag and its cause's kind, never by a row or a path, which is what the
 * release's gate reads.
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
import { localOutbox, localRefused } from "./local-queues.js";
import { localRows } from "./local-rows.js";

/** What Sentry is told of a local database that would not open or be deleted. */
const LOCAL_DATABASE_REPORT = {
  OPEN_FAILED: "host.localDatabase.openFailed",
  FORGET_FAILED: "host.localDatabase.forgetFailed",
} as const;

/** The agent messages the service refused, as the agents' composer hands them out (`compose-agents.ts`). */
export interface RefusedMessages {
  /** The signed-in account's, whole. */
  readonly kept: () => readonly unknown[];
  /** Each moving of them. */
  readonly moves: Stream.Stream<void>;
}

/** The account's database, from its sign-in until its sign-out. */
export interface LocalCopy {
  /** The pool's store for its life: the database open now, or nothing while none is. */
  readonly store: PoolStore;
  /** Opens `accountId`'s database where none stands, its refused messages kept as they move; a failure is reported and leaves none open. */
  readonly open: (accountId: string, refused: RefusedMessages) => Effect.Effect<void>;
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
function reported(kind: string, failure: LocalDatabaseFailed): Effect.Effect<void> {
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

  const store: PoolStore = {
    outbox: {
      added: (entry: QueuedEntry) => opened?.outbox.added(entry) ?? Effect.void,
      removed: (entry: QueuedEntry) => opened?.outbox.removed(entry) ?? Effect.void,
    },
    rows: {
      answered: (answer: KeptAnswer) => opened?.rows.answered(answer) ?? Effect.void,
      loaded: (name) => opened?.rows.loaded(name) ?? Effect.undefined,
    },
  };

  const open = (accountId: string, refused: RefusedMessages) =>
    Effect.gen(function* () {
      if (opened !== undefined) return;
      account = accountId;
      const scope = yield* Scope.make();

      const connection = yield* Effect.result(
        openLocalDatabase(stateRoot, accountId).pipe(Scope.provide(scope)),
      );

      if (Result.isFailure(connection)) {
        yield* Scope.close(scope, Exit.void);

        return yield* reported(LOCAL_DATABASE_REPORT.OPEN_FAILED, connection.failure);
      }

      const kept = localRefused(connection.success);
      const keep = Effect.suspend(() => kept.keep(refused.kept()));
      // Note that the messages are kept once as they stand, since they were laid back before the database opened.
      yield* keep;
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
