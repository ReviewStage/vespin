/**
 * inbox-digest.ts -- an Inbox item as its list reads it: the item without its thread, and the few things of the thread its row draws from.
 *
 * The Inbox's list (`inbox-list-model.ts`) never reads an item's thread,
 * up to its latest `MAX_MESSAGES_READ` messages, but a digest of it
 * (`InboxDigest`): its newest few messages, every ask that stands open
 * and the ask its latest message answers wherever in the thread each was
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
} from "./inbox-wire.js";

/** How many of a thread's newest messages its row reads for its line and its preview: more than the preview draws, since a file sent alone says nothing there. */
export const INBOX_PREVIEW_TAIL = 6;

/** What an item's row reads of its thread, in place of the thread. */
export interface InboxDigest {
  /** The thread's newest `INBOX_PREVIEW_TAIL` messages, oldest first. */
  readonly tail: readonly InboxMessage[];
  /**
   * Every message whose ask stands open, oldest first, however long before
   * the tail each was asked: the latest is the thread's open ask
   * (`openAskOf`). Note that the older ones are kept too, because a client
   * drawing the reader's answer to the latest before the service takes it
   * still draws the row asking the one before.
   */
  readonly openAsks: readonly InboxMessage[];
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
    openAsks: thread.filter((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN),
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
  return row.status === INBOX_STATUS.OPEN && row.digest.openAsks.length > 0;
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

/** The messages a digest still carries, its open ask and its tail, each once, oldest first: the thread a change is drawn over on a row alone. */
function carriedThread(digest: InboxDigest): readonly InboxMessage[] {
  const asks = digest.openAsk === undefined ? [] : [digest.openAsk];
  const byId = new Map([...asks, ...digest.tail].map((message) => [message.id, message] as const));

  return [...byId.values()].sort((one, other) => one.createdAt - other.createdAt);
}

/**
 * The row as `draw` leaves its item, from a row that carries no thread of
 * its own: the item is drawn over the thread the digest still carries, and
 * the digest taken anew from what that leaves, so a reply or a settle draws
 * at once; what it keeps of the thread beyond that, whether every message
 * is a member's and whether an ask was withdrawn, is carried and extended
 * by what the draw wrote. None where `draw` leaves the item as it was.
 * Note that this holds only while a write or a send stands, since the
 * service's item, which replaces it once answered, carries the thread whole.
 */
export function inboxRowDrawn(
  row: InboxRow,
  draw: (item: InboxItem) => InboxItem | undefined,
): InboxRow | undefined {
  const { digest, thread: _none, ...fields } = row;
  const carried: InboxItem = { ...fields, thread: carriedThread(digest) };
  const changed = draw(carried);

  if (changed === undefined || changed === carried) return undefined;
  const { thread, ...rest } = changed;
  const drawn = inboxDigestOf(thread ?? []);

  // Note that an empty thread holds no message to be a member's, so its first decides alone.
  const allMember =
    digest.tail.length === 0 ? drawn.allMember : digest.allMember && drawn.allMember;

  return {
    ...rest,
    digest: { ...drawn, allMember, withdrawn: digest.withdrawn || drawn.withdrawn },
  };
}
