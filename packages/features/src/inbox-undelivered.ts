/**
 * inbox-undelivered.ts -- the reader's Inbox replies that did not go, as every client keeps them on their thread marked Not delivered with Retry, Edit, and Delete: what one is, what storage keeps of it, the words it is said in, and which of them a thread draws.
 *
 * A reply the service refused, or one no answer came back for, which may
 * have reached the agent all the same, stays at its thread's end marked Not
 * delivered rather than going back into the box, so the box never holds
 * words already sent. Each is kept under the key it went under, which Retry
 * sends it again under, so the service takes it once, and which a read of
 * its item settles it by: once the thread holds a message under that key, it
 * went, and the line goes. Its words, its answer to the ask, and why it did
 * not go are kept across a relaunch for the account that sent them (the
 * panel's `keptLines`, the phone's defaults); its files stay in memory, so
 * one a relaunch took them from says so rather than going again without
 * them (`filesLost`). A new thread started from an item's box that did not
 * go stands on that item's thread the same way, marked as a new thread, and
 * a read of any item holding its key settles it, since the thread it started
 * is an item of its own.
 */

import { Schema } from "effect";
import type { AgentAttachment } from "./agent-wire.js";
import { answeredDraft, EMPTY_INBOX_DRAFT, type InboxDraft } from "./inbox-draft.js";
import { knownAsk } from "./inbox-list-model.js";
import {
  INBOX_ASK,
  INBOX_MESSAGE_AUTHOR,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
  inboxAnswersSchema,
  openAskOf,
} from "./inbox-wire.js";
import { type InboxReader, inboxSendingFiles } from "./inbox-writes.js";

/** Why a send no answer came back for is marked, which may have reached the agent all the same. */
export const UNHEARD_UNDELIVERED =
  "No answer came back, so this may not have reached the agent. Retry sends it only once.";

/** Why a reply queued behind one that did not go did not go itself. */
export const BEHIND_UNDELIVERED = "Not sent, because the reply before it did not go.";

/** Why a reply a relaunch took the files from offers no Retry. */
export const UNDELIVERED_FILES_LOST =
  "Its files didn't survive a relaunch. Edit to attach them again, then send it.";

/** The words a reply that did not go is marked and pressed in. */
export const UNDELIVERED_WORDS = {
  NOT_DELIVERED: "Not delivered",
  RETRY: "Retry",
  EDIT: "Edit",
  DELETE: "Delete",
  NEW_THREAD: "New thread",
} as const;

/** A reply that did not go, as its thread draws it and Retry sends it again. */
export interface UndeliveredReply {
  /** The key it went under, which Retry sends it again under and a read settles it by. */
  readonly key: string;
  /** The task whose inbox holds its item, null for an item no task holds. */
  readonly taskId: string | null;
  readonly itemId: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  /** How many files it went with, which storage keeps though not the files, so one a relaunch took its files from says so rather than going again without them (`filesLost`). */
  readonly files: number;
  /** The answer to the thread's open ask it carried; none for a plain reply. */
  readonly answers?: InboxAnswers | undefined;
  /** The revision of the notice it was written on, which it settles where the notice still stands there. */
  readonly revision?: number | undefined;
  /** When it was sent, which its thread orders and dates it by. */
  readonly at: number;
  /** Why it did not go, which heads its mark's menu. */
  readonly why: string;
  /** Whether it was to start a new thread with the item's agent rather than reply on the item's own, which a read of any item holding its key settles. */
  readonly startsThread?: true | undefined;
}

/** A reply that did not go as storage keeps it: all of it but its files. */
export const keptUndeliveredSchema = Schema.Struct({
  key: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  itemId: Schema.String,
  text: Schema.String,
  files: Schema.optionalKey(Schema.Number),
  answers: Schema.optionalKey(inboxAnswersSchema),
  revision: Schema.optionalKey(Schema.Number),
  at: Schema.Number,
  why: Schema.String,
  startsThread: Schema.optionalKey(Schema.Literal(true)),
});

export type KeptUndelivered = typeof keptUndeliveredSchema.Type;

/** A reply that did not go as storage keeps it, its files left out. */
export function keptUndelivered({
  attachments: _attached,
  files,
  answers,
  revision,
  startsThread,
  ...rest
}: UndeliveredReply): KeptUndelivered {
  return {
    ...rest,
    ...(files === 0 ? undefined : { files }),
    ...(answers === undefined ? undefined : { answers }),
    ...(revision === undefined ? undefined : { revision }),
    ...(startsThread === undefined ? undefined : { startsThread }),
  };
}

/** A reply that did not go as storage gave it back, with no files, which a relaunch took. */
export function undeliveredFromKept({ files, ...kept }: KeptUndelivered): UndeliveredReply {
  return { ...kept, files: files ?? 0, attachments: [] };
}

/** Whether a relaunch took the files a reply went with, so Retry would send it without them: it offers Edit to attach them again instead. */
export function filesLost(reply: Pick<UndeliveredReply, "attachments" | "files">): boolean {
  return reply.attachments.length < reply.files;
}

