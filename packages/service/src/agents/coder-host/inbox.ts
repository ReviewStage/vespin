import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readPageById } from "@repo/database/models/task-pages";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import {
  inboxSandboxPicturePaths,
  withoutSandboxPictures,
} from "@repo/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_CLOSE_LEAD,
  INBOX_FIELD,
  INBOX_FILE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_OPTION_MEDIA,
  INBOX_STATUS,
  INBOX_TOOL,
  type InboxAnswers,
  type InboxAskInput,
  type InboxItem,
  type InboxMessage,
  type InboxOptionMedia,
  type InboxPostOptionMedia,
  type InboxReadAsk,
  type InboxThreadPostInput,
  inboxListInputSchema,
  inboxReadThreadInputSchema,
  inboxThreadPostInputSchema,
  inboxWaitsOn,
  inboxWithdrawInputSchema,
  keptInboxAsk,
  NONE_OF_THESE,
  openAskOf,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import {
  decodeMention,
  MENTION_KIND,
  mentionLinksIn,
  placeholderLinksIn,
} from "@repo/features/mention-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result } from "effect";
import {
  ACTION_RESULT_STATUS,
  EXCESS_KEYS,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  wireRecord,
} from "../../core.js";
import { afterResponse } from "../../http/after-response.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  agentInboxItemOfKey,
  agentInboxItems,
  agentReachedInboxItems,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxBodyPicture,
  type InboxPostRefusal,
  type InboxStoreEffect,
  type InboxThreadPage,
  inboxThreadPage,
  type PostPicture,
  postInboxThread,
  readInboxItem,
  readInboxItemHome,
} from "../../inbox/inbox-store.js";
import { pushThreadPost, pushThreadSettled } from "../../push/inbox-pushes.js";
import { placeholderLinksWords } from "../link-rule.js";
import { taskIdOfInput } from "../task-ref.js";

import {
  type InboxSandboxDoor,
  readSandboxBodyFile,
  readSandboxMedia,
  type SandboxImageRefusals,
} from "./inbox-image.js";
import { keptAddressesIn, readKeptPicture } from "./inbox-kept-picture.js";

/**
 * inbox.ts -- the coding agent's thread tools: post a message on a thread in the inbox, withdraw a thread's open ask, list threads, and read one whole.
 *
 * What an agent cannot do or decide alone, a product choice, an approval
 * of a risky step, a question, or something only the developer can do by
 * hand such as a setting on GitHub, and whatever is ready for the developer
 * to look at, review, or test by hand, such as a pull request, goes in a
 * thread rather than in a message, where it is lost in the transcript: a
 * thread of its own on the service (`inbox-store.ts`), posted to the inbox
 * and drawn on the agent's task as well. The agent may address the
 * thread's ask to a member by their mention link; a link naming no member
 * is refused before the store is asked. The agent names each thread by a
 * key of its own. A post is one
 * message on it, one Markdown body with its chips, its cards, and its
 * pictures where they belong, which may end with an ask, `decide`, `do`, or
 * `answer` (`@repo/features/inbox-wire`); the first post under a key opens
 * the thread and names its title, and a later one adds a message, its ask
 * replacing the one open. A picture is drawn in the body by the path of
 * its file in the agent's sandbox, a screenshot of what it rendered, which
 * a post reads there first (`inbox-image.ts`) and the store keeps as a file
 * of the message, writing its address in the path's place; a PDF named
 * the same way is kept as a file of the message too, cut out of its words,
 * since it is opened from its chip rather than drawn. A file that is
 * not there, not an image or a PDF, or past its bound refuses the whole
 * post with the path named. A post that asks nothing is a note, or the agent's reply
 * on the thread, since replying never answers: a member's message on the
 * thread reaches the agent as one of the developer's messages, and so does
 * an answer it waits on. No call holds the turn, since a coder session
 * takes no input mid-turn.
 * A post and a withdrawal answer with the thread they changed and one line
 * for each other thread of the agent's still open, so the model holds what
 * waits whatever its context has lost to compaction, without the whole
 * inbox on every post. A list answers one line a thread, the agent's own
 * or, read only, another agent's or a task's of its workspace, and a read
 * answers one thread whole, a page of its messages at a time, its pictures
 * and pages by reference. A subagent's call reaches us as its agent's own,
 * so its thread is the agent's, and an answer on it reaches the agent.
 */

/** The inbox's picture bound in megabytes, as the words the model reads say it. */
const MAX_PICTURE_MB = (INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1);

/** The inbox's video bound in megabytes, as the words the model reads say it. */
const MAX_VIDEO_MB = (INBOX_BOUNDS.MAX_VIDEO_BYTES / 1_000_000).toFixed(1);

/** A PDF's bound in megabytes, as the words the model reads say it. */
const MAX_PDF_MB = (AGENT_BOUNDS.MAX_PDF_BYTES / 1_000_000).toFixed(1);

/** Where a thread reaches the member, and, where the workspace connected the Slack bot, how to ping them there. */
function threadReachWords(slackOn: boolean): string {
  const reach = "A thread reaches the member in the app alone, never in Slack";

  if (!slackOn) return `${reach}. `;

  return (
    `${reach}: where a Slack ping is worth it, such as an ask that blocks your work, ` +
    `DM them yourself with ${AGENT_TOOL.SEND_SLACK_MESSAGE}, in your own words. `
  );
}

