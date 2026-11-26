/**
 * inbox-digest.ts -- an Inbox item as its list reads it: the item without its thread, and the few things of the thread its row draws from.
 *
 * The Inbox's list (`inbox-list-model.ts`) never reads an item's thread,
 * up to its latest `MAX_MESSAGES_READ` messages, but a digest of it
 * (`InboxDigest`): its newest few messages, the ask that stands open and
 * the ask its latest message answers wherever in the thread each was
 * asked, whether only members wrote on it, and whether any ask on it was
 * withdrawn. So a client may keep its rows lean and read a thread whole
 * only as it opens. A client holding whole items reads its rows through
 * `inboxRowOf`, one row for each item for as long as the item stands, and
 * keeps reading the whole item wherever it draws the thread itself.
 */

import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  inboxWaitsOn,
  openAskOf,
} from "./inbox-wire.js";

/** How many of a thread's newest messages its row reads for its line and its preview: more than the preview draws, since a file sent alone says nothing there. */
export const INBOX_PREVIEW_TAIL = 6;

/** What an item's row reads of its thread, in place of the thread. */
export interface InboxDigest {
  /** The thread's newest `INBOX_PREVIEW_TAIL` messages, oldest first. */
  readonly tail: readonly InboxMessage[];
  /** The latest message whose ask stands open (`openAskOf`), however long before the tail it was asked. */
  readonly openAsk?: InboxMessage | undefined;
  /** The ask the latest message answers, where it answers one the thread carries, however long before the tail it was asked. */
  readonly answeredAsk?: InboxReadAsk | undefined;
  /** Whether the thread holds messages and only members wrote them. */
  readonly allMember: boolean;
  /** Whether any ask on the thread was withdrawn. */
  readonly withdrawn: boolean;
}

/** What an item says of itself bar its thread, which a whole item and its row (`InboxRow`) alike carry, for a read of nothing else. */
export type InboxFields = Omit<InboxItem, "thread">;

/**
 * An item as its list reads it: everything but its thread, and the thread's
 * digest. Note that it names its thread as none, because an item's thread is
 * optional, and a row handed where a whole item is read would otherwise read
 * as a thread holding nothing.
 */
export type InboxRow = Omit<InboxItem, "thread"> & {
  readonly thread?: undefined;
  readonly digest: InboxDigest;
};

/** What `inboxAsksOpen` and the reads after it take of a row. */
type InboxRowAsking = Pick<InboxRow, "status" | "digest">;

/** What `threadNeedsReader` takes of a row: whether it asks, and whom it waits on. */
type InboxRowWaiting = InboxRowAsking & Pick<InboxRow, "waitsOn" | "startedBy">;

/** Each item's row as `inboxRowOf` last made it, kept for as long as the item stands. */
const rows = new WeakMap<InboxItem, InboxRow>();

/** Each list of items' rows as `inboxRowsOf` last made them, kept for as long as the list stands. */
const rowLists = new WeakMap<readonly InboxItem[], readonly InboxRow[]>();

/** A thread's digest: what its row reads of it (`InboxDigest`). */
export function inboxDigestOf(thread: readonly InboxMessage[]): InboxDigest {
  const last = thread.at(-1);
  const answers = last?.answers;

  return {
    tail: thread.slice(-INBOX_PREVIEW_TAIL),
    openAsk: openAskOf(thread)?.message,
    answeredAsk:
      answers === undefined ? undefined : thread.find((each) => each.id === answers.ask)?.ask,
    allMember:
      thread.length > 0 &&
      thread.every((message) => message.author === INBOX_MESSAGE_AUTHOR.MEMBER),
    withdrawn: thread.some((each) => each.ask?.status === INBOX_ASK_STATUS.WITHDRAWN),
  };
}

/**
 * An item's row: the item without its thread, and its thread's digest
 * (`inboxDigestOf`). Note that it is the row made last for the very item,
 * because the list keeps what it read of a row by the row (`itemLine`) and
 * an item that changes arrives as a new one.
 */
export function inboxRowOf(item: InboxItem): InboxRow {
  const kept = rows.get(item);

  if (kept !== undefined) return kept;
  const { thread, ...rest } = item;
  const row: InboxRow = { ...rest, digest: inboxDigestOf(thread ?? []) };
  rows.set(item, row);

  return row;
}

/** A list of items' rows (`inboxRowOf`): the list made last for the very list, so a group of the same items is the group kept (`inboxGroup`). */
export function inboxRowsOf(items: readonly InboxItem[]): readonly InboxRow[] {
  const kept = rowLists.get(items);

  if (kept !== undefined) return kept;
  const made = items.map(inboxRowOf);
  rowLists.set(items, made);

  return made;
}

/** Every holder's whole items as a read holds them, by the holder's id. */
export type InboxItemReads = ReadonlyMap<string, readonly InboxItem[]>;

/** Each read of items by holder as `inboxReadRows` last made its rows, kept for as long as the read stands. */
const readRows = new WeakMap<InboxItemReads, ReadonlyMap<string, readonly InboxRow[]>>();

/** Every holder's items as rows (`inboxRowsOf`), by the holder's id as the read names it: the map made last for the very read. */
export function inboxReadRows(read: InboxItemReads): ReadonlyMap<string, readonly InboxRow[]> {
  const kept = readRows.get(read);

  if (kept !== undefined) return kept;
  const made = new Map([...read].map(([holderId, items]) => [holderId, inboxRowsOf(items)]));
  readRows.set(read, made);

  return made;
}

/** Whether a thread still asks someone something: open, and holding an ask open, as the service's `ASKING` reads it. */
function inboxAsksOpen(row: InboxRowAsking): boolean {
  return row.status === INBOX_STATUS.OPEN && row.digest.openAsk !== undefined;
}

/**
 * Whether the thread is its agent's turn: its ask stands open and a
 * member wrote last, a follow-up asked before answering, which the agent
 * hears and answers on the thread. The ask still stands, so it may be
 * answered at once all the same; the turn comes back with the agent's
 * next post.
 */
export function inboxAgentsTurn(row: InboxRowAsking): boolean {
  return inboxAsksOpen(row) && row.digest.tail.at(-1)?.author === INBOX_MESSAGE_AUTHOR.MEMBER;
}

/**
 * Whether a thread needs the reader: its ask stands open and waits on them,
 * and it is not its agent's turn (`inboxAgentsTurn`). The one reading of it,
 * which Needs you and the tint draw from.
 */
export function threadNeedsReader(row: InboxRowWaiting, readerId: string | undefined): boolean {
  return (
    readerId !== undefined &&
    inboxAsksOpen(row) &&
    !inboxAgentsTurn(row) &&
    inboxWaitsOn(row)?.userId === readerId
  );
}
