/**
 * inbox-undelivered.ts -- the reader's Inbox replies that did not go, kept where they were sent with Retry, Edit, and Delete, as a chat app keeps a message that did not go, across a reload and a relaunch.
 *
 * A reply the service refused, or one no answer came back for, which may
 * have reached the agent all the same, stays at its thread's end marked Not
 * delivered rather than going back into the box, so the box never holds
 * words already sent (`use-task-inbox.ts`). Each is kept under the key it
 * went under, which Retry sends it again under, so the service takes it
 * once, and which a read of its item settles it by: once the thread holds a
 * message under that key, it went, and the line goes. Its words, its answer
 * to the ask, and why it did not go are kept in the renderer's storage for
 * the account that sent them (`keptLines`), so a reload or a relaunch draws
 * them again; its files stay in the window that attached them, as a draft's
 * do. A new thread started from an item's box that did not go stands on that
 * item's thread the same way, marked as a new thread, and a read of any of
 * the task's items holding its key settles it, since the thread it started
 * is an item of its own.
 */

import type { AgentAttachment } from "@repo/features/agent-wire";
import { type InboxAnswers, inboxAnswersSchema } from "@repo/features/inbox-wire";
import { Schema } from "effect";
import { keptLines } from "../composer-drafts.js";

/** Where the replies that did not go are kept in the renderer's storage. */
const STORAGE_KEY = "app.inboxUndelivered";

/** Why a send no answer came back for is marked, which may have reached the agent all the same. */
export const UNHEARD_UNDELIVERED =
  "No answer came back, so this may not have reached the agent. Retry sends it only once.";

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
  /** Whether it was to start a new thread with the item's agent rather than reply on the item's own, which a read of any of the task's items holding its key settles. */
  readonly startsThread?: true | undefined;
}

/** A reply that did not go as storage keeps it: all of it but its files. */
const keptSchema = Schema.Struct({
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

/** Every reply that did not go, the account signed in's alone, in the order they failed. */
export const undeliveredReplies = keptLines<UndeliveredReply, typeof keptSchema.Type>({
  key: STORAGE_KEY,
  kept: keptSchema,
  toKept: ({ attachments: _attached, files, answers, revision, startsThread, ...rest }) => ({
    ...rest,
    ...(files === 0 ? undefined : { files }),
    ...(answers === undefined ? undefined : { answers }),
    ...(revision === undefined ? undefined : { revision }),
    ...(startsThread === undefined ? undefined : { startsThread }),
  }),
  fromKept: ({ files, ...kept }) => ({ ...kept, files: files ?? 0, attachments: [] }),
  idOf: (kept) => kept.key,
});

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