/** `post_thread`'s words, naming `send_slack_message` only where the agent is offered it. */
const postThreadWords = (slackOn: boolean) =>
  "Post a message to the developer's inbox, which is where they look for anything that needs them. " +
  "Use it whenever you need something from them or have something ready for them to look at, and when someone writes to you on a thread, reply on that same thread. " +
  "key is your own short lowercase slug, such as branch-protection: the first post under a key opens its thread and must name its title, " +
  "and a later one adds a message to that thread, a title it names renaming it. " +
  `to is the member the thread waits on, by their [@Name](link) mention as ${AGENT_TOOL.LIST_WORKSPACE_MEMBERS} answers it: the first post under a key must name it, and a later one without it keeps the thread's. ` +
  `body is Markdown, at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters. ` +
  `Write a file, a pull request, or an issue in it as a mention, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so ${PRODUCT_NAME} draws it as a chip, ` +
  "and put a link alone on its own line to show it as a card, its mention never followed by its bare address. " +
  "A card shows code from a blob link at the full 40-character commit you read it at, one already on GitHub, " +
  `ending #L<start>-L<end>, at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines. ` +
  `Draw a picture as ![alt](<path> "caption"), its path in your sandbox, relative to the checkout or absolute: ` +
  `a PNG, JPEG, or WebP of at most ${MAX_PICTURE_MB} MB, a WebM or MP4 video or a WAV, MP3, M4A, AAC, or Ogg sound clip of at most ${MAX_VIDEO_MB} MB, which plays there, ` +
  `or a PDF of at most ${MAX_PDF_MB} MB, kept as a file of the message; at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} a message, ` +
  "and pictures written next to each other stand side by side. " +
  `In place of a path, draw a picture, recording, or clip an agent of your workspace showed with ${AGENT_TOOL.SHOW_MEDIA} by the id that call answered, ` +
  `or a task's picture by the address ${AGENT_TOOL.READ_TASK} writes it at: either is copied into the message. ` +
  "Draw the picture a message is about in it, since the thread's reader never sees a transcript. " +
  "ask ends the message with what it asks: " +
  `decide (two to ${INBOX_BOUNDS.MAX_OPTIONS} options, each a short label and an optional detail, and the label you recommend; multiple lets them pick several, and recommended then takes a list; ` +
  `between designs or variants, give each option its own media, at most ${INBOX_BOUNDS.MAX_POSTED_OPTION_MEDIA}, ` +
  "as {path, caption} for a file in your sandbox, {page, version} for a page you showed with show_page, or {url, label} for an https address such as a preview, " +
  `at most ${INBOX_BOUNDS.MAX_ASK_MEDIA} across the options with the body's pictures; ` +
  "an option's media shows that option alone and is never drawn in body as well, so name a page that compares them all in body by its mention; " +
  `options with media also offer "${NONE_OF_THESE}", which you never offer yourself, and that answer reaches you as "Chose ${NONE_OF_THESE.toLowerCase()}."; ` +
  "for a go-ahead on one step, two short options such as Approve and Request changes), " +
  "do (a to-do only they can do by hand, such as changing a GitHub setting, adding a secret, or testing what you could not; " +
  "its steps say exactly what to do, a command in a fenced block after the words saying where to run it), " +
  "or answer (typed fields, text, number, select with its options and the one you recommend, or boolean, each by its label and required where it must be filled, " +
  "or none for an answer in their own words; a text field takes one exact value, such as an ID, a name, or a price, never an opinion or a pick, " +
  `since the reply box under every ask already takes their words, and picks among more than ${INBOX_BOUNDS.MAX_OPTIONS} are asked as an answer in their own words); ` +
  "never ask for a credential or a secret in a form, since the answer reaches your transcript: that is a do. " +
  "A post without ask asks nothing: a note, or your reply on the thread. " +
  "A post on a settled thread opens it again, as a note waiting on them where it asks nothing. " +
  "A thread holds one open ask, and a newer ask replaces it; every answer reaches you as a message. " +
  threadReachWords(slackOn) +
  "The call answers with the thread and one line for each other thread of yours still open.";

/** `post_thread` as an agent is shown it, its Slack sentence where its workspace connected the Slack bot. */
export function postThreadToolOf(slackOn: boolean) {
  return {
    name: INBOX_TOOL.POST,
    description: postThreadWords(slackOn),
    inputSchema: inboxThreadPostInputSchema,
  };
}

/** The tools as the model is shown them (`../tool-catalog/catalog.ts`): each one's name, words, and input, `post_thread`'s in its words where nothing narrows it. */
export const INBOX_TOOLS = {
  POST: postThreadToolOf(true),
  WITHDRAW: {
    name: INBOX_TOOL.WITHDRAW,
    description:
      "Withdraw the open ask of one of your threads, by its key, with why: you no longer need it, you found the answer yourself, " +
      "or you checked that the to-do is done. That closes the thread, and its messages stay; a thread " +
      "already answered, closed, or withdrawn answers how it was.",
    inputSchema: inboxWithdrawInputSchema,
  },
  LIST: {
    name: INBOX_TOOL.LIST,
    description:
      `List threads one line each: every one still open, then the latest ${INBOX_BOUNDS.MAX_SETTLED_TOLD} settled, each the latest changed first, with its id, which ${INBOX_TOOL.READ} takes, where it stands, and an open ask or an answer. ` +
      `of names whose threads: an agent of your workspace as {agentId}, your own agentId for your own threads, or a task as {taskId}, by its id or its key, such as ACME-42; status lists only those standing there. ` +
      `You only read another agent's threads: ${INBOX_TOOL.POST} and ${INBOX_TOOL.WITHDRAW} keep to your own, and a member's answer there reaches that agent, never you. ` +
      "List them to learn what the developer already decided or is still asked, rather than asking again.",
    inputSchema: inboxListInputSchema,
  },
  READ: {
    name: INBOX_TOOL.READ,
    description:
      `Read one thread whole by its id, as ${INBOX_TOOL.LIST} answered it: your own, or another agent's or a task's of your workspace. ` +
      `It answers where the thread stands and its latest ${INBOX_BOUNDS.MAX_MESSAGES_READ} messages oldest first, each with who wrote it, its words, its ask and where that stands, and a member's answer; ` +
      "older, where earlier messages stand, is the before that reads the page before it, and openAsk is the message whose ask stands open where it is older than the page. " +
      `A picture stands in the words as ![alt](address "caption"), which ${AGENT_TOOL.LOOK_AT_PICTURE} shows, and a page as its link or, on an option, its pageId and version, which ${AGENT_TOOL.READ_PAGE} reads. ` +
      "A member may close a thread without answering, which withdraws its ask with no reason; " +
      `where it held an ask open of yours, that reaches you as a developer's message whose first line starts "${INBOX_CLOSE_LEAD}" and names the key: ` +
      "take it as their not wanting what the ask asked.",
    inputSchema: inboxReadThreadInputSchema,
  },
} as const;

/**
 * An ask as the agent reads it back: whole while it is open, since the
 * agent still acts on it, and once settled its type and where it stands,
 * and an answered `do`'s steps, which the answer names by their places alone.
 */
type AgentAskLine =
  | InboxReadAsk
  | (Pick<InboxReadAsk, "type" | "status" | "withdrawnReason"> & {
      readonly steps?: readonly string[];
    });

/** One message of a thread as an agent reads it back: who wrote it, its words, its files by name, its ask, and the answer it carries. Note that it is a type rather than an interface, because the record a member's thread answers as (`WireRecord`) takes an object type's keys and no interface's. */
export type AgentThreadLine = {
  readonly from: string;
  /** The account of the member who wrote it, which their link names them by; none for an agent's message or a former member's. */
  readonly fromUserId?: string;
  readonly text: string;
  readonly files?: readonly string[];
  readonly ask?: AgentAskLine;
  readonly answers?: Omit<InboxAnswers, "ask">;
};

