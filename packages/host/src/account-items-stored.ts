/**
 * account-items-stored.ts -- the account's inbox items followed into the pool's Inbox kind where its rows are kept on disk whole: each answer written to the account's database as it lands, read past the sync id kept beside them, and aged out there by the clock, with no item held whole in memory.
 *
 * Where the account's database keeps the Inbox kind (`HeldRows.onDisk`), as
 * the iPhone's does, the screens read its rows through live queries over the
 * kind's collection, which load from the database only what each asks for,
 * so the follow neither holds every item nor tells them on the document.
 * It answers every row of the kind (`PoolRead.owns`): a whole answer
 * replaces what the database keeps, an answer past a sync id upserts the
 * items it carries, each on the task its stamp names, and deletes those that
 * stand no longer for the account (`gone`); the sync id rides beside them in
 * the same transaction, so a launch, and an attempt started again after a
 * refusal or a follow that stopped, always reads past it, the database
 * keeping every item it was answered. An item settled before the read's
 * window leaves it by the clock, which no answer says, so after each
 * standing and each answer the follow asks the database for those alone,
 * through a query whose filter runs in SQLite, and deletes them.
 *
 * The document is told only where the feed stands, its rows always none,
 * and beside them the tasks the kept items stand on (`keptHolders`), so a
 * screen groups the kept items under them before the task list is drawn.
 * They are kept beside the sync id, the latest changed first, up to
 * `KEPT_HOLDERS`, each the task list's summary where it holds one and the
 * one kept before where it does not yet.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  type AccountInboxItemsLiveAnswer,
  type AccountInboxItemsLiveRows,
  INBOX_ITEMS_READ,
  inboxOfLiveRows,
} from "@repo/features/inbox-live";
import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { liveRowsInSlices } from "@repo/features/live-read";
import { ACCOUNT_INBOX_ITEMS } from "@repo/features/live-wire";
import { type TaskSummary, taskSummarySchema } from "@repo/features/task-wire";
import { failureKind, reportUnexpected } from "@repo/runtime/effect";
import type { EntityPool, HeldRows } from "@repo/sync";
import {
  and,
  createLiveQueryCollection,
  eq,
  inArray,
  isUndefined,
  lt,
  not,
  or,
} from "@tanstack/db";
import { Clock, Effect, Option, Schema, type Scope } from "effect";
import type { AppInboxItems, AppInboxRead } from "./app-state.js";
import {
  INBOX_THREAD,
  type InboxChange,
  type PlacedInboxRow,
  placedRow,
} from "./inbox-collections.js";
import { INBOX_MESSAGE, type ThreadMessage, threadMessagesOf } from "./inbox-messages.js";
import { type KeptWords, messageWordsOf } from "./kept-words.js";
import {
  followTakingRows,
  type LiveFailure,
  type SyncStanding,
  syncIdOf,
  type TxWait,
} from "./live-follow.js";

/** The most tasks kept beside the items, the latest changed first, as the eager follow keeps them. */
const KEPT_HOLDERS = 250;

/** No item told on the document, whose rows a screen reads from the kind's collection instead. */
const NO_ITEMS: AppInboxItems = { [INBOX_SCOPE_KIND.TASK]: {} };

/** The items read's rows decoded a slice at a time, since a busy account's whole Inbox runs to tens of thousands of rows (`liveRowsInSlices`). */
const INBOX_ITEMS_ROWS = liveRowsInSlices(INBOX_ITEMS_READ.parts);

/**
 * What the database keeps beside the items, as the read's cursor: the sync
 * id they were read at, and the tasks they stand on with when an item on
 * each last changed.
 */
const storedCursorSchema = Schema.Struct({
  at: Schema.optionalKey(Schema.String),
  // Note that each holder is decoded alone (`holdersOf`), so one a build no longer reads leaves out that task rather than the cursor.
  holders: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  holderAt: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
});

type StoredCursor = typeof storedCursorSchema.Type;

const decodeCursor = Schema.decodeUnknownOption(storedCursorSchema);

const decodeHolder = Schema.decodeUnknownOption(taskSummarySchema);

