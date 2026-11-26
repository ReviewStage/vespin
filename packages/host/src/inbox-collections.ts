/**
 * inbox-collections.ts -- an inbox item as the sync engine's pool holds it: one row however many inbox reads hold it, the changes a member's write draws over it, and the waits of the reads every inbox write on the account reaches.
 *
 * An item is a kind of the pool (`@repo/sync`), `INBOX_ITEM`: a plan's
 * inbox (`scope-inbox-follow.ts`) and the account's feed of
 * every item (`account-items-follow.ts`) each stand on the items they
 * answer, so an item several reads hold, as the open task's inbox and the
 * feed both do, is one row, and a write over it reaches all of them. Main's
 * read of what waits (`account-inbox-follow.ts`) keeps its own brief
 * entries and per-task counts, and stands beside the pool, drawing the
 * writes standing over them itself.
 *
 * A member's write is declared by the agents composer (`compose-agents.ts`)
 * and drawn by the pool the moment it is asked, standing until each read it
 * changed carries its transaction, or taken back where the service refused
 * it. So a change is drawn again over each item a read takes while it
 * stands, and must leave an item the service already changed as it is.
 * Every txid an inbox write answers reaches every read holding its item: a
 * mark writes the reader's read row, which wakes the account and the item's
 * task and agent, and a nod, an answer, or a close writes the item, which
 * wakes every member's account, its task, and its agent. Where a read hands
 * no wait yet, as before Sync first woke it, the write's own answer is taken
 * in its place. From the service's answer on, a write stands as the item
 * the service answered, so a reply stays on its thread; and a write the
 * service did not take, the agent having changed the item first, takes the
 * item as the service answered it before it is taken back, so it lands on
 * the service's word.
 */

import { type InboxRow, inboxRowDrawn, inboxRowOf } from "@repo/features/inbox-digest";
import { INBOX_STATUS, type InboxItem, inboxItemSchema } from "@repo/features/inbox-wire";
import type { Refused, RowKind, Written } from "@repo/sync";
import { Effect, Schema, type Scope } from "effect";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** What a member's write does to the items it names. */
export const INBOX_CHANGE = {
  /** The item settled by the reader: nodded to, answered, or closed. */
  SETTLED: "settled",
  /** The reader's own nod or close taken back, the item open again. */
  REOPENED: "reopened",
  /** Items marked read or unread, as a reply of the reader's marks its item read. */
  MARKED: "marked",
  /** The item's reminder set by the reader for an instant, or canceled; whether it is read stands as it was. */
  REMINDED: "reminded",
  /** The item as the service answered it. */
  ANSWERED: "answered",
} as const;

/** One write's change, as every read draws it over what it holds. */
export type InboxChange =
  | {
      readonly kind: typeof INBOX_CHANGE.SETTLED;
      readonly itemId: string;
      /** What the item becomes, from the item as the read holds it; none where the agent has posted over what the reader settled since. */
      readonly item: (item: InboxItem) => InboxItem | undefined;
    }
  | {
      readonly kind: typeof INBOX_CHANGE.REOPENED;
      readonly itemId: string;
      /** What the item becomes, from the item as the read holds it. */
      readonly item: (item: InboxItem) => InboxItem;
    }
  | {
      readonly kind: typeof INBOX_CHANGE.MARKED;
      readonly itemIds: ReadonlySet<string>;
      readonly unread: boolean;
    }
  | {
      readonly kind: typeof INBOX_CHANGE.REMINDED;
      readonly itemId: string;
      /** When, in epoch milliseconds; null where the reminder is canceled. */
      readonly until: number | null;
    }
  | { readonly kind: typeof INBOX_CHANGE.ANSWERED; readonly item: InboxItem };

/** What the service answered of a write: its transaction, the item as it then stands where it names one, and whether it was kept. */
export interface InboxWritten {
  readonly txid: string | undefined;
  readonly item: InboxItem | undefined;
  readonly kept: boolean;
}

/** The item as a reminder change leaves it, with none where the change cancels it, as the service cancels one; none where it stands so already. */
function remindedItem(
  item: InboxItem,
  change: Extract<InboxChange, { readonly kind: typeof INBOX_CHANGE.REMINDED }>,
): InboxItem | undefined {
  const until = change.until ?? undefined;

  if (item.remindAt === until) return undefined;
  const { remindAt: _was, ...rest } = item;

  return until === undefined ? rest : { ...rest, remindAt: until };
}

/**
 * The item as the change leaves it, from the item as a read holds it; none
 * where it leaves it alone. Note that a settle leaves an item no longer
 * open alone, and a take-back one still open, and a settle one the agent has posted over since, as an answered item
 * the agent's next post opens again, and the service's item one changed
 * since, because a change is drawn again over each answer while it stands,
 * and the service's own newer item is what it draws.
 */