/** One thread as the agent reads it back: its key, its id, which its link names it by, the agent it is of where that is another, its title, where it stands, and its messages in order. */
interface AgentInboxLine {
  readonly key: string;
  readonly id: string;
  /** The agent whose thread it is, on one another agent posted. */
  readonly agentId?: string;
  readonly title: string;
  readonly status: InboxItem["status"];
  /** How many earlier messages a settled thread's read leaves out. */
  readonly earlier?: number;
  readonly thread: readonly AgentThreadLine[];
  /** The member who closed the thread without answering, by name: a former member's where their account is gone. */
  readonly closedBy?: string;
  /** The account of that member, which their link names them by; none for a former member. */
  readonly closedByUserId?: string;
  /** Why a thread whose messages ask nothing, a notice, was closed. */
  readonly closedReason?: string;
}

/** The agent a post is made as: its account, task, and id, and the workspace whose members the post names. */
export interface ThreadPoster extends InboxAgent {
  readonly organizationId: string;
}

/** One thread as a list names it, one line: what to read it by, where it stands, and what waits on it or came of it. */
interface AgentThreadRow {
  readonly id: string;
  readonly key: string;
  /** The agent whose thread it is, on one another agent posted. */
  readonly agentId?: string;
  readonly title: string;
  readonly status: InboxItem["status"];
  /** When it last changed, as an ISO instant. */
  readonly updatedAt: string;
  /** Who wrote its latest message, as its messages name their writers. */
  readonly lastFrom?: string;
  /** The member an open thread waits on, by name, and the account their link names them by. */
  readonly waitsOn?: string;
  readonly waitsOnUserId?: string;
  /** An open ask's type, and the opening line of the message that asks it. */
  readonly ask?: { readonly type: string; readonly text: string };
  /** An answered thread's answer: how the member answered, what they picked, and the opening line of their words. */
  readonly answer?: Omit<InboxAnswers, "ask"> & { readonly text?: string };
  readonly closedBy?: string;
  readonly closedReason?: string;
}

/** One message of a thread as a read of it answers: its line, when it was written, and its ask whole, settled or not. */
type AgentThreadMessage = Omit<AgentThreadLine, "ask"> & {
  readonly at: string;
  readonly ask?: InboxReadAsk;
};

/** One thread as a read of it answers: where it stands and who settled it, and a page of its messages. */
interface AgentThreadRead {
  readonly id: string;
  readonly key: string;
  readonly agentId?: string;
  readonly title: string;
  readonly status: InboxItem["status"];
  readonly postedAt: string;
  readonly updatedAt: string;
  readonly settledAt?: string;
  readonly waitsOn?: string;
  readonly waitsOnUserId?: string;
  readonly answeredBy?: string;
  readonly answeredByUserId?: string;
  readonly closedBy?: string;
  readonly closedByUserId?: string;
  readonly closedReason?: string;
  /** The message whose ask stands open, where it is older than the page. */
  readonly openAsk?: AgentThreadMessage;
  readonly messages: readonly AgentThreadMessage[];
  /** Where earlier messages stand, the before that reads the page before this one. */
  readonly older?: string;
}

/** What a call refused answers: why it did nothing. */
interface InboxRefused {
  readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
  readonly reason: string;
}

/** What a post or a withdrawal answers: the thread it changed, and one line for each other thread of the agent's still open; or why it did nothing. */
export type InboxWriteResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly thread: AgentInboxLine;
      readonly open: readonly AgentThreadRow[];
      /** Why a withdrawal changed nothing: how the thread's ask was settled before it. */
      readonly note?: string;
    }
  | InboxRefused;

/** What a list answers: one line a thread; or why it did nothing. */
export type InboxListResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly threads: readonly AgentThreadRow[];
    }
  | InboxRefused;

/** What a read of one thread answers: the thread and a page of its messages; or why it did nothing. */
export type InboxReadResult =
  | { readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED; readonly thread: AgentThreadRead }
  | InboxRefused;

/** What any of the thread tools answers, as the model reads it. */
export type InboxToolResult = InboxWriteResult | InboxListResult | InboxReadResult;

