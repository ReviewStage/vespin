/**
 * inbox-rows.ts -- the Inbox as the iPhone reads it where its items are kept on disk: one query, declared once, over the pool's kept collection and over the rows a member's writes draw, merged, and grouped as the document's holdings group them.
 *
 * Where the account's database keeps the Inbox kind whole
 * (`account-items-stored.ts`), the document tells no item, and a screen reads
 * them through a live query over the kind's collection, which loads from the
 * database only what its filter finds there. What reaches it by default is
 * what Open, Questions, and Reminders can list (`INBOX_REACH.ATTENTION`): an
 * item still open, one the reader has not read, and one they set a reminder
 * on, which is every item the badge, the widget, and the waiting marks
 * count; a settled thread the reader read is read only where a screen lists
 * every item, as All and search do (`INBOX_REACH.WHOLE`), or opens the one
 * thread it names (`thread`).
 *
 * A write a member asks stands over the rows in the pool, never in the
 * collection, since a TanStack transaction would hold back every answer its
 * collection is synced. So the same query runs over a second source, the
 * rows the writes standing draw, which the pool holds in one collection made
 * with the kind (`StandingRows.drawn`), and the two are
 * merged (`inboxRowsMerged`): every key a write stands over is taken from
 * the second, where its drawn row still matches, and left out where it no
 * longer does, as a settle leaves Open at once. Note that no library lays a
 * write layer of another's over a live query, which is why this is ours.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { InboxFields, InboxRow } from "@repo/features/inbox-digest";
import { inboxInOrder } from "@repo/features/inbox-live";
import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import {
  type ROW_GONE,
  type RowCollection,
  type RowKind,
  rowOf,
  type StandingRows,
} from "@repo/sync";
import { eq, type IR, isUndefined, not, or, type Ref } from "@tanstack/db";
import type { AppInboxItems } from "./app-state.js";
import {
  type InboxHoldings,
  type InboxItemsOf,
  inboxHoldingsWithOlder,
} from "./app-state-reads.js";
import { INBOX_THREAD, type PlacedInboxRow, threadRowOf } from "./inbox-collections.js";
import { INBOX_MESSAGE, type ThreadMessage } from "./inbox-messages.js";
import type { HeardWords } from "./kept-words.js";

export type { PlacedInboxRow } from "./inbox-collections.js";

export { type ThreadMessage, threadOfRows } from "./inbox-messages.js";

/** How much of the Inbox a screen reads: what Open, Questions, and Reminders can list, one agent's threads, or every item kept. */
export const INBOX_REACH = {
  ATTENTION: "attention",
  AGENT: "agent",
  WHOLE: "whole",
} as const;

/**
 * What a screen reads of the Inbox: what Open, Questions, and Reminders can
 * list, and the one thread it opens where it names one; every thread one
 * agent posted, as the line over its box counts them; or every item kept,
 * as All and search list them.
 */
export type InboxReach =
  | { readonly kind: typeof INBOX_REACH.ATTENTION; readonly thread?: string }
  | { readonly kind: typeof INBOX_REACH.AGENT; readonly agentId: string }
  | { readonly kind: typeof INBOX_REACH.WHOLE };

/** A reach short of every item, which a query filters by (`inboxRowsWhere`). */
export type InboxFilteredReach = Exclude<InboxReach, { readonly kind: typeof INBOX_REACH.WHOLE }>;

/** What Open, Questions, and Reminders can list, and no thread besides: what most screens read. */
export const INBOX_ATTENTION: InboxReach = { kind: INBOX_REACH.ATTENTION };

/** Every item kept, as All and search list them. */
export const INBOX_WHOLE: InboxReach = { kind: INBOX_REACH.WHOLE };

/** The holdings a screen counts and those it lists, as far as its reach reads. */
export interface InboxReachHoldings<Item extends InboxFields> {
  /** What every count, scope, badge, and widget reads: the feed's alone, at every reach. */
  readonly counted: InboxHoldings<Item>;
  /** What the screen draws: under All, the older items it read past the feed beside the feed's; for a thread opened by its id, its own older copy where the feed holds none; the very `counted` at any other reach. */
  readonly listed: InboxHoldings<Item>;
}

