/**
 * inbox-writes.ts -- what a member's nod, answer, or close, or its take-back, leaves an inbox item as, so the host draws the write before the service answers it.
 *
 * Every function is pure over the item as a read holds it, and answers it
 * as the service will once it has taken the write: settled by the reader,
 * now, and read, its thread's open ask answered or withdrawn; or, taken
 * back, open again, the ask the reader's close withdrew open again.
 */

import type { AgentAttachment } from "./agent-wire.js";
import { base64PictureSize, type ImageDimensions } from "./image-signature.js";
import { type InboxRow, inboxRowDrawn } from "./inbox-digest.js";
import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
} from "./inbox-wire.js";

/** How a picture's media type starts, which a file's header is read for its size by. */
const PICTURE_TYPE = "image/";

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

/** A reply's files as a message names them, none where it carries none, so a reply of pictures alone never stands as an empty message. */
function filesNamed(files: readonly InboxSendingFile[] | undefined) {
  return files === undefined || files.length === 0
    ? undefined
    : {
        files: files.map(({ attachmentId, name, mediaType }) => ({
          attachmentId,
          name,
          mediaType,
        })),
      };
}

/**
 * The item as the reader answered it, before the service says how it
 * stands: as a nod leaves it (`acknowledgedNow`), and its open ask answered
 * and the reply carrying the answer after it, under the reply's own key
 * until the service names the message, with the files the reply carried
 * where the send holds their bytes (`files`), which the window draws them
 * from until a read carries them.
 */