/** The tasks kept beside the items, by id, each with when an item on it last changed. */
interface Holders {
  readonly summaries: ReadonlyMap<string, TaskSummary>;
  readonly at: ReadonlyMap<string, number>;
}

/** The holders `cursor` kept that this build reads. */
function holdersOf(cursor: StoredCursor | undefined): Holders {
  const summaries = (cursor?.holders ?? []).flatMap((holder) =>
    Option.toArray(decodeHolder(holder)),
  );

  return {
    summaries: new Map(summaries.map((task) => [task.id, task])),
    at: new Map(Object.entries(cursor?.holderAt ?? {})),
  };
}

/**
 * The holders once `items` landed: each task one of them stands on, at the
 * latest it or the one kept changed, summed up as the task list sums it now
 * (`listed`) or as it was kept; the latest changed first, up to
 * `KEPT_HOLDERS`.
 */
function holdersAfter(
  holders: Holders,
  items: readonly PlacedInboxRow[],
  listed: (taskIds: readonly string[]) => readonly TaskSummary[],
): Holders {
  const at = new Map(holders.at);

  for (const item of items) {
    if (item.taskId !== null)
      at.set(item.taskId, Math.max(at.get(item.taskId) ?? 0, item.updatedAt));
  }

  const latest = [...at]
    .sort(([, one], [, other]) => other - one)
    .slice(0, KEPT_HOLDERS)
    .map(([taskId]) => taskId);

  const summaries = new Map([
    ...holders.summaries,
    ...listed(latest).map((task) => [task.id, task] as const),
  ]);

  const kept = latest.flatMap((taskId) => {
    const summary = summaries.get(taskId);

    return summary === undefined ? [] : [[taskId, summary] as const];
  });

  return {
    summaries: new Map(kept),
    at: new Map(kept.map(([taskId]) => [taskId, at.get(taskId) ?? 0])),
  };
}

/** The cursor that keeps `holders` beside the sync id `standing` names, where it names one. */
function cursorOf(holders: Holders, standing: SyncStanding | undefined): StoredCursor {
  const kept = {
    holders: [...holders.summaries.values()],
    holderAt: Object.fromEntries(holders.at),
  };

  return standing === undefined ? kept : { at: standing.next, ...kept };
}

/** Each item an answer carries that its stamps place, whole, with the task its stamp names. */
function placedOf(rows: AccountInboxItemsLiveRows): readonly PlacedItem[] {
  const taskOf = new Map(rows.stamps.map((stamp) => [stamp.id, stamp.taskId]));

  return inboxOfLiveRows(rows).flatMap((item) => {
    const taskId = taskOf.get(item.id);

    return taskId === undefined ? [] : [{ item, taskId }];
  });
}

/** An item an answer carries, whole, and the task it stands on, from which its lean row and its messages are each written. */
interface PlacedItem {
  readonly item: InboxItem;
  readonly taskId: string | null;
}

/** Every message of the items placed, each a row of the message kind. */
function messagesOf(placed: readonly PlacedItem[]): readonly ThreadMessage[] {
  return placed.flatMap(({ item }) => threadMessagesOf(item));
}

/** The lean row of each item placed, its digest taken from its thread whole. */
function rowsOf(placed: readonly PlacedItem[]): readonly PlacedInboxRow[] {
  return placed.map(({ item, taskId }) => placedRow(item, taskId));
}

/**
 * The ids of every item the kind's collection keeps that settled before the
 * read's window at `now`, as the eager follow's `withinWindow` drops them:
 * one no longer open that last changed, settled, and came due before it.
 * Note that the filter runs in SQLite, so only those items are read.
 */
function agedIds(pool: EntityPool, now: number): Effect.Effect<readonly string[]> {
  const before = now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS;

  return Effect.flatMap(pool.collection(INBOX_THREAD), (collection) =>
    Effect.promise(async () => {
      const aged = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: collection })
            .where(({ item }) =>
              and(
                not(eq(item.status, INBOX_STATUS.OPEN)),
                lt(item.updatedAt, before),
                or(isUndefined(item.settledAt), lt(item.settledAt, before)),
                or(isUndefined(item.remindAt), lt(item.remindAt, before)),
              ),
            )
            .select(({ item }) => ({ id: item.id })),
        startSync: true,
        gcTime: 0,
      });

      try {
        await aged.preload();

        return aged.toArray.map((row) => row.id);
      } finally {
        await aged.cleanup();
      }
    }),
  );
}