function changedItem(change: InboxChange, item: InboxItem): InboxItem | undefined {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
      return item.id === change.itemId && item.status === INBOX_STATUS.OPEN
        ? change.item(item)
        : undefined;
    case INBOX_CHANGE.REOPENED:
      return item.id === change.itemId && item.status !== INBOX_STATUS.OPEN
        ? change.item(item)
        : undefined;
    case INBOX_CHANGE.MARKED:
      // Note that a mark sets the reader's own mark as well, since Open reads it on a closed thread.
      return change.itemIds.has(item.id) &&
        ((item.unread === true) !== change.unread || (item.markedUnread === true) !== change.unread)
        ? { ...item, unread: change.unread, markedUnread: change.unread }
        : undefined;
    case INBOX_CHANGE.REMINDED:
      return item.id === change.itemId ? remindedItem(item, change) : undefined;
    case INBOX_CHANGE.ANSWERED:
      return item.id === change.item.id && item.updatedAt <= change.item.updatedAt
        ? change.item
        : undefined;
  }
}

/** The ids of the items a change names. */
export function changedIds(change: InboxChange): readonly string[] {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
    case INBOX_CHANGE.REOPENED:
      return [change.itemId];
    case INBOX_CHANGE.MARKED:
      return [...change.itemIds];
    case INBOX_CHANGE.REMINDED:
      return [change.itemId];
    case INBOX_CHANGE.ANSWERED:
      return [change.item.id];
  }
}

/**
 * An inbox item as the pool holds it: the item, and the task it stands on,
 * null for one on no task, which the item names nowhere of its own and every
 * read that answers it knows, the account's read from its stamps and a
 * plan's read as the plan it reads. Note that the row stays open to more of
 * the read's own fields, as the generation of the whole read that last wrote
 * it once whole reads come in pages.
 */
export const placedInboxItemSchema = Schema.Struct({
  ...inboxItemSchema.fields,
  taskId: Schema.NullOr(Schema.String),
});

export type PlacedInboxItem = typeof placedInboxItemSchema.Type;

/** `item` placed on the task `taskId` names, none for one on no task. */
export function placedItem(item: InboxItem, taskId: string | null): PlacedInboxItem {
  return { ...item, taskId };
}

/** Each item as `itemOf` last read it out, by the row it read, so a row that did not move reads out as the very item. */
const itemsOf = new WeakMap<PlacedInboxItem, InboxItem>();

/**
 * The item a row holds without the task it stands on, as a window is told
 * it: the document groups items by task itself, so it never carries the
 * pool's own field. A row read again while it stands reads out as the very
 * item read before.
 */
export function itemOf(row: PlacedInboxItem): InboxItem {
  const read = itemsOf.get(row);

  if (read !== undefined) return read;
  const { taskId: _placed, ...item } = row;
  itemsOf.set(row, item);

  return item;
}

/** An inbox item as the pool holds it, by its id, every write to it a change the item's reads draw over it, on the task it stood on. */
export const INBOX_ITEM: RowKind<PlacedInboxItem, InboxChange> = {
  key: (item) => item.id,
  drawn: (change, item) => {
    const changed = item === undefined ? undefined : changedItem(change, item);

    // Note that a change names the item alone, so the task it stands on is carried over from the row it was drawn over.
    return changed === undefined || item === undefined
      ? undefined
      : placedItem(changed, item.taskId);
  },
};

/**
 * An inbox thread as the pool keeps it where the account's database keeps
 * the Inbox: the item without its thread, the digest its list draws from
 * (`InboxDigest`), and the task it stands on. Its messages are a kind of
 * their own (`inbox-messages.ts`), read only as a thread opens, so a launch
 * reads the threads a list draws and never their messages.
 */
export type PlacedInboxRow = InboxRow & { readonly taskId: string | null };

/** `item`'s row placed on the task `taskId` names, its digest taken from its thread whole. */
export function placedRow(item: InboxItem, taskId: string | null): PlacedInboxRow {
  return { ...inboxRowOf(item), taskId };
}

/**
 * The row as the change leaves it, from the row as a read holds it; none
 * where it leaves it alone. A change is drawn over the thread the digest
 * still carries (`inboxRowDrawn`), so a reply or a settle draws at once,
 * and the service's own item, which a write stands as once answered,
 * carries the thread whole, so its digest is taken from all of it.
 */
