/**
 * inbox.ts -- the member's inbox as an outside agent acting for them works it: the threads of a workspace they may read, and an ask answered, a message written, a thread closed or started, or their read state and reminders set, each as the member through the window's own doors.
 *
 * The threads are the member's own read of one workspace's inbox
 * (`workspaceInboxItems`), every item they may read whichever member's
 * agent posted it, never an agent's read of its own threads: each open
 * thread whole, then the latest settled ones by the messages that say what
 * came of them, as an agent's own read keeps a settled thread
 * (`settledMessages`), with each ask as an agent reads one back
 * (`askLineOf`). They are ordered by what waits: the threads whose ask
 * waits on the member (`threadNeedsReader`), then every other open ask,
 * then the notices still open, then the settled ones, each the latest
 * changed first.
 *
 * An answer, a message, a close, and a new thread are the window's own
 * (`inbox/inbox-procedures.ts`'s `answerAsMember`, `messageAsMember`,
 * `closeAsMember`, and `startAsMember`), so each is written as the
 * member's and handed to the thread's agent through the one steer path,
 * which wakes an idle agent as a message typed in its tab does, and a
 * hand-off that fails takes the write back. The member's own read state,
 * a thread marked read or unread, every thread marked read, and a
 * reminder, is theirs alone and tells no agent (`markReadAsMember`,
 * `markInboxRead`, and `remindAsMember`). Each is made under a key of its own, since an outside agent
 * names none, so a call made again is a second answer, which an ask no
 * longer open refuses, or a second message. A refusal is told in words the
 * outside agent can act on: an answer that does not fit its ask in the
 * check's own words.
 */

import { randomUUID } from "node:crypto";
import { storeWriter } from "@repo/database/models/writer";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
  inboxStartTitle,
  inboxWaitsOn,
  openAskOf,
  threadNeedsReader,
} from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf, mentionMarkdownLink } from "@repo/features/link-grammar";
import { MEMBER_MCP_TOOL } from "@repo/features/member-mcp-tool";
import { Clock, Effect } from "effect";
import { agentToolRejected, orStoreRefusal } from "../agents/agent-tools.js";
import { settledMessages, threadLineOf } from "../agents/coder-host/inbox.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { workspaceStepOf } from "../agents/written-mentions.js";
import { ACTION_RESULT_STATUS, HOSTED_API_ERROR, type WireRecord } from "../core.js";
import type { HostedRefusal } from "../http/http-effect.js";
import {
  answerAsMember,
  closeAsMember,
  markReadAsMember,
  messageAsMember,
  remindAsMember,
  startAsMember,
} from "../inbox/inbox-procedures.js";
import { INBOX_ASK_ANSWER, markInboxRead, workspaceInboxItems } from "../inbox/inbox-store.js";

/** The inbox tools by name, each the name a model calls it by. */
export const MEMBER_INBOX_TOOL = {
  READ: MEMBER_MCP_TOOL.READ_INBOX,
  ANSWER: MEMBER_MCP_TOOL.ANSWER_ASK,
  REPLY: MEMBER_MCP_TOOL.REPLY_TO_THREAD,
  CLOSE: MEMBER_MCP_TOOL.CLOSE_THREAD,
  MARK_READ: MEMBER_MCP_TOOL.MARK_THREAD_READ,
  MARK_ALL_READ: MEMBER_MCP_TOOL.MARK_INBOX_READ,
  REMIND: MEMBER_MCP_TOOL.REMIND_THREAD,
  START: MEMBER_MCP_TOOL.START_THREAD,
} as const;

/** Why a call wrote nothing, in words the outside agent can act on. */
const MEMBER_INBOX_REFUSAL = {
  NO_THREAD: `Not done: the member reaches no such thread, or its agent no longer stands to hear it; ${MEMBER_INBOX_TOOL.READ} names their threads.`,
  NOT_OPEN: `Not answered: that ask no longer stands open, since it was answered, replaced by a newer ask, or withdrawn; ${MEMBER_INBOX_TOOL.READ} reads the thread as it stands.`,
  NOT_FITTING: (why: string) => `Not answered: ${why}`,
  MOVED: `Not closed: the thread's agent changed it since that revision, or it was answered or closed already; ${MEMBER_INBOX_TOOL.READ} reads it as it stands.`,
  NOT_PERMITTED:
    "Not done: the thread's agent runs on its starter's own GitHub token or plan, so only its starter's words reach it.",
  UNTOLD:
    "Not done: it could not be handed to the thread's agent just now, so nothing was kept; try again in a moment.",
  NO_AGENT: `Not started: the member reaches no such agent, or it no longer stands to hear them; ${MEMBER_MCP_TOOL.LIST_AGENTS} names their agents.`,
  UNMARKED: "Not done: it could not be written just now; try again in a moment.",
  PAST: "Not set: that time is not after now; name a time to come, or null to end the reminder.",
} as const;