/** Why a call did nothing, in the words the model reads. */
export const INBOX_REFUSAL = {
  UNREADABLE_POST:
    "Not posted: the post does not read. key is a lowercase slug of letters, digits, dots, dashes, and underscores; " +
    `body is Markdown of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters; title is one line of at most ${INBOX_BOUNDS.MAX_TITLE_CHARS}; ` +
    `ask is decide with two to ${INBOX_BOUNDS.MAX_OPTIONS} options, do with at most ${INBOX_BOUNDS.MAX_STEPS} steps, ` +
    `or answer with one to ${INBOX_BOUNDS.MAX_FIELDS} fields or none, each {type, label, required} with type text, number, select, or boolean, ` +
    `a select also naming two to ${INBOX_BOUNDS.MAX_OPTIONS} options and perhaps the one it recommends, and no other type taking options or recommended; ` +
    "an option's media is {path, caption}, {page, version} with the version show_page answered, or {url, label}.",
  NO_TITLE:
    "Not posted: you have no thread under that key, and the first post under a key names its title.",
  TOO_MANY_PICTURES: `Not posted: a message draws at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} pictures from your sandbox.`,
  NO_OPTIONS: "Not posted: a decide's options each stand under a label of their own.",
  NONE_OFFERED: `Not posted: an option carrying media may not be labeled "${NONE_OF_THESE}", which the reader is offered beside your options already.`,
  TOO_MUCH_MEDIA: `Not posted: a decide's option media and the message's own pictures total at most ${INBOX_BOUNDS.MAX_ASK_MEDIA} pieces.`,
  NO_PAGE:
    "Not posted: an option names a page or a version you did not show on this task; name a page by the id and version show_page answered.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names a label no option has.",
  SEVERAL_RECOMMENDED:
    "Not posted: recommended names each label once, and several only where multiple lets them pick several.",
  FIELD_LABELS: "Not posted: an answer names each field by a label of its own.",
  SELECT_OPTIONS: "Not posted: a select field names each of its options once.",
  SELECT_RECOMMENDATION: "Not posted: a select field's recommended names one of its options.",
  NOT_SELECT: (label: string, type: string) =>
    `Not posted: field "${label}" is ${type}, yet names options or recommended, which only a select takes; make it a select, or leave both out.`,
  UNREADABLE_WITHDRAW: "Not withdrawn: name the thread's key and why you withdraw its ask.",
  UNREADABLE_LIST:
    'Not listed: name whose threads as of, either {"agentId": "<id>"} for one agent of your workspace, your own agentId (in your instructions\' own values) for your own, or {"taskId": "<id or key>"} for one task of it, never both, and status, where you name one, as open, answered, or closed.',
  UNREADABLE_READ:
    "Not read: name the thread by threadId as list_threads answered it, and before only as a page's older answered it.",
  NO_THREAD:
    "Not read: no thread of your workspace that the developer may see has that id; list_threads lists them.",
  NO_OPEN_ASK:
    "Not withdrawn: your thread under that key is a notice, which asks nothing; a member settles it.",
  NO_KEYED_THREAD: "Not withdrawn: you have no thread under that key; list_threads lists them.",
  NO_MEMBER:
    "Not posted: to names no member; write a member of your workspace by their mention link, [@Name](link), as a person's chip is written.",
  NO_ADDRESSEE_NAMED:
    "Not posted: you have no thread under that key, and the first post under a key names to, the member it waits on, " +
    `by their mention link, [@Name](link), as ${AGENT_TOOL.LIST_WORKSPACE_MEMBERS} answers it.`,
  NO_ADDRESSEE: "Not posted: the member you addressed is not in your workspace.",
  ADDRESSEE_CANNOT_SEE: `Not posted: the member you addressed cannot see your task, so they would never see the thread; address someone who can, by a mention ${AGENT_TOOL.LIST_WORKSPACE_MEMBERS} answers.`,
  NO_AGENT: "Not done: this conversation is no agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

/** Why a withdrawal changed nothing on a thread whose ask was settled before it, in the words the model reads. */
const ALREADY_SETTLED = {
  ANSWERED: (by: string) =>
    `Nothing withdrawn: ${by} already answered the ask; their answer is on the thread.`,
  CLOSED: (by: string) =>
    `Nothing withdrawn: ${by} already closed the thread without answering it.`,
  WITHDRAWN: (reason: string) => `Nothing withdrawn: the ask was already withdrawn: ${reason}`,
} as const;

/** How many of a settled thread's latest messages its read carries: enough to see what came of it. */
const SETTLED_MESSAGES_TOLD = 3;

const readPost = readEither(inboxThreadPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readWithdraw = readEither(inboxWithdrawInputSchema, { excess: EXCESS_KEYS.DROP });

// Note that a list refuses a key it did not name, so a misspelled status or an of naming both is refused rather than read as less than was asked.
const readList = readEither(inboxListInputSchema);
const readThreadAsked = readEither(inboxReadThreadInputSchema);

/** Why a post's picture was not read from the sandbox, in a post's own words; each is followed by the path. */
const PICTURE_REFUSALS: SandboxImageRefusals = {
  NO_FILE: "Not posted: a picture names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, a WebM or H.264 MP4 video that states its size, a WAV, MP3, M4A, AAC, or Ogg sound clip, or a PDF:",
  TOO_LARGE: `Not posted: a picture names a file larger than ${MAX_PICTURE_MB} MB, a video or a sound clip larger than ${MAX_VIDEO_MB} MB, or a PDF larger than ${MAX_PDF_MB} MB; render it smaller, or record a shorter flow or clip:`,
  UNREADABLE: "Not posted: a picture's file could not be read from your sandbox:",
};

/** Why an option's file was not read from the sandbox, in a post's own words; each is followed by the path. */
const OPTION_FILE_REFUSALS: SandboxImageRefusals = {
  NO_FILE: "Not posted: an option's media names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: an option's media names a file that is not a PNG, JPEG, or WebP image, a WebM or H.264 MP4 video that states its size, or a WAV, MP3, M4A, AAC, or Ogg sound clip:",
  TOO_LARGE: `Not posted: an option's media names a file larger than ${MAX_PICTURE_MB} MB, or a video or a sound clip larger than ${MAX_VIDEO_MB} MB; render it smaller, or record a shorter flow or clip:`,
  UNREADABLE: "Not posted: an option's media file could not be read from your sandbox:",
};

/** Who wrote a message, as the agent reads it: itself on its own thread, the thread's agent on another's, or the member by name, or a former member whose account is gone. */
function writerOf(message: InboxMessage, own: boolean): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return own ? "you" : "agent";

  return message.member?.name ?? "a former member";
}

/** An ask as the agent reads it back: whole while open, and its type and standing, with why it was withdrawn, once settled; as a member's outside agent reads one too (`member-mcp/inbox.ts`). */
function askLineOf(ask: InboxReadAsk): AgentAskLine {
  if (ask.status === INBOX_ASK_STATUS.OPEN) return ask;

  return {
    type: ask.type,
    status: ask.status,
    ...(ask.withdrawnReason === undefined ? undefined : { withdrawnReason: ask.withdrawnReason }),
    ...(ask.status === INBOX_ASK_STATUS.ANSWERED && ask.type === INBOX_ASK.DO && "steps" in ask
      ? { steps: ask.steps }
      : undefined),
  };
}

/** An answer as the agent reads it back: how the member answered, without the id of the message it answers, which is the ask before it; as a member's outside agent reads one too. */
function answersLineOf(answers: InboxAnswers): Omit<InboxAnswers, "ask"> {
  const { ask: _ask, ...answered } = answers;

  return answered;
}

/** One message of a thread as an agent reads it back, written `from` whoever its reader names, its files by name, since a member's reached it with their message and its own it sent. */
export function threadLineOf(message: InboxMessage, from: string): AgentThreadLine {
  return {
    from,
    ...(message.member === undefined ? undefined : { fromUserId: message.member.userId }),
    text: message.text,
    ...(message.files === undefined
      ? undefined
      : { files: message.files.map((file) => file.name) }),
    ...(message.ask === undefined ? undefined : { ask: askLineOf(message.ask) }),
    ...(message.answers === undefined ? undefined : { answers: answersLineOf(message.answers) }),
  };
}

/**
 * Who closed an item without answering it, as the agent reads it: the
 * member by name and by the account their link names them by. Note that the agent's own withdrawal always says why, so
 * a closed item without a reason or a member is one a member closed whose
 * account is gone.
 */
function closerOf(item: InboxItem): Pick<AgentInboxLine, "closedBy" | "closedByUserId"> {
  if (item.status !== INBOX_STATUS.CLOSED) return {};

  if (item.closedBy !== undefined) {
    return { closedBy: item.closedBy.name, closedByUserId: item.closedBy.userId };
  }

  return item.closedReason === undefined ? { closedBy: "a former member" } : {};
}

/**
 * What a thread no message asks or answers, a notice's, carries on itself
 * rather than on a message: why it was closed. Note that a thread that asks
 * carries it on its withdrawn ask, so it is not repeated there, and that a
 * notice's nod is its answered status alone.
 */
function settlementOf(item: InboxItem, messages: readonly InboxMessage[]): Partial<AgentInboxLine> {
  if (messages.some((message) => message.ask !== undefined || message.answers !== undefined)) {
    return {};
  }

  return item.closedReason === undefined ? {} : { closedReason: item.closedReason };
}

/**
 * The messages a settled thread's read carries: its latest few, and its
 * latest ask and latest answer however long ago, which say what came of it
 * once later words push them out, each in the thread's order; as a member's
 * outside agent reads a settled thread too.
 */
export function settledMessages(messages: readonly InboxMessage[]): readonly InboxMessage[] {
  const latest = (has: (message: InboxMessage) => boolean) => messages.findLast(has);

  const kept = new Set<InboxMessage | undefined>([
    latest((message) => message.ask !== undefined),
    latest((message) => message.answers !== undefined),
    ...messages.slice(-SETTLED_MESSAGES_TOLD),
  ]);

  return messages.filter((message) => kept.has(message));
}

/**
 * A thread as the agent reads it back, another agent's naming that agent.
 * Note that one still asking carries its messages whole, as the read holds
 * them, because compaction may have taken the call that posted its ask out
 * of the model's context and the agent still acts on it; a settled one
 * carries what `settledMessages` keeps, and how many it leaves out.
 */
function lineOf(item: InboxItem, readerId: string): AgentInboxLine {
  const messages = item.thread ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : settledMessages(messages);
  const earlier = messages.length - told.length;
  const own = item.agentId === readerId;

  return {
    key: item.key,
    id: item.id,
    ...(own ? undefined : { agentId: item.agentId }),
    title: item.title,
    status: item.status,
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map((message) => threadLineOf(message, writerOf(message, own))),
    ...closerOf(item),
    ...settlementOf(item, messages),
  };
}

/** How many characters a line's opening words keep: what says what a message is about at a glance. */
const OPENING_CHARS = 160;

/** A message's opening line, cut at `OPENING_CHARS`; empty where it carried files alone. */
function openingOf(text: string): string {
  const [first = ""] = text.trim().split("\n");

  return first.length <= OPENING_CHARS ? first : `${first.slice(0, OPENING_CHARS - 1)}…`;
}

/** An instant in epoch milliseconds as an answer spells it. */
function isoOf(at: number): string {
  return new Date(at).toISOString();
}

/** Whom an open thread waits on, as a line or a read names them; nothing on a settled one. */
function waiterOf(item: InboxItem): Pick<AgentThreadRow, "waitsOn" | "waitsOnUserId"> {
  if (item.status !== INBOX_STATUS.OPEN) return {};
  const waits = inboxWaitsOn(item);

  return waits === undefined ? {} : { waitsOn: waits.name, waitsOnUserId: waits.userId };
}

/** What an answered thread's answer says in a line: how, what was picked, and the opening of the member's words. */
function answerOf(messages: readonly InboxMessage[]): Pick<AgentThreadRow, "answer"> {
  const answered = messages.findLast((message) => message.answers !== undefined);

  if (answered?.answers === undefined) return {};
  const text = openingOf(answered.text);

  return {
    answer: { ...answersLineOf(answered.answers), ...(text === "" ? undefined : { text }) },
  };
}

/** One thread as a list names it, one line, written for the agent `readerId` names. */
function rowOf(item: InboxItem, readerId: string): AgentThreadRow {
  const messages = item.thread ?? [];
  const own = item.agentId === readerId;
  const last = messages.at(-1);
  const asking = item.status === INBOX_STATUS.OPEN ? openAskOf(messages) : undefined;
  const closed = closerOf(item);

  return {
    id: item.id,
    key: item.key,
    ...(own ? undefined : { agentId: item.agentId }),
    title: item.title,
    status: item.status,
    updatedAt: isoOf(item.updatedAt),
    ...(last === undefined ? undefined : { lastFrom: writerOf(last, own) }),
    ...waiterOf(item),
    ...(asking === undefined
      ? undefined
      : { ask: { type: asking.ask.type, text: openingOf(asking.message.text) } }),
    ...(item.status === INBOX_STATUS.ANSWERED ? answerOf(messages) : undefined),
    ...(closed.closedBy === undefined ? undefined : { closedBy: closed.closedBy }),
    ...(item.status === INBOX_STATUS.CLOSED && item.closedReason !== undefined
      ? { closedReason: item.closedReason }
      : undefined),
  };
}

/**
 * Threads as a list names them: what is open first, then what was
 * answered, then what was closed, each the latest changed first. Note that
 * closed threads come last, because they are settled without an answer and
 * the open and answered ones are what an agent acts on.
 */
function rowsOf(items: readonly InboxItem[], readerId: string): readonly AgentThreadRow[] {
  const order = [INBOX_STATUS.OPEN, INBOX_STATUS.ANSWERED, INBOX_STATUS.CLOSED];

  return order.flatMap((status) =>
    items.flatMap((item) => (item.status === status ? [rowOf(item, readerId)] : [])),
  );
}

/** What a post or a withdrawal answers once it is taken: the thread it changed, one line for each other thread of the agent's still open, and why it changed nothing, where it did not. */
function written(
  agent: InboxAgent,
  item: InboxItem,
  note?: string,
): InboxStoreEffect<InboxWriteResult> {
  return Effect.map(agentInboxItems(agent), (items) => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
    thread: lineOf(item, agent.agentId),
    open: rowsOf(
      items.filter((each) => each.status === INBOX_STATUS.OPEN && each.id !== item.id),
      agent.agentId,
    ),
    ...(note === undefined ? undefined : { note }),
  }));
}