/** The ids of every message the message kind keeps on the threads `threadIds` names; none where it names none. Note that the filter runs in SQLite, so only those threads' messages are read. */
function threadMessageIds(
  pool: EntityPool,
  threadIds: readonly string[],
): Effect.Effect<ReadonlySet<string>> {
  if (threadIds.length === 0) return Effect.succeed(new Set());

  return Effect.flatMap(pool.collection(INBOX_MESSAGE), (collection) =>
    Effect.promise(async () => {
      const kept = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ message: collection })
            .where(({ message }) => inArray(message.threadId, [...threadIds]))
            .select(({ message }) => ({ id: message.id })),
        startSync: true,
        gcTime: 0,
      });

      try {
        await kept.preload();

        return new Set(kept.toArray.map((row) => row.id));
      } finally {
        await kept.cleanup();
      }
    }),
  );
}

/**
 * The messages an answer moves: every message of each item it carries, and
 * the ids of those kept on these items, or on those `gone`, that it no
 * longer carries, since an item that moves comes whole, its latest messages
 * among it, and one gone takes its thread with it.
 */
function movedMessages(
  pool: EntityPool,
  placed: readonly PlacedItem[],
  gone: readonly string[],
): Effect.Effect<{ readonly rows: readonly ThreadMessage[]; readonly gone: readonly string[] }> {
  const rows = messagesOf(placed);
  const carried = new Set(rows.map((row) => row.id));

  return Effect.map(
    threadMessageIds(pool, [...placed.map(({ item }) => item.id), ...gone]),
    (kept) => ({ rows, gone: [...kept].filter((id) => !carried.has(id)) }),
  );
}

/** What Sentry is told of the words a search reads that would not be written. */
const KEPT_WORDS_REPORT = "host.keptWords.writeFailed";

/** `write` of the words a search reads, waited on; a failure is reported by its kind alone and leaves the follow going, since a search that misses a message's words is all it costs. */
function wordsWritten(write: Promise<void>): Effect.Effect<void> {
  return Effect.tryPromise({ try: () => write, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => reportUnexpected(KEPT_WORDS_REPORT, { cause: failureKind(cause) })),
  );
}

/** What the stored follow is handed. */
export interface StoredItemsFollow {
  /** The account's items read past the sync id named, whole where it is empty; a failure where the service answered none. */
  readonly seal: (
    sync: string | undefined,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | LiveFailure>;
  readonly pool: EntityPool;
  /** The items the follow stands on, kept on disk whole. */
  readonly items: HeldRows<PlacedInboxRow, InboxChange>;
  /** Stands the follow on each message of their threads, kept on disk whole beside them, which a thread reads as it opens; stood only once the kept Inbox is told, since no first draw reads a message. */
  readonly messages: Effect.Effect<HeldRows<ThreadMessage, never>, never, Scope.Scope>;
  /** The words each of those messages says, which a search reads, written as the messages are. */
  readonly words: KeptWords;
  /** The task list's summaries of the tasks named, of those it holds now. */
  readonly tasksListed: (taskIds: readonly string[]) => readonly TaskSummary[];
  /** Hears the read's wait for a write's transaction once the follow hands one. */
  readonly onTxWait: (wait: TxWait | undefined) => void;
  /** Hears each answer's decoded rows and the read they came in, as the eager follow counts what decoding dropped. */
  readonly decoded: (rows: AccountInboxItemsLiveRows, read: AccountInboxItemsLiveAnswer) => void;
  readonly tell: (read: AppInboxRead) => Effect.Effect<void>;
}

/**
 * One attempt of the account's items followed into the database the Inbox
 * kind is kept in: its kept cursor told and read past, each answer written
 * there and the aged items deleted, until the follow stops. Answers whether
 * the read was answered at all, false where the service refused its first.
 */
export function followStoredItems(
  follow: StoredItemsFollow,
): Effect.Effect<boolean, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { items, pool } = follow;
    const kept = items.loaded ? Option.getOrUndefined(decodeCursor(items.stored)) : undefined;
    let holders = holdersOf(kept);

