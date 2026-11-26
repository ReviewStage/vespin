/**
 * inbox-messages.ts -- each message of an Inbox thread as a row of its own, kept on disk apart from its thread's row where the account's database keeps the Inbox, so a launch reads the threads a list draws and a thread reads its messages only as it opens.
 *
 * A message row is the message as an item read carries it, its files and
 * where its ask stands among it, beside the id of the thread it stands on
 * (`threadId`), by which a thread's messages are read and let go. No write
 * is drawn over a message: a reply on its way is drawn by the screen's own
 * sends (`useSendsDrawn`), and the service's answer to it carries the thread
 * anew, so the kind takes only what the account's read answers.
 */

import { type InboxItem, type InboxMessage, inboxMessageSchema } from "@repo/features/inbox-wire";
import type { RowKind } from "@repo/sync";
import { Schema } from "effect";

/** A message of a thread as the pool keeps it: the message, and the thread it stands on. */
export const threadMessageSchema = Schema.Struct({
  ...inboxMessageSchema.fields,
  threadId: Schema.String,
});

export type ThreadMessage = typeof threadMessageSchema.Type;

/** No write changes a message row. */
type NoChange = never;

/** Each message as `messageOf` last read it out, by the row it read, so a row that did not move reads out as the very message. */
const messagesOf = new WeakMap<ThreadMessage, InboxMessage>();

/** Every message of `item`'s thread as a row of its own, on that thread. */
export function threadMessagesOf(item: InboxItem): readonly ThreadMessage[] {
  return (item.thread ?? []).map((message) => ({ ...message, threadId: item.id }));
}

/** The message a row holds without the thread it stands on, as a thread draws it; a row read again reads out as the very message. */
export function messageOf(row: ThreadMessage): InboxMessage {
  const read = messagesOf.get(row);

  if (read !== undefined) return read;
  const { threadId: _thread, ...message } = row;
  messagesOf.set(row, message);

  return message;
}

/** A thread's messages from its rows, oldest first, as an item read carries them. */
export function threadOfRows(rows: readonly ThreadMessage[]): readonly InboxMessage[] {
  return [...rows]
    .sort((one, other) => one.createdAt - other.createdAt || one.id.localeCompare(other.id))
    .map(messageOf);
}

/** A message of a thread, by its id, kept on disk where the account's database keeps the Inbox. */
export const INBOX_MESSAGE: RowKind<ThreadMessage, NoChange> = {
  key: (message) => message.id,
  stored: { name: "inboxMessage", version: 1 },
  drawn: () => undefined,
};