/** One message as a read of its thread answers it: its line, when it was written, and its ask whole. */
function readMessageOf(message: InboxMessage, own: boolean): AgentThreadMessage {
  const { ask: _folded, ...line } = threadLineOf(message, writerOf(message, own));

  return {
    ...line,
    at: isoOf(message.createdAt),
    ...(message.ask === undefined ? undefined : { ask: message.ask }),
  };
}

/** One thread as a read of it answers, its page of messages, and the open ask where the page leaves it out, written for the agent `readerId` names. */
function threadReadOf(
  item: InboxItem,
  page: InboxThreadPage,
  readerId: string,
  first: boolean,
): AgentThreadRead {
  const own = item.agentId === readerId;
  const asking = item.status === INBOX_STATUS.OPEN ? openAskOf(item.thread ?? []) : undefined;
  const paged = page.messages.some((message) => message.id === asking?.message.id);
  const oldest = page.messages[0];

  return {
    id: item.id,
    key: item.key,
    ...(own ? undefined : { agentId: item.agentId }),
    title: item.title,
    status: item.status,
    postedAt: isoOf(item.postedAt),
    updatedAt: isoOf(item.updatedAt),
    ...(item.settledAt === undefined ? undefined : { settledAt: isoOf(item.settledAt) }),
    ...waiterOf(item),
    ...(item.answeredBy === undefined
      ? undefined
      : { answeredBy: item.answeredBy.name, answeredByUserId: item.answeredBy.userId }),
    ...closerOf(item),
    ...(item.closedReason === undefined ? undefined : { closedReason: item.closedReason }),
    ...(first && asking !== undefined && !paged
      ? { openAsk: readMessageOf(asking.message, own) }
      : undefined),
    messages: page.messages.map((message) => readMessageOf(message, own)),
    ...(page.older && oldest !== undefined ? { older: oldest.id } : undefined),
  };
}