export function answeredNow(
  item: InboxItem,
  sent: {
    readonly key: string;
    readonly text: string;
    readonly answers: InboxAnswers;
    readonly files?: readonly InboxSendingFile[] | undefined;
  },
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const reply: InboxMessage = {
    id: sent.key,
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    ...(reader === undefined ? undefined : { member: reader }),
    text: sent.text,
    answers: sent.answers,
    ...filesNamed(sent.files),
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

/** What a reader sent on a thread that a read may not carry yet: a reply, its answer to the open ask attached or not, or a close. */
export const INBOX_SENDING = {
  REPLY: "reply",
  CLOSE: "close",
} as const;

/** A file a reply carries as it is drawn until a read carries it: the attachment it is drawn under, named as a read names one, its bytes, which the window draws it from rather than reading it back, and, for a picture, the size its header states, read once as it is sent. */
export interface InboxSendingFile {
  readonly attachmentId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly base64: string;
  readonly pictureSize?: ImageDimensions | undefined;
}

/** A file a reply sent from this window carries, as the thread draws it from the send: its type, its bytes, and, for a picture, the size read as it was sent. */
export interface InboxHeldFile {
  readonly contentType: string;
  readonly base64: string;
  readonly pictureSize?: ImageDimensions | undefined;
}

/** One thing the reader sent on a thread, as it is drawn until a read carries it: a reply under its own key, with the files it carries, written at `at`, or a close of the revision the reader was shown. */
export type InboxSending =
  | {
      readonly kind: typeof INBOX_SENDING.REPLY;
      readonly key: string;
      readonly text: string;
      readonly answers?: InboxAnswers | undefined;
      readonly files?: readonly InboxSendingFile[] | undefined;
      readonly at: number;
    }
  | { readonly kind: typeof INBOX_SENDING.CLOSE; readonly revision: number; readonly at: number };

/**
 * The item as one send leaves it: a close settling it while it stands open
 * at no newer revision than the close was sent at, since the agent's post
 * after it reopens the item at a newer one;
 * a reply carrying an answer settling its ask while that stands open
 * (`answeredNow`); and a plain reply at the thread's foot, under its key,
 * the item read. Note that a reply a read already carries, by its key, is
 * drawn as the read has it, so it never stands twice.
 */
function sendingDrawn(
  item: InboxItem,
  sending: InboxSending,
  reader: InboxReader | undefined,
): InboxItem {
  if (sending.kind === INBOX_SENDING.CLOSE) {
    return item.status === INBOX_STATUS.OPEN && item.revision <= sending.revision
      ? closedNow(item, reader, sending.at)
      : item;
  }

  const thread = item.thread ?? [];

  if (thread.some(({ id, clientKey }) => id === sending.key || clientKey === sending.key)) {
    return item;
  }

  const { key, text, answers, files, at } = sending;

  if (answers !== undefined) {
    return asksOpen(item, answers.ask)
      ? answeredNow(item, { key, text, answers, files }, reader, at)
      : item;
  }

  // Note that a reply's files stand on it at once, as the read will carry them.
  const reply: InboxMessage = {
    id: key,
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    ...(reader === undefined ? undefined : { member: reader }),
    text,
    ...filesNamed(files),
    clientKey: key,
    createdAt: at,
  };

  return { ...item, thread: [...thread, reply], unread: false };
}

/**
 * The files a reply sent under `key` carries as its send draws them: each
 * under an attachment of its own, the key with its place in the last group,
 * so no two of a reply share one, and a picture with the size its header
 * states. Note that the size is read here, once a send, since each draw of
 * the thread until a read carries the reply would otherwise decode the
 * picture's head again.
 */
export function inboxSendingFiles(
  key: string,
  attachments: readonly AgentAttachment[],
): readonly InboxSendingFile[] {
  return attachments.map((attachment, place) => ({
    attachmentId: `${key.slice(0, 24)}${place.toString(16).padStart(12, "0")}`,
    name: attachment.name,
    mediaType: attachment.mediaType,
    base64: attachment.data,
    pictureSize: attachment.mediaType.startsWith(PICTURE_TYPE)
      ? base64PictureSize(attachment.data)
      : undefined,
  }));
}

/** The file a read of `thread` carries under `attachmentId` for a reply among `replies`, at its place among that reply's files, where its name and type are the send's. */
function carriedFile(
  replies: readonly InboxSending[],
  thread: readonly InboxMessage[],
  attachmentId: string,
): InboxSendingFile | undefined {
  const carried = thread.find(
    ({ clientKey, files }) =>
      clientKey !== undefined && files?.some((file) => file.attachmentId === attachmentId),
  );

  const reply = replies.find(
    (each) => each.kind === INBOX_SENDING.REPLY && each.key === carried?.clientKey,
  );

  const place = carried?.files?.findIndex((file) => file.attachmentId === attachmentId) ?? -1;
  const read = carried?.files?.[place];
  const sent = reply?.kind === INBOX_SENDING.REPLY ? reply.files?.[place] : undefined;

  return read !== undefined && sent?.name === read.name && sent.mediaType === read.mediaType
    ? sent
    : undefined;
}

/**
 * A file a reply sent from this window carries, by its attachment, as its
 * bytes are drawn: one still drawn from its send, or one a read of `thread`
 * now carries under the service's own attachment, matched to the send by its
 * key and its place among the reply's files. None for any other attachment,
 * such as an agent's. Note that a file the read carries is drawn from the
 * send's bytes only where its name and type are the send's, so a read that
 * orders a reply's files otherwise reads them back rather than drawing one
 * as another.
 */
export function inboxSendingFile(
  sending: Iterable<InboxSending>,
  attachmentId: string,
  thread: readonly InboxMessage[] = [],
): InboxHeldFile | undefined {
  const replies = [...sending];

  const drawn = replies
    .flatMap((each) => (each.kind === INBOX_SENDING.REPLY ? (each.files ?? []) : []))
    .find((held) => held.attachmentId === attachmentId);

  const file = drawn ?? carriedFile(replies, thread, attachmentId);

  return file === undefined
    ? undefined
    : { contentType: file.mediaType, base64: file.base64, pictureSize: file.pictureSize };
}

/**
 * The item as the reader's sends still out, or not yet carried by a read,
 * leave it, oldest first, so a client with no write of its own to draw over
 * draws them at once and lets each go where the service refused it: an
 * answer, a reply, or a close. A send a read already carries, or one the
 * agent has posted over since, leaves the item as the read holds it.
 */
export function inboxSendingDrawn(
  item: InboxItem,
  sending: readonly InboxSending[],
  reader: InboxReader | undefined,
): InboxItem {
  return sending.reduce((drawn, each) => sendingDrawn(drawn, each, reader), item);
}

/**
 * A list row as the reader's sends leave it, drawn over the thread its
 * digest carries (`inboxRowDrawn`); the row itself where they leave it as
 * it was. Note that a row carries only its thread's newest messages, so a
 * reply the service took (`taken`, by its key) is drawn only until a
 * message as new as it stands at the row's foot, since past that the reply
 * was carried or passed, and drawing it would lay it again past what
 * followed it.
 */
export function inboxRowSendingDrawn(
  row: InboxRow,
  sending: readonly InboxSending[],
  taken: ReadonlySet<string>,
  reader: InboxReader | undefined,
): InboxRow {
  const newest = row.digest.tail.at(-1)?.createdAt;

  const standing = sending.filter(
    (each) =>
      each.kind !== INBOX_SENDING.REPLY ||
      !taken.has(each.key) ||
      newest === undefined ||
      newest < each.at,
  );

  if (standing.length === 0) return row;

  return inboxRowDrawn(row, (item) => inboxSendingDrawn(item, standing, reader)) ?? row;
}