function drawnRow(change: InboxChange, row: PlacedInboxRow): PlacedInboxRow | undefined {
  if (change.kind === INBOX_CHANGE.ANSWERED) {
    return row.id === change.item.id && row.updatedAt <= change.item.updatedAt
      ? placedRow(change.item, row.taskId)
      : undefined;
  }

  const drawn = inboxRowDrawn(threadRowOf(row), (item) => changedItem(change, item));

  return drawn === undefined ? undefined : { ...drawn, taskId: row.taskId };
}

/** Each item as `threadItemOf` last read it out, by the row it read, so a row that did not move reads out as the very item. */
const threadItems = new WeakMap<PlacedInboxRow, InboxItem>();

/**
 * The item a lean row holds, without its digest or the task it stands on,
 * and with no thread, which the row never carries: the item a write's own
 * answer names where it is answered from the pool, whose readers read where
 * it stands, never its messages.
 */
export function threadItemOf(row: PlacedInboxRow): InboxItem {
  const read = threadItems.get(row);

  if (read !== undefined) return read;
  const { digest: _digest, taskId: _placed, thread: _none, ...item } = row;
  threadItems.set(row, item);

  return item;
}

/** Each row as `threadRowOf` last read it out, by the placed row it read. */
const threadRows = new WeakMap<PlacedInboxRow, InboxRow>();

/** The row a lean row holds without the task it stands on, as the list draws it; a row read again reads out as the very row. */
export function threadRowOf(row: PlacedInboxRow): InboxRow {
  const read = threadRows.get(row);

  if (read !== undefined) return read;
  const { taskId: _placed, ...listed } = row;
  threadRows.set(row, listed);

  return listed;
}

/** How a platform keeps the Inbox's items in the pool: whole, as the desktop's and the web's document tells them, or as lean rows kept on disk beside their messages, as the iPhone's screens read them. */
export const INBOX_KEEPING = {
  WHOLE: "whole",
  LEAN: "lean",
} as const;

export type InboxKeeping = (typeof INBOX_KEEPING)[keyof typeof INBOX_KEEPING];

/** What every Inbox row the pool keeps carries, whole or lean: the item's own fields, and the task it stands on. */
export type PlacedInboxFields = Omit<InboxItem, "thread"> & { readonly taskId: string | null };

/** An inbox thread as the pool keeps it where the account's database keeps the Inbox, by its id, every write to it drawn over its digest. */
export const INBOX_THREAD: RowKind<PlacedInboxRow, InboxChange> = {
  key: (row) => row.id,
  // Note that the version moves with the row's shape, so a build that changes it reads its threads again.
  stored: { name: "inboxThread", version: 1 },
  drawn: (change, row) => (row === undefined ? undefined : drawnRow(change, row)),
};

/**
 * What the service answered of a write on items, as the pool takes it:
 * kept on its transaction, standing as the item it names from then on, and
 * taken as that item in the place of a read that hands no wait; or refused,
 * landing on the item it names before it is taken back.
 */
export function inboxSent<Answer>(
  answer: Answer,
  written: InboxWritten,
): Written<InboxChange, Answer> | Refused<Answer, InboxChange> {
  const named: InboxChange | undefined =
    written.item === undefined ? undefined : { kind: INBOX_CHANGE.ANSWERED, item: written.item };

  if (!written.kept)
    return named === undefined ? { refused: answer } : { refused: answer, taken: named };
  const { txid } = written;

  return named === undefined ? { answer, txid } : { answer, txid, taken: named, standsAs: named };
}

/** Whether a change leaves the item no longer open: settled by the reader, or answered settled. */
export function settles(change: InboxChange): boolean {
  if (change.kind === INBOX_CHANGE.SETTLED) return true;

  return change.kind === INBOX_CHANGE.ANSWERED && change.item.status !== INBOX_STATUS.OPEN;
}

/** The account's own reads, every one of which any inbox write on the account wakes, and the waits they hand. */
export interface AccountWideReads {
  /** Stands a read's wait among the account's own for as long as the caller's scope. */
  readonly stand: (wait: () => TxWait | undefined) => Effect.Effect<void, never, Scope.Scope>;
  /** Waits for a write that draws nothing, as a thread started is, on every one of the account's own reads. */
  readonly confirm: (txid: string | undefined) => Effect.Effect<void>;
}

/** The account's own reads, none standing yet. */
export function accountWideReads(): AccountWideReads {
  const standing = new Set<() => TxWait | undefined>();

  return {
    stand: (wait) =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => standing.add(wait)),
          () => Effect.sync(() => standing.delete(wait)),
        ),
      ),
    confirm: (txid) =>
      Effect.forEach([...standing], (wait) => confirmWrite(wait(), txid), {
        concurrency: "unbounded",
        discard: true,
      }),
  };
}