/** The writer a hand-off writes the member's line into the agent's conversation with, as the window's doors write it. */
const WRITER = storeWriter({ tools: CODER_TOOL_SET });

/** The order threads are read in: what waits on the member first, and what is settled last. */
const THREAD_ORDER = {
  NEEDS_MEMBER: 0,
  ASKING: 1,
  NOTICE: 2,
  SETTLED: 3,
} as const;

type ThreadOrder = (typeof THREAD_ORDER)[keyof typeof THREAD_ORDER];

/** Who wrote a message, as the outside agent reads it: the thread's agent, `you` for the member it acts for, another member by name, or a former member whose account is gone. */
function writerOf(message: InboxMessage, userId: string): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "agent";
  if (message.member === undefined) return "a former member";
  return message.member.userId === userId ? "you" : message.member.name;
}

/** Where a thread stands in what waits on the member. */
function orderOf(item: InboxItem, userId: string): ThreadOrder {
  if (item.status !== INBOX_STATUS.OPEN) return THREAD_ORDER.SETTLED;
  if (threadNeedsReader(item, userId)) return THREAD_ORDER.NEEDS_MEMBER;
  return openAskOf(item.thread ?? []) === undefined ? THREAD_ORDER.NOTICE : THREAD_ORDER.ASKING;
}

/**
 * A thread as the outside agent reads it: its id, which the other tools
 * take, where it stands and its revision, which a close names, its agent,
 * who it waits on and whether that is the member, the id of the message
 * whose ask stands open, which an answer names, and its messages in order,
 * an open thread's whole and a settled one's as `settledMessages` keeps
 * them, with how many that leaves out and who settled it.
 */
function threadOf(item: InboxItem, userId: string): WireRecord {
  const messages = item.thread ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : settledMessages(messages);
  const earlier = messages.length - told.length;
  const waitsOn = inboxWaitsOn(item);
  const asking = open ? openAskOf(messages) : undefined;
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    revision: item.revision,
    agentId: item.agentId,
    waitsOn: waitsOn?.name ?? null,
    waitsOnMember: waitsOn?.userId === userId,
    unread: item.unread === true,
    ...(asking === undefined ? undefined : { askId: asking.message.id }),
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map((message) => threadLineOf(message, writerOf(message, userId))),
    ...(item.answeredBy === undefined ? undefined : { answeredBy: item.answeredBy.name }),
    ...(item.closedBy === undefined ? undefined : { closedBy: item.closedBy.name }),
    ...(item.closedReason === undefined ? undefined : { closedReason: item.closedReason }),
  };
}

/** What a write answers once it is taken: the thread as it then stands. */
function accepted(item: InboxItem, userId: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.ACCEPTED, thread: threadOf(item, userId) };
}

/** A hand-off's refusal in the outside agent's words: a thread the member does not reach, an agent only its starter reaches, or one that could not be told now. */
function refusedAs(refusal: HostedRefusal): WireRecord {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return agentToolRejected(MEMBER_INBOX_REFUSAL.NO_THREAD);
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return agentToolRejected(MEMBER_INBOX_REFUSAL.NOT_PERMITTED);
    default:
      return agentToolRejected(MEMBER_INBOX_REFUSAL.UNTOLD);
  }
}

/** A read-state write's refusal in the outside agent's words: a thread the member does not reach, or one not written now. */
function unmarkedAs(refusal: HostedRefusal): WireRecord {
  return agentToolRejected(
    refusal.error === HOSTED_API_ERROR.NOT_FOUND
      ? MEMBER_INBOX_REFUSAL.NO_THREAD
      : MEMBER_INBOX_REFUSAL.UNMARKED,
  );
}

/** The member's threads of the workspace, by what waits on them first, each with its mention under the workspace's step. */
export function readMemberInbox(userId: string, workspaceId: string) {
  return orStoreRefusal(
    Effect.zipWith(
      workspaceInboxItems(userId, workspaceId),
      workspaceStepOf(userId, workspaceId),
      (items, step) => {
        const orders = Object.values(THREAD_ORDER);
        const threads = orders.flatMap((order) =>
          items
            .filter((item) => orderOf(item, userId) === order)
            .map((item) => ({
              ...threadOf(item, userId),
              mention: mentionMarkdownLink(
                item.title,
                linkOf({ kind: LINK_PLACE.INBOX_ITEM, itemId: item.id }, step),
              ),
            })),
        );
        return { threads };
      },
      { concurrent: true },
    ),
  );
}