    const told = (keptOnly: boolean) =>
      follow.tell({
        rows: NO_ITEMS,
        stored: true,
        ...(keptOnly ? { kept: true } : undefined),
        ...(holders.summaries.size === 0
          ? undefined
          : { keptHolders: [...holders.summaries.values()] }),
      });

    /** Deletes every item kept that settled before the read's window now, but one a write stands over, which draws over it until it lands. */
    const agedOut = Effect.gen(function* () {
      /** Of `ids`, those still aged and no write stands over now, read again after each wait, since a write asked meanwhile draws over its item until it lands, and one taken in place reopens it in its row. */
      const stillAged = (ids: readonly string[] | undefined) =>
        Effect.gen(function* () {
          const found = yield* agedIds(pool, yield* Clock.currentTimeMillis);
          const asked = ids === undefined ? undefined : new Set(ids);
          const pending = pool.standing(INBOX_THREAD)?.pending;

          return found.filter((id) => asked?.has(id) !== false && pending?.has(id) !== true);
        });

      const aged = yield* stillAged(undefined);

      if (aged.length === 0) return;
      // Note that an item's words and messages go before it, so a launch never finds an item kept whose thread is gone, and one cut short deletes the rest again; one reopened between the two is answered again with its thread whole, which writes both back.
      yield* wordsWritten(follow.words.rewritten(aged, []));
      const left = yield* threadMessageIds(pool, yield* stillAged(aged));

      if (left.size > 0) yield* messages.answer([], { gone: [...left] });
      const gone = yield* stillAged(aged);

      if (gone.length > 0) yield* items.answer([], { gone });
    });

    // Note that a database that kept the items is told at once, so a launch draws the kept Inbox before the read answers, and before the messages' collection is made, which no first draw reads.
    if (kept !== undefined) yield* told(true);
    const messages = yield* follow.messages;
    yield* agedOut;

    const first = yield* follow.seal(kept?.at ?? "");

    if ("failure" in first) return false;

    const landed = (rows: AccountInboxItemsLiveRows, standing: SyncStanding | undefined) =>
      Effect.gen(function* () {
        const placed = placedOf(rows);
        const threads = rowsOf(placed);
        holders = holdersAfter(holders, threads, follow.tasksListed);
        const at = syncIdOf(standing);
        const cursor = cursorOf(holders, standing);

        const whole = standing?.past === undefined;

        // Note that the messages are written before the items and the sync id beside them, so a launch cut short between the two reads past an older id and writes them again, never past messages it lacks.
        const said = placed.flatMap(({ item }) => messageWordsOf(item));

        if (whole) {
          yield* messages.answer(messagesOf(placed));
          yield* wordsWritten(follow.words.replaced(said));
        } else {
          const moved = yield* movedMessages(pool, placed, standing.gone);
          yield* messages.answer(moved.rows, { gone: moved.gone });
          yield* wordsWritten(
            follow.words.rewritten([...placed.map(({ item }) => item.id), ...standing.gone], said),
          );
        }

        // Note that a whole answer names every item there is, so it replaces what the database keeps; one past a sync id names only what moved, and what stands no longer.
        yield* whole
          ? items.answer(threads, { ...(at === undefined ? undefined : { at }), cursor })
          : items.answer(threads, {
              gone: standing.gone,
              ...(at === undefined ? undefined : { at }),
              cursor,
            });

        yield* agedOut;
        yield* told(false);
      });

    yield* followTakingRows(
      { poll: (_after, _cursor, sync) => follow.seal(sync), onTxWait: follow.onTxWait },
      first,
      INBOX_ITEMS_ROWS,
      (rows, standing, read) => {
        follow.decoded(rows, read);

        return landed(rows, standing);
      },
    ).pipe(Effect.catch(() => Effect.void));

    return true;
  });
}
