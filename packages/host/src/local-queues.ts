/**
 * local-queues.ts -- the account's two durable queues in its local database: the pool's waiting writes (`outbox`) and the agent messages the service refused (`refused`), each committed as it moves and read back at launch.
 *
 * The outbox is the pool's `OutboxStore`, kept as Linear's sync engine
 * keeps `__transactions`: a write that may wait is inserted, a committed
 * statement, before the pool first sends it, and deleted as it stands
 * down, so the disk holds what the pool holds and nothing saves the queue
 * from memory. A launch reads it back oldest first, to lay it back over
 * the pool (`requeue`).
 *
 * The refused messages are kept in the form `agent-queue-writes.ts` hands
 * them out (`refusedKept`): each time that record moves, the entries it no
 * longer holds are deleted and the ones it gained are inserted, in one
 * transaction, so a move costs what moved. A launch reads them back in the
 * order they were kept (`refusedRestored`).
 *
 * The pool runs on without its store, so a failed write is logged and
 * left; a failed read answers `LocalQueueReadFailed`, so the caller runs
 * in memory instead.
 */

import type { OutboxStore, QueuedEntry } from "@repo/sync";
import { Data, Effect, Schema } from "effect";
import type { LocalDatabaseConnection } from "./local-database.js";

/** The tables a read of the queues may fail on. */
export const LOCAL_QUEUE = {
  OUTBOX: "outbox",
  REFUSED: "refused",
} as const;

export type LocalQueue = (typeof LOCAL_QUEUE)[keyof typeof LOCAL_QUEUE];

/** A queue in the local database would not read back: its SQL failed, or an entry is no JSON. */
export class LocalQueueReadFailed extends Data.TaggedError("LocalQueueReadFailed")<{
  readonly queue: LocalQueue;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `The local database's ${this.queue} would not read back.`;
  }
}

/** Runs `write` on the database, logging a failure by tag and the queue rather than failing, since the pool runs on without its store. */
function committed(queue: LocalQueue, write: () => void): Effect.Effect<void> {
  return Effect.try(write).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`the local ${queue} was not written: ${failure._tag}`),
    ),
  );
}

/** Runs `step` inside one immediate transaction, rolled back where it throws. */
function inTransaction(connection: LocalDatabaseConnection, step: () => void): void {
  connection.exec("BEGIN IMMEDIATE;");

  try {
    step();
    connection.exec("COMMIT;");
  } catch (cause) {
    connection.exec("ROLLBACK;");
    throw cause;
  }
}

/** An `outbox` row as the driver answers it, its input parsed from its JSON. */
const outboxRowSchema = Schema.Struct({
  name: Schema.String,
  idempotency_key: Schema.String,
  input: Schema.fromJsonString(Schema.Unknown),
});

/** A `refused` row as the driver answers it, its entry parsed from its JSON. */
const refusedRowSchema = Schema.Struct({ entry: Schema.fromJsonString(Schema.Unknown) });

/** A `refused` row's entry as its text, as a move compares it. */
const refusedTextSchema = Schema.Struct({ entry: Schema.String });

const decodeOutboxRows = Schema.decodeUnknownSync(Schema.Array(outboxRowSchema));
const decodeRefusedRows = Schema.decodeUnknownSync(Schema.Array(refusedRowSchema));
const decodeRefusedTexts = Schema.decodeUnknownSync(Schema.Array(refusedTextSchema));

/** The account's waiting writes in `connection`, as the pool reports them and a launch reads them back. */
export interface LocalOutbox extends OutboxStore {
  /** Every waiting write kept, oldest added first. */
  readonly restored: Effect.Effect<readonly QueuedEntry[], LocalQueueReadFailed>;
}

/** The account's refused agent messages in `connection`, in the form `agent-queue-writes.ts` hands them out. */
export interface LocalRefused {
  /** Keeps `entries` as the refused messages now, deleting those kept no more and inserting those new, in one transaction. */
  readonly keep: (entries: readonly unknown[]) => Effect.Effect<void>;
  /** Every refused message kept, in the order it was first kept. */
  readonly kept: Effect.Effect<readonly unknown[], LocalQueueReadFailed>;
}

/** The pool's outbox over the account's open database. */
export function localOutbox(connection: LocalDatabaseConnection): LocalOutbox {
  return {
    // Note that a key added again keeps its first place, because the pool sends its waiting writes in the order first asked.
    added: (entry) =>
      committed(LOCAL_QUEUE.OUTBOX, () =>
        connection
          .prepare("INSERT OR IGNORE INTO outbox (name, idempotency_key, input) VALUES (?, ?, ?)")
          .run(entry.name, entry.key, JSON.stringify(entry.input)),
      ),
    removed: (entry) =>
      committed(LOCAL_QUEUE.OUTBOX, () =>
        connection.prepare("DELETE FROM outbox WHERE idempotency_key = ?").run(entry.key),
      ),
    restored: Effect.try({
      try: () =>
        decodeOutboxRows(
          connection.prepare("SELECT name, idempotency_key, input FROM outbox ORDER BY seq").all(),
        ).map(({ name, idempotency_key, input }) => ({ name, key: idempotency_key, input })),
      catch: (cause) => new LocalQueueReadFailed({ queue: LOCAL_QUEUE.OUTBOX, cause }),
    }),
  };
}

/** The refused agent messages over the account's open database. */
export function localRefused(connection: LocalDatabaseConnection): LocalRefused {
  return {
    keep: (entries) =>
      committed(LOCAL_QUEUE.REFUSED, () =>
        inTransaction(connection, () => {
          const now = new Set(entries.map((entry) => JSON.stringify(entry)));

          const stored = new Set(
            decodeRefusedTexts(connection.prepare("SELECT entry FROM refused").all()).map(
              (row) => row.entry,
            ),
          );

          const deleted = connection.prepare("DELETE FROM refused WHERE entry = ?");
          const inserted = connection.prepare("INSERT INTO refused (entry) VALUES (?)");

          for (const entry of stored) if (!now.has(entry)) deleted.run(entry);

          for (const entry of now) if (!stored.has(entry)) inserted.run(entry);
        }),
      ),
    kept: Effect.try({
      try: () =>
        decodeRefusedRows(connection.prepare("SELECT entry FROM refused ORDER BY seq").all()).map(
          (row) => row.entry,
        ),
      catch: (cause) => new LocalQueueReadFailed({ queue: LOCAL_QUEUE.REFUSED, cause }),
    }),
  };
}