/** The member's answer to a thread's open ask, with their words, handed to the agent that asked; refused where the ask stands open no longer or the answer does not fit it. */
export function answerAskAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly note: string; readonly answers: InboxAnswers },
) {
  const sent = {
    text: asked.note,
    clientKey: randomUUID(),
    attachments: [],
    answers: asked.answers,
  };
  return answerAsMember(WRITER, userId, asked.threadId, sent).pipe(
    Effect.map((answered) => {
      if (answered.outcome === INBOX_ASK_ANSWER.NOT_OPEN) {
        return agentToolRejected(MEMBER_INBOX_REFUSAL.NOT_OPEN);
      }
      if (answered.outcome === INBOX_ASK_ANSWER.REFUSED) {
        return agentToolRejected(MEMBER_INBOX_REFUSAL.NOT_FITTING(answered.refusal ?? ""));
      }
      return accepted(answered.item, userId);
    }),
    Effect.catch((refusal) => Effect.succeed(refusedAs(refusal))),
  );
}

/** The member's message on a thread, open or settled, handed to its agent; it answers no ask. */
export function replyAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly text: string },
) {
  const sent = { text: asked.text, clientKey: randomUUID(), attachments: [] };
  return messageAsMember(WRITER, userId, asked.threadId, sent).pipe(
    Effect.map(({ item }) => accepted(item, userId)),
    Effect.catch((refusal) => Effect.succeed(refusedAs(refusal))),
  );
}

/** The member's close of an open thread without an answer, at the revision read, handed to its agent where it waits on one; refused where the thread moved on since. */
export function closeThreadAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly revision: number },
) {
  const sent = { revision: asked.revision, clientKey: randomUUID() };
  return closeAsMember(WRITER, userId, asked.threadId, sent).pipe(
    Effect.map(({ item, taken }) =>
      taken ? accepted(item, userId) : agentToolRejected(MEMBER_INBOX_REFUSAL.MOVED),
    ),
    Effect.catch((refusal) => Effect.succeed(refusedAs(refusal))),
  );
}

/** A new thread the member starts with an agent they may message, its first message handed to the agent; its subject, where they name none, stands for the message's first line until it is titled. */
export function startThreadAsMember(
  userId: string,
  asked: { readonly agentId: string; readonly title?: string; readonly text: string },
) {
  const sent = {
    agentId: asked.agentId,
    title: inboxStartTitle(asked),
    titled: asked.title !== undefined,
    text: asked.text,
    clientKey: randomUUID(),
    attachments: [],
  };
  return startAsMember({}, WRITER, userId, sent).pipe(
    Effect.map(({ item }) => accepted(item, userId)),
    Effect.catch((refusal) =>
      Effect.succeed(
        refusal.error === HOSTED_API_ERROR.NOT_FOUND
          ? agentToolRejected(MEMBER_INBOX_REFUSAL.NO_AGENT)
          : refusedAs(refusal),
      ),
    ),
  );
}

/** The member's own read of a thread written: read, or unread until they read it again; no agent hears of it. */
export function markThreadReadAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly read: boolean },
) {
  return markReadAsMember(userId, asked.threadId, !asked.read).pipe(
    Effect.map(
      ({ id, unread }): WireRecord => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        threadId: id,
        unread,
      }),
    ),
    Effect.catch((refusal) => Effect.succeed(unmarkedAs(refusal))),
  );
}

/** Every thread of the workspace marked read for the member, open or settled: how many were unread. */
export function markInboxReadAsMember(userId: string, workspaceId: string) {
  return orStoreRefusal(
    Effect.map(
      markInboxRead(userId, workspaceId),
      ({ marked }): WireRecord => ({ status: ACTION_RESULT_STATUS.ACCEPTED, marked }),
    ),
  );
}

/** The member's reminder on a thread set for an instant, in epoch milliseconds, which keeps it out of their inbox until then, or ended where none is named. */
export function remindThreadAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly at: number | null },
) {
  const set = remindAsMember(userId, asked.threadId, asked.at).pipe(
    Effect.map(
      ({ id, unread }): WireRecord => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        threadId: id,
        remindAt: asked.at === null ? null : new Date(asked.at).toISOString(),
        unread,
      }),
    ),
    Effect.catch((refusal) => Effect.succeed(unmarkedAs(refusal))),
  );
  // Note that a time already past is refused, as the window's picker does, since it would end a reminder still pending.
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    asked.at !== null && asked.at <= now
      ? Effect.succeed(agentToolRejected(MEMBER_INBOX_REFUSAL.PAST))
      : set,
  );
}
