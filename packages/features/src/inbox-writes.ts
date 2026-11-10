/**
 * inbox-writes.ts -- what a member's nod, answer, or close, or its take-back, leaves an inbox item as, so the host draws the write before the service answers it.
 *
 * Every function is pure over the item as a read holds it, and answers it
 * as the service will once it has taken the write: settled by the reader,
 * now, and read, its thread's open ask answered or withdrawn; or, taken
 * back, open again, the ask the reader's close withdrew open again.
 */

import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
} from "./inbox-wire.js";

/** The member signed in, as an answer or a close names who gave it; none where the account names no id. */
export interface InboxReader {
  readonly userId: string;
  readonly name: string;
}

/** The thread's open ask's message, by id; none where its thread holds no open ask, as a notice's. */
function openAskId(item: InboxItem): string | undefined {
  return item.thread?.findLast((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id;
}

/** Whether the item's thread holds the ask on the message given still open, so an answer to it settles it. */
export function asksOpen(item: InboxItem, askId: string): boolean {
  return (item.thread ?? []).some(
    (message) => message.id === askId && message.ask?.status === INBOX_ASK_STATUS.OPEN,
  );
}

/** How a settled ask stands: answered, or withdrawn at a moment. */
type SettledStanding =
  | { readonly status: typeof INBOX_ASK_STATUS.ANSWERED }
  | {
      readonly status: typeof INBOX_ASK_STATUS.WITHDRAWN;
      readonly withdrawnAt: number;
      readonly withdrawnBy?: string;
    };

/** The thread with the ask on the message given settled as `standing` says, and the messages given after it. */
function settledThread(
  thread: readonly InboxMessage[],
  askId: string,
  standing: SettledStanding,
  after: readonly InboxMessage[],
): readonly InboxMessage[] {
  const settled = thread.map((message) =>
    message.id === askId && message.ask !== undefined
      ? { ...message, ask: { ...message.ask, ...standing } }
      : message,
  );
  return [...settled, ...after];
}

/**
 * The item as the reader nodded to it with Got it, before the service says
 * how it stands: answered by the reader, now, and read, as the service
 * answers it, its thread as it was, since a nod writes no message.
 */
export function acknowledgedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  return {
    ...item,
    status: INBOX_STATUS.ANSWERED,
    ...(reader === undefined ? undefined : { answeredBy: reader }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/**
 * The item as the reader answered it, before the service says how it
 * stands: as a nod leaves it (`acknowledgedNow`), and its open ask answered
 * and the reply carrying the answer after it, under the reply's own key
 * until the service names the message. Note that the files the reply
 * carried are not drawn until then, since the service names them.
 */
export function answeredNow(
  item: InboxItem,
  sent: { readonly key: string; readonly text: string; readonly answers: InboxAnswers },
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const reply: InboxMessage = {
    id: sent.key,
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    ...(reader === undefined ? undefined : { member: reader }),
    text: sent.text,
    answers: sent.answers,
    createdAt: now,
  };
  const thread = settledThread(
    item.thread ?? [],
    sent.answers.ask,
    { status: INBOX_ASK_STATUS.ANSWERED },
    [reply],
  );
  return { ...acknowledgedNow(item, reader, now), thread };
}

/** The item as the reader closed it without an answer, before the service says how it stands: closed by the reader, now, and read, its thread's open ask withdrawn now by the reader with no reason. */
export function closedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const askId = openAskId(item);
  const thread =
    item.thread === undefined || askId === undefined
      ? undefined
      : settledThread(
          item.thread,
          askId,
          {
            status: INBOX_ASK_STATUS.WITHDRAWN,
            withdrawnAt: now,
            ...(reader === undefined ? undefined : { withdrawnBy: reader.userId }),
          },
          [],
        );
  return {
    ...item,
    status: INBOX_STATUS.CLOSED,
    ...(reader === undefined ? undefined : { closedBy: reader }),
    ...(thread === undefined ? undefined : { thread }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/**
 * The item as the reader's take-back of their own nod or close leaves it,
 * before the service says how it stands: open again and waiting on them,
 * and the ask their close withdrew, the latest withdrawn without a reason,
 * open again.
 */
export function takenBackNow(item: InboxItem, now: number): InboxItem {
  const askId = item.thread?.findLast(
    (message) =>
      message.ask?.status === INBOX_ASK_STATUS.WITHDRAWN &&
      message.ask.withdrawnReason === undefined,
  )?.id;
  const thread = item.thread?.map((message) => {
    if (message.id !== askId || message.ask === undefined) return message;
    const { withdrawnAt: _at, withdrawnBy: _by, ...ask } = message.ask;
    return { ...message, ask: { ...ask, status: INBOX_ASK_STATUS.OPEN } };
  });
  const { answeredBy: _answered, closedBy: _closed, settledAt: _settled, ...open } = item;
  return {
    ...open,
    status: INBOX_STATUS.OPEN,
    ...(thread === undefined || item.status !== INBOX_STATUS.CLOSED ? undefined : { thread }),
    updatedAt: Math.max(item.updatedAt, now),
  };
}