export function inboxRejected(reason: string): InboxRefused {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

/** The fields of an `answer` ask as the agent posts them, one variant per type. */
type PostedFields = NonNullable<
  Extract<InboxAskInput, { type: typeof INBOX_ASK.ANSWER }>["fields"]
>;

/** An answer's fields' own refusal: a label used twice, a select's option named twice, or a select's recommendation naming none of its options. */
function fieldsRefusal(fields: PostedFields): string | undefined {
  if (!distinct(fields.map((field) => field.label))) return INBOX_REFUSAL.FIELD_LABELS;

  for (const field of fields) {
    if (field.type !== INBOX_FIELD.SELECT) continue;

    if (!distinct(field.options)) return INBOX_REFUSAL.SELECT_OPTIONS;

    if (field.recommended !== undefined && !field.options.includes(field.recommended)) {
      return INBOX_REFUSAL.SELECT_RECOMMENDATION;
    }
  }

  return undefined;
}

/**
 * The first field of a post's answer that names options or a recommendation
 * though it is no select, read from the post as sent, since the post's read
 * drops a key a field's type does not take and would post it without them.
 */
function strayChoiceField(input: UnparsedWireValue): WireRecord | undefined {
  const ask = wireRecord(wireRecord(input)?.ask);
  const fields = ask?.type === INBOX_ASK.ANSWER ? ask.fields : undefined;

  if (!Array.isArray(fields)) return undefined;

  return fields
    .map(wireRecord)
    .find(
      (field) =>
        field !== undefined &&
        field.type !== INBOX_FIELD.SELECT &&
        ("options" in field || "recommended" in field),
    );
}

/** An ask's own refusal, before the store is asked: a decide's label used twice, a recommendation naming none, one twice, or several where one may be picked, or an answer's fields. */
function askRefusal(ask: InboxAskInput | undefined): string | undefined {
  switch (ask?.type) {
    case INBOX_ASK.DECIDE: {
      const labels = ask.options.map((option) => option.label);

      if (!distinct(labels)) return INBOX_REFUSAL.NO_OPTIONS;
      const media = ask.options.flatMap((option) => option.media ?? []);

      if (media.length > 0 && labels.includes(NONE_OF_THESE)) return INBOX_REFUSAL.NONE_OFFERED;
      const recommended = recommendedLabels(ask);

      if (!recommended.every((label) => labels.includes(label))) {
        return INBOX_REFUSAL.UNKNOWN_RECOMMENDATION;
      }

      if (!distinct(recommended) || (recommended.length > 1 && ask.multiple !== true)) {
        return INBOX_REFUSAL.SEVERAL_RECOMMENDED;
      }

      return undefined;
    }

    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? undefined : fieldsRefusal(ask.fields);
    default:
      return undefined;
  }
}

/** What the store's refusal of a post reads as to the model. */
function storeRefusal(refusal: InboxPostRefusal): string {
  switch (refusal) {
    case INBOX_POST_REFUSAL.NO_TITLE:
      return INBOX_REFUSAL.NO_TITLE;
    case INBOX_POST_REFUSAL.NO_AGENT:
      return INBOX_REFUSAL.NO_AGENT;
    case INBOX_POST_REFUSAL.NO_ADDRESSEE:
      return INBOX_REFUSAL.NO_ADDRESSEE;
    case INBOX_POST_REFUSAL.ADDRESSEE_CANNOT_SEE:
      return INBOX_REFUSAL.ADDRESSEE_CANNOT_SEE;
  }
}

/** The files a body names from the sandbox as the store takes them, and the body with the PDFs among them cut out of its words. */
interface BodyFiles {
  readonly body: string;
  readonly files: readonly InboxBodyPicture[];
}

/** The file a body names, read where it stands: a picture already kept in the workspace, copied (`inbox-kept-picture.ts`), or a file in the sandbox. */
function bodyFile(
  poster: ThreadPoster,
  path: string,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<InboxBodyPicture, string>, StoreFailure, DatabaseServices> {
  return Effect.flatMap(readKeptPicture(poster, path), (kept) =>
    kept !== undefined
      ? Effect.succeed(kept)
      : Effect.map(
          readSandboxBodyFile(sandbox, path, PICTURE_REFUSALS),
          Result.map((file) => ({ ...file, path, name: posix.basename(path) || path })),
        ),
  );
}

/**
 * The files the body names, each read under the destination it is written
 * by: a file of the sandbox named by its file's own name, or a picture
 * already kept in the workspace, copied; and the body with each PDF among
 * them cut out, since its message keeps it as a file it does not draw; or
 * the first refusal among them. Each is read once, the sandbox's in the
 * order first named and then the kept addresses, and the first refused
 * ends the reading, so a post with a file to mend reads no further file
 * for it.
 */
function bodyFiles(
  poster: ThreadPoster,
  body: string,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<BodyFiles, string>, StoreFailure, DatabaseServices> {
  const paths = [...inboxSandboxPicturePaths(body), ...keptAddressesIn(body)];

  if (paths.length > INBOX_BOUNDS.MAX_MESSAGE_PICTURES) {
    return Effect.succeed(Result.fail(INBOX_REFUSAL.TOO_MANY_PICTURES));
  }

  return Effect.gen(function* () {
    const read: InboxBodyPicture[] = [];

    for (const path of paths) {
      const file = yield* bodyFile(poster, path, sandbox);

      if (Result.isFailure(file)) return Result.fail(file.failure);
      read.push(file.success);
    }

    const pdfs = new Set(
      read.flatMap((file) => (file.contentType === INBOX_FILE_TYPE.PDF ? [file.path] : [])),
    );

    const words = pdfs.size === 0 ? body : withoutSandboxPictures(body, (path) => pdfs.has(path));

    return Result.succeed({ body: words, files: read });
  });
}

/** What a post's options carry as the store keeps them: each option's media by its place, and the files among them, under the ids those name. */
interface KeptOptionMedia {
  readonly media: readonly (readonly InboxOptionMedia[] | undefined)[];
  readonly files: readonly PostPicture[];
}

/**
 * One piece of an option's media as the store keeps it, or the refusal of
 * it: a file read from the sandbox as a body's picture is, under an id
 * minted for it; a page the agent showed on its task, at the version it
 * names; or the address as posted.
 */
function keptOptionMedia(
  agent: InboxAgent,
  posted: InboxPostOptionMedia,
  sandbox: InboxSandboxDoor,
): Effect.Effect<
  Result.Result<{ readonly media: InboxOptionMedia; readonly file?: PostPicture }, string>,
  never,
  DatabaseServices
> {
  if ("url" in posted) {
    const label = posted.label === undefined ? {} : { label: posted.label };

    return Effect.succeed(
      Result.succeed({ media: { type: INBOX_OPTION_MEDIA.LINK, url: posted.url, ...label } }),
    );
  }

  if ("page" in posted) return keptOptionPage(agent, posted.page, posted.version);
  const { path } = posted;

  return Effect.map(
    readSandboxMedia(sandbox, path, OPTION_FILE_REFUSALS),
    Result.map((read) => {
      const file = { ...read, id: randomUUID(), name: posix.basename(path) || path };
      const caption = posted.caption === undefined ? {} : { caption: posted.caption };

      const media = {
        type: INBOX_OPTION_MEDIA.FILE,
        attachmentId: file.id,
        mediaType: file.contentType,
        ...caption,
      };

      return { media, file };
    }),
  );
}

/** A page an option names as the store keeps it: one shown on the agent's own task, at the version named; refused where the agent's account reaches no such page or version there. */
function keptOptionPage(
  agent: InboxAgent,
  pageId: string,
  version: number,
): Effect.Effect<
  Result.Result<{ readonly media: InboxOptionMedia }, string>,
  never,
  DatabaseServices
> {
  return readPageById(agent.userId, pageId, version).pipe(
    Effect.map((found) => {
      if (Option.isNone(found)) return Result.fail(INBOX_REFUSAL.NO_PAGE);
      const { taskId, page } = found.value;

      if (taskId !== agent.taskId) return Result.fail(INBOX_REFUSAL.NO_PAGE);

      return Result.succeed({
        media: {
          type: INBOX_OPTION_MEDIA.PAGE,
          pageId: page.id,
          version: page.version,
          title: page.title,
          place: { taskId },
        },
      });
    }),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(Result.fail(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * What a post's options carry, read and kept, or the first refusal among
 * them: every piece in order, option by option, the first refused ending
 * the reading, as a body's pictures are read. A post whose ask is no
 * `decide`, or whose options carry nothing, keeps none.
 */
function optionMedia(
  agent: InboxAgent,
  ask: InboxAskInput | undefined,
  bodyPictures: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<KeptOptionMedia, string>, never, DatabaseServices> {
  if (ask?.type !== INBOX_ASK.DECIDE)
    return Effect.succeed(Result.succeed({ media: [], files: [] }));
  const posted = ask.options.map((option) => option.media ?? []);

  if (bodyPictures + posted.flat().length > INBOX_BOUNDS.MAX_ASK_MEDIA) {
    return Effect.succeed(Result.fail(INBOX_REFUSAL.TOO_MUCH_MEDIA));
  }

  return Effect.gen(function* () {
    const media: (readonly InboxOptionMedia[] | undefined)[] = [];
    const kept: PostPicture[] = [];

    for (const pieces of posted) {
      const own: InboxOptionMedia[] = [];

      for (const piece of pieces) {
        const read = yield* keptOptionMedia(agent, piece, sandbox);

        if (Result.isFailure(read)) return Result.fail(read.failure);
        own.push(read.success.media);

        if (read.success.file !== undefined) kept.push(read.success.file);
      }

      media.push(own.length === 0 ? undefined : own);
    }

    return Result.succeed({ media, files: kept });
  });
}

/** Whom a post waits on, as the store takes it: the member's account, absent on a reply to a thread addressed to nobody. */
interface ThreadPlace {
  readonly addresseeId?: string;
}

/**
 * The post as the store writes it: its key, title, words, and ask as a
 * message keeps it, and whom it waits on. Note that the agent hears the answer
 * to every ask as a message, a `do`'s as a decision's, since an agent whose
 * turn has ended reads nothing kept for it until something wakes it, and
 * goes on telling the developer it waits on what they already answered.
 */
function threadPost(post: InboxThreadPostInput, place: ThreadPlace, options: KeptOptionMedia) {
  const { ask, to: _to, ...written } = post;

  if (ask === undefined) return { ...written, ...place };

  return { ...written, ...place, ask: keptInboxAsk(ask, options.media), needsReply: true };
}

/** The member a post's `to` names by their mention link written whole, or its address alone, by account; nothing where it names no person, such as an agent or a task. */
function addresseeOf(to: string): string | undefined {
  const [link] = mentionLinksIn(to);
  const whole = link !== undefined && link.start === 0 && link.end === to.length;
  const mention = decodeMention(whole ? link.target : to, null);

  return mention?.kind === MENTION_KIND.PERSON ? mention.userId : undefined;
}

/**
 * Whom a post waits on, or why it is refused: the member its mention link
 * names, refused where it names no person; or, where it names none, the
 * member the thread under its key was addressed to, kept as it stands, and
 * refused where no thread stands under the key, since a first post names
 * whom it waits on. Note that whether that person is of the workspace is the
 * store's to say, under the lock it writes the post under (`postInboxThread`).
 */
function placeOf(
  agent: InboxAgent,
  post: InboxThreadPostInput,
): InboxStoreEffect<Result.Result<ThreadPlace, string>> {
  if (post.to !== undefined) {
    const addresseeId = addresseeOf(post.to.trim());

    return Effect.succeed(
      addresseeId === undefined
        ? Result.fail(INBOX_REFUSAL.NO_MEMBER)
        : Result.succeed({ addresseeId }),
    );
  }

  return Effect.map(agentInboxItemOfKey(agent, post.key), (standing) => {
    if (Option.isNone(standing)) return Result.fail(INBOX_REFUSAL.NO_ADDRESSEE_NAMED);
    const { addressed, waitsOn } = standing.value;

    return Result.succeed(
      addressed === true && waitsOn !== undefined ? { addresseeId: waitsOn.userId } : {},
    );
  });
}

/** Runs one post: whom it waits on, its pictures and PDFs read from the sandbox, the message written on the thread under its key, and the agent's threads answered, or why not. */
export function postToInbox(
  agent: ThreadPoster,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<InboxWriteResult, never, DatabaseServices> {
  const read = readPost(input);

  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const post = read.success;

  if (post.body.trim() === "") return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const stray = strayChoiceField(input);

  if (stray !== undefined) {
    const label = isWireString(stray.label) ? stray.label : "";
    const type = isWireString(stray.type) ? stray.type : "untyped";

    return Effect.succeed(inboxRejected(INBOX_REFUSAL.NOT_SELECT(label, type)));
  }

  const refused = askRefusal(post.ask);

  if (refused !== undefined) return Effect.succeed(inboxRejected(refused));
  const unread = placeholderLinksIn(post.body);

  if (unread.length > 0) {
    return Effect.succeed(inboxRejected(`Not posted: ${placeholderLinksWords(unread)}`));
  }

  return Effect.gen(function* () {
    // A place refused is said before any picture is read, since mending it reads them again.
    const place = yield* placeOf(agent, post);

    if (Result.isFailure(place)) return inboxRejected(place.failure);
    const named = yield* bodyFiles(agent, post.body, sandbox);

    if (Result.isFailure(named)) return inboxRejected(named.failure);
    const { body, files } = named.success;
    const options = yield* optionMedia(agent, post.ask, files.length, sandbox);

    if (Result.isFailure(options)) return inboxRejected(options.failure);

    const thread = threadPost({ ...post, body }, place.success, options.success);
    const posted = yield* postInboxThread(agent, thread, files, options.success.files);

    if (Result.isFailure(posted)) return inboxRejected(storeRefusal(posted.failure));
    const { taskId } = agent;

    // Note that a thread on no task is not pushed, since a released iPhone opens an alert on its task.
    if (taskId !== null) {
      yield* afterResponse(
        "a thread's push",
        pushThreadPost({ item: posted.success, asked: post.ask !== undefined, taskId }),
      );
    }

    return yield* written(agent, posted.success);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** How a settled thread's ask was settled, in the words the model reads: answered, or closed by a member, or withdrawn with why. */
function settledNote(item: InboxItem): string {
  if (item.status === INBOX_STATUS.ANSWERED) {
    return ALREADY_SETTLED.ANSWERED(item.answeredBy?.name ?? "a former member");
  }

  const { closedBy } = closerOf(item);

  if (closedBy !== undefined) return ALREADY_SETTLED.CLOSED(closedBy);

  return ALREADY_SETTLED.WITHDRAWN(item.closedReason ?? "");
}

/**
 * A withdrawal that closed nothing, answered by what stands under the key.
 * Note that a thread whose ask was settled first, answered or closed or
 * withdrawn before, is answered as taken with how, because the agent's
 * intent already holds and a refusal would only cost it a step; only a key
 * with no thread, or a notice, which asks nothing, is refused.
 */
function notWithdrawn(agent: InboxAgent, key: string): InboxStoreEffect<InboxWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* agentInboxItemOfKey(agent, key);

    if (Option.isNone(standing)) return inboxRejected(INBOX_REFUSAL.NO_KEYED_THREAD);
    const item = standing.value;

    if (item.status === INBOX_STATUS.OPEN) return inboxRejected(INBOX_REFUSAL.NO_OPEN_ASK);

    return yield* written(agent, item, settledNote(item));
  });
}

/** Runs one withdrawal: the open ask of the thread under the key withdrawn with why, and the agent's inbox answered, or why not. */
export function withdrawAsk(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxWriteResult, never, DatabaseServices> {
  const read = readWithdraw(input);

  if (Result.isFailure(read)) {
    return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_WITHDRAW));
  }

  const { key, reason } = read.success;

  return Effect.gen(function* () {
    const withdrawn = yield* closeInboxItem(agent, key, reason);

    if (Option.isNone(withdrawn)) return yield* notWithdrawn(agent, key);
    yield* afterResponse("a withdrawn thread's push", pushThreadSettled(withdrawn.value.id));

    return yield* written(agent, withdrawn.value);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** A list's or a read's store failure as the tool's own refusal. */
function orUnavailable<A>(
  read: InboxStoreEffect<A | InboxRefused>,
): Effect.Effect<A | InboxRefused, never, DatabaseServices> {
  return read.pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** A list's answer: its threads one line each, as the agent reads them. */
function listedOf(read: readonly InboxItem[], agent: ThreadPoster): InboxListResult {
  return { status: ACTION_RESULT_STATUS.ACCEPTED, threads: rowsOf(read, agent.agentId) };
}

/**
 * Lists threads as the agent, one line each, of the agent or task its input
 * names: its own, by its own agentId, or one other agent's or one task's of
 * its own workspace, as the member it acts for may read them, which it may
 * read and never write; only those standing where status names, where it
 * names one.
 */
export function listThreads(
  agent: ThreadPoster,
  input: UnparsedWireValue,
): Effect.Effect<InboxListResult, never, DatabaseServices> {
  const asked = readList(input);

  if (Result.isFailure(asked)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_LIST));
  const { of, status } = asked.success;
  const reader = { userId: agent.userId, workspaceId: agent.organizationId };

  return orUnavailable(
    Effect.gen(function* () {
      if ("agentId" in of && of.agentId === agent.agentId) {
        return listedOf(yield* agentInboxItems(agent, status), agent);
      }

      if ("agentId" in of) {
        return listedOf(yield* agentReachedInboxItems(reader, of, status), agent);
      }

      // A task named by its key is read in the agent's workspace alone.
      const task = yield* taskIdOfInput(
        agent.userId,
        agent.organizationId,
        { opening: "Not listed", field: "of.taskId" },
        of.taskId,
      );

      if (Result.isFailure(task)) return inboxRejected(task.failure);

      return listedOf(
        yield* agentReachedInboxItems(reader, { taskId: task.success }, status),
        agent,
      );
    }),
  );
}

/**
 * Reads one thread as the agent, whole: its own, or another agent's or a
 * task's of its own workspace, as the member it acts for may read it, a
 * page of its messages at a time, the latest first; refused for a thread of
 * another workspace, as for one that does not exist.
 */
export function readThread(
  agent: ThreadPoster,
  input: UnparsedWireValue,
): Effect.Effect<InboxReadResult, never, DatabaseServices> {
  const asked = readThreadAsked(input);

  if (Result.isFailure(asked)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_READ));
  const { threadId, before } = asked.success;

  return orUnavailable(
    Effect.gen(function* () {
      const home = yield* readInboxItemHome(agent.userId, threadId);

      if (Option.isNone(home) || home.value.workspaceId !== agent.organizationId) {
        return inboxRejected(INBOX_REFUSAL.NO_THREAD);
      }

      const [stored, page] = yield* Effect.all(
        [readInboxItem(agent.userId, threadId), inboxThreadPage(agent.userId, threadId, before)],
        { concurrency: 2 },
      );

      if (Option.isNone(stored) || Option.isNone(page))
        return inboxRejected(INBOX_REFUSAL.NO_THREAD);

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        thread: threadReadOf(stored.value.item, page.value, agent.agentId, before === undefined),
      };
    }),
  );
}
