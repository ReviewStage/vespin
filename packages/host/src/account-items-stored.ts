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
 * the same transaction, so a launch always reads past it, the database
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
import { INBOX_STATUS } from "@repo/features/inbox-wire";
import { ACCOUNT_INBOX_ITEMS } from "@repo/features/live-wire";
import { type TaskSummary, taskSummarySchema } from "@repo/features/task-wire";
import type { EntityPool, HeldRows } from "@repo/sync";
import { and, createLiveQueryCollection, eq, isUndefined, lt, not, or } from "@tanstack/db";
import { Clock, Effect, Option, Schema } from "effect";
import type { AppInboxItems, AppInboxRead } from "./app-state.js";
import {
  INBOX_ITEM,
  type InboxChange,
  type PlacedInboxItem,
  placedItem,
} from "./inbox-collections.js";
import {
  followTakingRows,
  type LiveFailure,
  type PagedRows,
  type SyncStanding,
  syncIdOf,
  type TxWait,
} from "./live-follow.js";

/** The most tasks kept beside the items, the latest changed first, as the eager follow keeps them. */
const KEPT_HOLDERS = 250;

/**
 * How the account's items take a whole answer in pages (`followTakingRows`),
 * the stored follow's and the eager one's alike: each row's key, an item's
 * by its stamp too, since one a page carries unchanged since the read's
 * `since` comes as its stamp alone, and two pages' rows as one.
 */
export const ACCOUNT_ITEMS_PAGES: PagedRows<AccountInboxItemsLiveRows> = {
  keysOf: (rows) => [...rows.stamps, ...rows.items].map((row) => row.id),
  join: (held, page) => ({
    stamps: [...held.stamps, ...page.stamps],
    items: [...held.items, ...page.items],
    messages: [...held.messages, ...page.messages],
    files: [...held.files, ...page.files],
  }),
};

/** No item told on the document, whose rows a screen reads from the kind's collection instead. */
const NO_ITEMS: AppInboxItems = { [INBOX_SCOPE_KIND.TASK]: {} };

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
  items: readonly PlacedInboxItem[],
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

/** Each item an answer carries that its stamps place, on the task its stamp names. */
function placedOf(rows: AccountInboxItemsLiveRows): readonly PlacedInboxItem[] {
  const taskOf = new Map(rows.stamps.map((stamp) => [stamp.id, stamp.taskId]));

  return inboxOfLiveRows(rows).flatMap((item) => {
    const taskId = taskOf.get(item.id);

    return taskId === undefined ? [] : [placedItem(item, taskId)];
  });
}

/**
 * The ids of every item the kind's collection keeps that settled before the
 * read's window at `now`, as the eager follow's `withinWindow` drops them:
 * one no longer open that last changed, settled, and came due before it.
 * Note that the filter runs in SQLite, so only those items are read.
 */
function agedIds(pool: EntityPool, now: number): Effect.Effect<readonly string[]> {
  const before = now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS;

  return Effect.flatMap(pool.collection(INBOX_ITEM), (collection) =>
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

/** What the stored follow is handed. */
export interface StoredItemsFollow {
  /** The account's items read past the sync id named, whole where it is empty, or the page of a whole answer named; a failure where the service answered none. */
  readonly seal: (
    sync: string | undefined,
    page?: string,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | LiveFailure>;
  readonly pool: EntityPool;
  /** The items the follow stands on, kept on disk whole. */
  readonly items: HeldRows<PlacedInboxItem, InboxChange>;
  /** Whether this attempt may read past the sync id kept, as the first of a follow's does. */
  readonly resumes: boolean;
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
export function followStoredItems(follow: StoredItemsFollow): Effect.Effect<boolean> {
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
      const found = yield* agedIds(pool, yield* Clock.currentTimeMillis);
      const pending = pool.standing(INBOX_ITEM)?.pending;
      const aged = found.filter((id) => pending?.has(id) !== true);

      if (aged.length > 0) yield* items.answer([], { gone: aged });
    });

    // Note that a database that kept the items is told at once, so a launch draws the kept Inbox before the read answers.
    if (kept !== undefined) yield* told(true);
    yield* agedOut;

    const first = yield* follow.seal(follow.resumes ? (kept?.at ?? "") : "");

    if ("failure" in first) return false;
    /** The first page of a whole answer in pages, written ahead so its newest items draw, held until the last replaces what the database keeps with every page; none between whole answers in pages. */
    let firstPage: readonly PlacedInboxItem[] = [];

    const landed = (rows: AccountInboxItemsLiveRows, standing: SyncStanding | undefined) =>
      Effect.gen(function* () {
        const placed = placedOf(rows);
        holders = holdersAfter(holders, placed, follow.tasksListed);
        const at = syncIdOf(standing);
        const cursor = cursorOf(holders, standing);
        // Note that the last page of a whole answer in pages comes with every other page but the first (`followTakingRows`), so with the first it names every item there is, as one whole answer does, and replaces what the database keeps, which a store that cannot list its keys lets go no other way.
        const lastPage = standing?.paged === true && standing.carried !== undefined;
        const whole = standing?.past === undefined || lastPage;
        const written = lastPage ? [...firstPage, ...placed] : placed;
        firstPage = standing?.paged === true && !lastPage ? placed : [];

        // Note that a whole answer names every item there is, so it replaces what the database keeps; one past a sync id names only what moved, and what stands no longer.
        yield* whole
          ? items.answer(written, { ...(at === undefined ? undefined : { at }), cursor })
          : items.answer(written, {
              gone: standing.gone,
              ...(at === undefined ? undefined : { at }),
              cursor,
            });

        yield* agedOut;
        yield* told(false);
      });

    yield* followTakingRows(
      {
        poll: (_after, _cursor, sync, page) => follow.seal(sync, page),
        pages: ACCOUNT_ITEMS_PAGES,
        onTxWait: follow.onTxWait,
      },
      first,
      INBOX_ITEMS_READ.rows,
      (rows, standing, read) => {
        follow.decoded(rows, read);

        return landed(rows, standing);
      },
    ).pipe(Effect.catch(() => Effect.void));

    return true;
  });
}