/** No replies that did not go, one array so an item with none hands down the same one. */
const NO_UNDELIVERED: readonly UndeliveredReply[] = [];

/**
 * The replies on `itemId` that did not go, in the order they failed, but for
 * those its thread holds under their keys already, as a read may before the
 * line is let go of, and those Retry has on their way again, which stand on
 * the thread as sending meanwhile.
 */
export function undeliveredOn(
  all: readonly UndeliveredReply[],
  itemId: string,
  sent: (key: string) => boolean,
): readonly UndeliveredReply[] {
  const on = all.filter((reply) => reply.itemId === itemId && !sent(reply.key));

  return on.length === 0 ? NO_UNDELIVERED : on;
}

/** Whether a thread holds a message sent under `key`. */
export function threadHoldsKey(thread: readonly InboxMessage[] | undefined, key: string): boolean {
  return (thread ?? []).some((message) => message.clientKey === key);
}

/**
 * The keys of the replies that did not go which `items` show went after all:
 * a reply whose item's thread holds a message under its key, and a thread's
 * start any of `items` holds a message under its key, since the thread it
 * started is an item of its own. One whose item `items` leave out stands,
 * since a read that leaves an item out says nothing of it.
 */
export function undeliveredSettled(
  all: readonly UndeliveredReply[],
  items: readonly Pick<InboxItem, "id" | "thread">[],
): ReadonlySet<string> {
  const byId = new Map(items.map((item) => [item.id, item]));

  const went = (reply: UndeliveredReply) =>
    reply.startsThread === true
      ? items.some((item) => threadHoldsKey(item.thread, reply.key))
      : threadHoldsKey(byId.get(reply.itemId)?.thread, reply.key);

  return new Set(all.flatMap((reply) => (went(reply) ? [reply.key] : [])));
}

/**
 * The ask an answer answers, where it is still the thread's open ask and
 * this build knows it. Note that an ask the agent has posted over since is
 * none, so its picks never land on the ask standing now, whose options may
 * share their labels.
 */
function askAnswered(thread: readonly InboxMessage[], answers: InboxAnswers) {
  const asking = openAskOf(thread);

  return asking !== undefined && asking.message.id === answers.ask && knownAsk(asking.ask)
    ? asking.ask
    : undefined;
}

/**
 * A reply that did not go as its box held it: its words and files, and the
 * picks its answer made on the ask, where the thread still carries the ask,
 * so taking it back fills the ask's controls as they stood. Note that a
 * press is kept for a `do` alone, whose Mark done or Couldn't do it it is.
 */
export function undeliveredDraft(
  thread: readonly InboxMessage[],
  reply: Pick<UndeliveredReply, "text" | "attachments" | "answers">,
): InboxDraft {
  const { answers } = reply;
  const ask = answers === undefined ? undefined : askAnswered(thread, answers);

  const picks =
    ask === undefined || answers === undefined ? EMPTY_INBOX_DRAFT : answeredDraft(ask, answers);

  const press = ask?.type === INBOX_ASK.DO ? picks.press : undefined;

  return { ...picks, press, note: reply.text, attachments: reply.attachments };
}

/**
 * The item with its replies that did not go standing at its thread's foot,
 * in the order they failed, as the reader's own messages under their keys,
 * each with its answer and the files it still holds, so a client draws them
 * as it draws any message and marks them by their keys. A thread with none
 * stands as the read holds it.
 */
export function withUndelivered(
  item: InboxItem,
  lines: readonly UndeliveredReply[],
  reader: InboxReader | undefined,
): InboxItem {
  if (lines.length === 0) return item;

  const shown = lines.map(
    (reply): InboxMessage => ({
      id: reply.key,
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      ...(reader === undefined ? undefined : { member: reader }),
      text: reply.text,
      ...(reply.attachments.length === 0
        ? undefined
        : {
            files: inboxSendingFiles(reply.key, reply.attachments).map(
              ({ attachmentId, name, mediaType }) => ({ attachmentId, name, mediaType }),
            ),
          }),
      ...(reply.answers === undefined ? undefined : { answers: reply.answers }),
      clientKey: reply.key,
      createdAt: reply.at,
    }),
  );

  return { ...item, thread: [...(item.thread ?? []), ...shown] };
}

/** Whether a card's draft holds a pick: an option, a field, a step, or a press. */
function holdsPicks(draft: InboxDraft): boolean {
  return (
    draft.choices.length > 0 ||
    draft.values.length > 0 ||
    (draft.steps ?? []).length > 0 ||
    draft.press !== undefined
  );
}

/**
 * What a box holds once a reply that did not go is taken back into it with
 * Edit (`undeliveredDraft`): its words and files ahead of those written
 * there since, and its picks unless others were made meanwhile.
 */
export function undeliveredTakenBack(now: InboxDraft, went: InboxDraft): InboxDraft {
  const empty = now.note.trim() === "" && now.attachments.length === 0 && !holdsPicks(now);

  if (empty) return went;

  return {
    ...(holdsPicks(now) ? now : went),
    note: [went.note, now.note].filter((words) => words.trim() !== "").join("\n"),
    attachments: [...went.attachments, ...now.attachments],
  };
}
