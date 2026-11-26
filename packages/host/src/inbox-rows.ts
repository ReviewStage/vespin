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
 * rows the writes standing draw (`StandingRows.pending`), and the two are
 * merged (`inboxRowsMerged`): every key a write stands over is taken from
 * the second, where its drawn row still matches, and left out where it no
 * longer does, as a settle leaves Open at once. Note that no library lays a
 * write layer of another's over a live query, which is why this is ours.
 */

import { inboxInOrder } from "@repo/features/inbox-live";
import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { ROW_GONE, rowOf, type StandingRows } from "@repo/sync";
import { eq, type IR, isUndefined, not, or, type Ref } from "@tanstack/db";
import type { InboxHoldings } from "./app-state-reads.js";
import { INBOX_ITEM, itemOf, type PlacedInboxItem } from "./inbox-collections.js";

export type { PlacedInboxItem } from "./inbox-collections.js";

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

/** The Inbox kind's rows as the screens read them where they are kept on disk, and the moving of them. */
export interface InboxRowsSource {
  /** The kind's collection and the rows the writes standing over it draw; none before the follow first stood on it. */
  readonly standing: () => StandingRows<PlacedInboxItem> | undefined;
  /** Hears each moving of the kind's collection or of the writes standing over it; answers how to stop hearing. */
  readonly watch: (heard: () => void) => () => void;
}

/** The Inbox kind's rows over the pool `pool` names. */
export function inboxRowsSource(pool: {
  readonly standing: (kind: typeof INBOX_ITEM) => StandingRows<PlacedInboxItem> | undefined;
  readonly watch: (heard: () => void) => () => void;
}): InboxRowsSource {
  return { standing: () => pool.standing(INBOX_ITEM), watch: pool.watch };
}

/**
 * The filter a screen's query reads the Inbox's rows by over `item`, the
 * kept collection's and the drawn rows' alike, so it is written once and
 * runs on both, its comparisons run in SQLite on the kept ones.
 */
export function inboxRowsWhere(
  item: Ref<PlacedInboxItem>,
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
  kept: readonly PlacedInboxItem[],
  drawn: readonly PlacedInboxItem[],
  pending: ReadonlyMap<string, PlacedInboxItem | typeof ROW_GONE>,
): readonly PlacedInboxItem[] {
  if (pending.size === 0) return kept;

  return [...kept.filter((row) => !pending.has(row.id)), ...drawn];
}

/** The rows the writes standing draw, those they take away left out, as the second source a screen's query runs over. */
export function inboxRowsDrawn(
  pending: ReadonlyMap<string, PlacedInboxItem | typeof ROW_GONE>,
): readonly PlacedInboxItem[] {
  return [...pending.values()].filter((row): row is PlacedInboxItem => row !== ROW_GONE);
}

/** Each holder's items among `rows`, in the order a holder's list draws them. */
function byHolder(rows: readonly PlacedInboxItem[], holderOf: (row: PlacedInboxItem) => string) {
  const lists = new Map<string, InboxItem[]>();

  for (const row of rows) {
    const holder = holderOf(row);
    // Note that a row is read out of the collection without TanStack's own fields or the task the pool holds it on, as the document tells an item, the same object while the row stands.
    const item = itemOf(rowOf<PlacedInboxItem, PlacedInboxItem>(row));
    const list = lists.get(holder);

    if (list === undefined) lists.set(holder, [item]);
    else list.push(item);
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
  rows: readonly PlacedInboxItem[],
  told: InboxHoldings,
): InboxHoldings {
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