/** Each holder's items of `lists` that `kept` keeps, each as `asItem` makes it, the holders left with none dropped. */
function itemsKept<Item>(
  lists: Readonly<Record<string, readonly InboxItem[]>> | undefined,
  kept: (item: InboxItem) => boolean,
  asItem: (item: InboxItem) => Item,
): Record<string, readonly Item[]> {
  return Object.fromEntries(
    Object.entries(lists ?? {}).flatMap(([holder, items]) => {
      const left = items.filter(kept).map(asItem);

      return left.length === 0 ? [] : [[holder, left] as const];
    }),
  );
}

/** The older items a screen reading `reach` draws, each as `asItem` makes it: every one under All, the one thread a screen opens by its id, and none at any other reach. */
function olderAt<Item>(
  reach: InboxReach,
  older: AppInboxItems,
  asItem: (item: InboxItem) => Item,
): InboxItemsOf<Item> | undefined {
  const opened = reach.kind === INBOX_REACH.ATTENTION ? reach.thread : undefined;

  if (reach.kind !== INBOX_REACH.WHOLE && opened === undefined) return undefined;
  const kept = (item: InboxItem) => opened === undefined || item.id === opened;

  return {
    [INBOX_SCOPE_KIND.TASK]: itemsKept(older[INBOX_SCOPE_KIND.TASK], kept, asItem),
    agents: itemsKept(older.agents, kept, asItem),
  };
}

/**
 * The holdings a screen reading `reach` counts and lists, `live` the
 * feed's, the document's whole items or the phone's kept rows alike, and
 * `older` the items All read past the feed (`selectInboxOlder`), each laid
 * in as `asItem` makes it, so it stands as the feed's own do. Note that only
 * a read of every item, as All lists them, lists the older ones, but for the
 * one thread a screen opens by its id, which draws its own older copy, so a
 * thread on no task, a Manager's, that no task's inbox holds opens from All
 * as it is listed there; and none is ever counted, since an older item may
 * stand unread, and a count, a scope's pill, the badge, or the widget that
 * took one would ask for the reader's attention on a thread long settled.
 */
export function inboxHoldingsAt<
  Item extends InboxFields & Pick<InboxItem, "id" | "status" | "updatedAt">,
>(
  live: InboxHoldings<Item>,
  reach: InboxReach,
  older: AppInboxItems,
  asItem: (item: InboxItem) => Item,
): InboxReachHoldings<Item> {
  const drawn = olderAt(reach, older, asItem);
  const listed = drawn === undefined ? live : inboxHoldingsWithOlder(live, drawn);

  return { counted: live, listed };
}

/** The Inbox kind's rows as the screens read them where they are kept on disk, and the moving of them. */
export interface InboxRowsSource {
  /** The kind's collection and the rows the writes standing over it draw; none before the follow first stood on it. */
  readonly standing: () => StandingRows<PlacedInboxRow> | undefined;
  /** The collection each thread's messages are kept in, which a thread reads as it opens; none before the follow first stood on it. */
  readonly messages: () => RowCollection<ThreadMessage, string> | undefined;
  /** Hears each moving of the kind's collection or of the writes standing over it; answers how to stop hearing. */
  readonly watch: (heard: () => void) => () => void;
  /**
   * Each thread whose kept messages say any of `tokens`, each lowercased, with
   * those they say, found in SQLite off the JavaScript thread
   * (`KeptWords.threadsSaying`), so a row answers a search where its own
   * words and these hold every word typed (`InboxSearch`).
   */
  readonly threadsSaying: (
    tokens: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly string[]>>;
  /** Hears each write of the kept messages' words once it lands, so a search standing asks again; answers how to stop hearing. */
  readonly wordsMoved: (heard: () => void) => () => void;
}

/** The Inbox kind's rows over the pool `pool` names, its messages' words searched in `words`, the store the follow writes them to. */
export function inboxRowsSource(
  pool: {
    readonly standing: <Row extends object, Change>(
      kind: RowKind<Row, Change>,
    ) => StandingRows<Row> | undefined;
    readonly watch: (heard: () => void) => () => void;
  },
  words: HeardWords,
): InboxRowsSource {
  return {
    standing: () => pool.standing(INBOX_THREAD),
    messages: () => pool.standing(INBOX_MESSAGE)?.collection,
    watch: pool.watch,
    threadsSaying: words.threadsSaying,
    wordsMoved: words.heard,
  };
}

/** The filter a thread's query reads its messages by: those on the thread `threadId` names, run in SQLite. */
export function threadMessagesWhere(
  message: Ref<ThreadMessage>,
  threadId: string,
): IR.BasicExpression<boolean> {
  return eq(message.threadId, threadId);
}

/**
 * The filter a screen's query reads the Inbox's rows by over `item`, the
 * kept collection's and the drawn rows' alike, so it is written once and
 * runs on both, its comparisons run in SQLite on the kept ones.
 */
export function inboxRowsWhere(
  item: Ref<PlacedInboxRow>,
  reach: InboxFilteredReach,
): IR.BasicExpression<boolean> {
  switch (reach.kind) {
    case INBOX_REACH.AGENT:
      return eq(item.agentId, reach.agentId);
    case INBOX_REACH.ATTENTION:
      return reach.thread === undefined
        ? or(
            eq(item.status, INBOX_STATUS.OPEN),
            eq(item.unread, true),
            not(isUndefined(item.remindAt)),
          )
        : or(
            eq(item.status, INBOX_STATUS.OPEN),
            eq(item.unread, true),
            not(isUndefined(item.remindAt)),
            eq(item.id, reach.thread),
          );
  }
}

/**
 * The rows a screen shows: those the kept collection's query found, but for
 * every key a write stands over (`pending`), which is shown as the query
 * over the drawn rows found it (`drawn`), or not at all where it no longer
 * matches or the writes took it away.
 */
export function inboxRowsMerged(
  kept: readonly PlacedInboxRow[],
  drawn: readonly PlacedInboxRow[],
  pending: ReadonlyMap<string, PlacedInboxRow | typeof ROW_GONE>,
): readonly PlacedInboxRow[] {
  if (pending.size === 0) return kept;

  return [...kept.filter((row) => !pending.has(row.id)), ...drawn];
}

/** Each holder's rows among `rows`, in the order a holder's list draws them. */
function byHolder(rows: readonly PlacedInboxRow[], holderOf: (row: PlacedInboxRow) => string) {
  const lists = new Map<string, InboxRow[]>();

  for (const row of rows) {
    const holder = holderOf(row);
    // Note that a row is read out of the collection without TanStack's own fields or the task the pool holds it on, as the list draws it, the same object while the row stands.
    const listed = threadRowOf(rowOf<PlacedInboxRow, PlacedInboxRow>(row));
    const list = lists.get(holder);

    if (list === undefined) lists.set(holder, [listed]);
    else list.push(listed);
  }

  return new Map([...lists].map(([holder, items]) => [holder, inboxInOrder(items)] as const));
}

/**
 * What the Inbox groups its holders by, from the rows a screen read rather
 * than the document's feed: each task's items, each agent's on no task, and
 * the tasks holding them, those the host's read of what waits names first,
 * in its order, then the rest, the one whose item changed latest first; the
 * tasks the phone kept beside its items standing as `told` names them.
 */
export function inboxHoldingsOfRows(
  rows: readonly PlacedInboxRow[],
  told: InboxHoldings,
): InboxHoldings<InboxRow> {
  const onTasks = rows.filter((row) => row.taskId !== null);
  const read = byHolder(onTasks, (row) => row.taskId ?? row.agentId);

  const agents = byHolder(
    rows.filter((row) => row.taskId === null),
    (row) => row.agentId,
  );

  const named = told.tasks.filter(({ taskId }) => read.has(taskId));
  const namedIds = new Set(named.map(({ taskId }) => taskId));

  const others = [...read]
    .flatMap(([taskId, items]) =>
      namedIds.has(taskId)
        ? []
        : [{ taskId, updatedAt: Math.max(...items.map((item) => item.updatedAt)) }],
    )
    .sort((one, other) => other.updatedAt - one.updatedAt)
    .map(({ taskId }) => ({ taskId }));

  return {
    read,
    tasks: [...named, ...others],
    keptHolders: told.keptHolders,
    agents: Object.fromEntries(agents),
    stored: true,
  };
}
