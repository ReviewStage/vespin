import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { DatabaseServices } from "@repo/database/core/query";
import { readPageById } from "@repo/database/models/task-pages";
import { inboxSandboxPicturePaths } from "@repo/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_CLOSE_LEAD,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_OPTION_MEDIA,
  INBOX_STATUS,
  INBOX_TOOL,
  type InboxAnswers,
  type InboxAskInput,
  type InboxField,
  type InboxItem,
  type InboxMessage,
  type InboxOptionMedia,
  type InboxPostOptionMedia,
  type InboxReadAsk,
  type InboxThreadPostInput,
  inboxReadInputSchema,
  inboxThreadPostInputSchema,
  inboxWithdrawInputSchema,
  keptInboxAsk,
  NONE_OF_THESE,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import { decodeMention, MENTION_KIND, mentionLinksIn } from "@repo/features/mention-link";
import { PAGE_OWNER, type PageOwner, type PagePlace } from "@repo/features/page-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result } from "effect";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";
import { afterResponse } from "../../http/after-response.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  agentInboxItems,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxBodyPicture,
  type InboxPostRefusal,
  type PostPicture,
  postInboxThread,
} from "../../inbox/inbox-store.js";
import { pushThreadPost, pushThreadSettled } from "../../push/inbox-pushes.js";
import { dmThreadPost, settleThreadDms, threadStandsOpen } from "../../slack/thread-dms.js";
import { CODER } from "./bounds.js";
import {
  type InboxSandboxDoor,
  readSandboxMedia,
  type SandboxImageRefusals,
} from "./inbox-image.js";

/**
 * inbox.ts -- the coding agent's thread tools: post a message on a thread in the inbox, withdraw a thread's open ask, and read every thread back.
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
 * of the message, writing its address in the path's place; a file that is
 * not there, not an image, or past the bound refuses the whole post with
 * the path named. A post that asks nothing is a note, or the agent's reply
 * on the thread, since replying never answers: a member's message on the
 * thread reaches the agent as one of the developer's messages, and so does
 * an answer it waits on. No call holds the turn, since a coder session
 * takes no input mid-turn.
 * Every call answers with the agent's whole inbox as it stands, each
 * thread's messages in order with their asks and answers, so the model
 * holds its threads whatever its context has lost to compaction. A worker
 * gets none of these tools, because the developer answers the agent it
 * works for.
 */

/** The inbox's picture bound in megabytes, as the words the model reads say it. */
const MAX_PICTURE_MB = (INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000).toFixed(1);

/** The inbox's video bound in megabytes, as the words the model reads say it. */
const MAX_VIDEO_MB = (INBOX_BOUNDS.MAX_VIDEO_BYTES / 1_000_000).toFixed(1);

const POST_THREAD_WORDS =
  "Post a message on a thread in the inbox, apart from your transcript. " +
  "Each post is one message on a thread under key, your own short lowercase slug such as branch-protection. " +
  "The first post under a key opens its thread and must name its title; a later post under the same key adds a message to that thread, never a second one, " +
  "and a title it names renames the thread only where the post asks. " +
  "to is the member the thread's ask is addressed to, by their mention link, the [@Name](link) you name a member by, and the ask waits on them; " +
  "without it, it waits on the task's assignee, or on the developer who started you. " +
  `body is the message, one Markdown body of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters. ` +
  `Write a file, a pull request, or an issue in it as a mention, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so ${PRODUCT_NAME} draws it as a chip. ` +
  "Put a link alone on its own line to show it as a card: a pull request, an issue, a page such as the GitHub settings page a to-do is done on, " +
  "or the exact lines a decision is about, as a blob link into your repository at the full 40-character commit you read them at, one already on GitHub, " +
  `ending #L<start>-L<end>, at most ${INBOX_BOUNDS.MAX_CODE_LINES} lines, which they see as GitHub holds them at that commit. ` +
  "Each link alone on its line is a card of its own, so give a thing one: its mention alone on its line is its card, never followed by its bare address. " +
  `Draw a picture where it belongs, such as a screenshot of a UI you rendered, as ![alt](<path> "caption"): path is the file's path in your sandbox, ` +
  `relative to the checkout or absolute, a PNG, JPEG, or WebP of at most ${MAX_PICTURE_MB} MB, or a WebM video of at most ${MAX_VIDEO_MB} MB, such as a recording of a flow, which plays there, ` +
  `at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} a message; ` +
  "alt says in a sentence what it shows, and pictures written next to each other stand side by side. " +
  "A picture the message is about is drawn in it, never pointed at in a transcript, yours or another agent's, which the thread's reader does not see. " +
  "ask is what the message asks of them, which ends it: " +
  `decide (two to ${INBOX_BOUNDS.MAX_OPTIONS} options, each a short label and an optional detail; name the label you recommend; multiple lets them pick several, and recommended then takes a list of the labels you recommend; ` +
  `where they pick between designs or variants, give each option its own media, at most ${INBOX_BOUNDS.MAX_OPTION_MEDIA}, which they look at on its card: ` +
  "a file in your sandbox as {path, caption}, a picture or a recording as a body's picture is, a page you showed with show_page as {page} by the id it answered, " +
  `or an https address to open, such as a preview, as {url, label}; at most ${INBOX_BOUNDS.MAX_ASK_MEDIA} across the options, the message's own pictures counted; ` +
  "an option's extra screens go in its own media, never an option of their own; " +
  `options with media also offer "${NONE_OF_THESE}", which you never offer yourself, and an answer of none reaches you as "Chose ${NONE_OF_THESE.toLowerCase()}."; ` +
  "for a go-ahead on one step you propose, two short options such as Approve and Request changes), " +
  "do (a to-do: something only they can do by hand, such as changing a GitHub setting, adding a secret, or testing by hand what you could not test yourself; " +
  `its steps, at most ${INBOX_BOUNDS.MAX_STEPS}, say exactly what to do, a command to run in a fenced block in its step, after the words saying where to run it, which they copy whole, and they tick each before they mark it done, or say they couldn't), ` +
  `or answer (one to ${INBOX_BOUNDS.MAX_FIELDS} typed fields, text, number, select with its options and the one you recommend, or boolean, each named by its label and required where it must be filled; ` +
  "or no fields for an answer in their own words); a text field takes one exact value they type, such as an ID, a name, an address, or a price, " +
  "never a description of what they saw or think, anything else to add, or the numbers of options to pick, because the reply box under every ask already takes their words: " +
  `offer up to ${INBOX_BOUNDS.MAX_OPTIONS} options as a decide, multiple where several may be picked, and ask for picks among more as an answer in their own words; ` +
  "never ask for a credential or a secret in a form, since the answer reaches your transcript: " +
  "that is a do the developer does by hand. A post without ask asks nothing: something they should only know, or your reply on the thread. " +
  "It waits until they acknowledge it, which never reaches you unless they write something. " +
  "A thread holds one open ask, and a newer ask replaces it. " +
  "An answer to any ask, decide, do, or answer, always reaches you as a message. " +
  "The call answers with your threads as they stand.";

/** The tools as the model is shown them (`../tool-catalog/catalog.ts`): each one's name, words, and input. */
export const INBOX_TOOLS = {
  POST: {
    name: INBOX_TOOL.POST,
    description: POST_THREAD_WORDS,
    inputSchema: inboxThreadPostInputSchema,
  },
  WITHDRAW: {
    name: INBOX_TOOL.WITHDRAW,
    description:
      "Withdraw the open ask of one of your threads, by its key, with why: you no longer need it, you found the answer yourself, " +
      "or you checked that the to-do is done. The thread and its messages stay; refused where it holds no open ask, such as one already answered. " +
      "The call answers with your threads as they stand.",
    inputSchema: inboxWithdrawInputSchema,
  },
  READ: {
    name: INBOX_TOOL.READ,
    description:
      "Read your threads as they stand now: every one still asking, whole, and the latest settled ones by their last messages and their latest ask and answer; " +
      `a thread longer than ${INBOX_BOUNDS.MAX_MESSAGES_READ} messages reads its first, its open ask, and its latest ${INBOX_BOUNDS.MAX_MESSAGES_READ}. ` +
      "Each message reads in order with who wrote it, you or a member by name and fromUserId, which their link names them by, the ask it ends with and where that stands " +
      "(open, answered, replaced by a newer ask, or withdrawn, with your reason), and the answer a member's message carries. " +
      "A member may close a thread without answering, which withdraws its ask with no reason, and closedBy and closedByUserId name them; " +
      `where it held an ask open, that reaches you as a developer's message whose first line starts "${INBOX_CLOSE_LEAD}" and names the key: ` +
      "take it as their not wanting what the ask asked.",
    inputSchema: inboxReadInputSchema,
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

/** One thread as the agent reads it back: its key, its id, which its link names it by, its title, where it stands, and its messages in order. */
interface AgentInboxLine {
  readonly key: string;
  readonly id: string;
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

/** What a call answers, as the model reads it: the agent's inbox as it stands, or why the call did nothing beside it. */
export type InboxToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly inbox: readonly AgentInboxLine[];
    }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
      readonly reason: string;
      readonly inbox?: readonly AgentInboxLine[];
    };

/** Why a call did nothing, in the words the model reads. */
export const INBOX_REFUSAL = {
  UNREADABLE_POST:
    "Not posted: the post does not read. key is a lowercase slug of letters, digits, dots, dashes, and underscores; " +
    `body is Markdown of at most ${INBOX_BOUNDS.MAX_MESSAGE_CHARS} characters; title is one line of at most ${INBOX_BOUNDS.MAX_TITLE_CHARS}; ` +
    `ask is decide with two to ${INBOX_BOUNDS.MAX_OPTIONS} options, do with at most ${INBOX_BOUNDS.MAX_STEPS} steps, ` +
    `or answer with one to ${INBOX_BOUNDS.MAX_FIELDS} fields or none.`,
  NO_TITLE:
    "Not posted: you have no thread under that key, and the first post under a key names its title.",
  TOO_MANY_PICTURES: `Not posted: a message draws at most ${INBOX_BOUNDS.MAX_MESSAGE_PICTURES} pictures from your sandbox.`,
  NO_OPTIONS: "Not posted: a decide's options each stand under a label of their own.",
  NONE_OFFERED: `Not posted: an option carrying media may not be labeled "${NONE_OF_THESE}", which the reader is offered beside your options already.`,
  TOO_MUCH_MEDIA: `Not posted: a decide's options carry at most ${INBOX_BOUNDS.MAX_ASK_MEDIA} pieces of media between them, and a message keeps at most ${INBOX_BOUNDS.MAX_ASK_MEDIA} files, its own pictures and its options' together.`,
  NO_PAGE:
    "Not posted: an option names a page you did not show on this task; name a page by the id show_page answered.",
  UNKNOWN_RECOMMENDATION: "Not posted: recommended names a label no option has.",
  SEVERAL_RECOMMENDED:
    "Not posted: recommended names each label once, and several only where multiple lets them pick several.",
  FIELD_LABELS: "Not posted: an answer names each field by a label of its own.",
  SELECT_OPTIONS:
    "Not posted: a select field offers its options, each once, and no other field offers options.",
  SELECT_RECOMMENDATION:
    "Not posted: a select field's recommended names one of its options, and no other field recommends one.",
  UNREADABLE_WITHDRAW: "Not withdrawn: name the thread's key and why you withdraw its ask.",
  NO_OPEN_ASK: "Not withdrawn: you have no thread under that key with an open ask.",
  NO_MEMBER:
    "Not posted: to names no member; write a member of your workspace by their mention link, [@Name](link), as a person's chip is written.",
  NO_ADDRESSEE: "Not posted: the member you addressed is not in your workspace.",
  ADDRESSEE_CANNOT_SEE:
    "Not posted: the member you addressed cannot see your task, so they would never see the thread; address someone who can, or leave to out.",
  NO_AGENT: "Not done: this conversation is no agent's.",
  UNAVAILABLE: "Not done: the service could not reach its store.",
} as const;

/** How many of a settled thread's latest messages its read carries: enough to see what came of it. */
const SETTLED_MESSAGES_TOLD = 3;

const readPost = readEither(inboxThreadPostInputSchema, { excess: EXCESS_KEYS.DROP });
const readWithdraw = readEither(inboxWithdrawInputSchema, { excess: EXCESS_KEYS.DROP });

/** Why a post's picture was not read from the sandbox, in a post's own words; each is followed by the path. */
const PICTURE_REFUSALS: SandboxImageRefusals = {
  NO_FILE: "Not posted: a picture names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not posted: a picture names a file larger than ${MAX_PICTURE_MB} MB, or a video larger than ${MAX_VIDEO_MB} MB; render it smaller, or record a shorter flow:`,
  UNREADABLE: "Not posted: a picture's file could not be read from your sandbox:",
};

/** Why an option's file was not read from the sandbox, in a post's own words; each is followed by the path. */
const OPTION_FILE_REFUSALS: SandboxImageRefusals = {
  NO_FILE: "Not posted: an option's media names no file in your sandbox:",
  NOT_IMAGE:
    "Not posted: an option's media names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not posted: an option's media names a file larger than ${MAX_PICTURE_MB} MB, or a video larger than ${MAX_VIDEO_MB} MB; render it smaller, or record a shorter flow:`,
  UNREADABLE: "Not posted: an option's media file could not be read from your sandbox:",
};

/** Who wrote a message, as the agent reads it: itself, or the member by name, or a former member whose account is gone. */
function writerOf(message: InboxMessage): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "you";
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
 * A thread as the agent reads it back. Note that one still asking carries
 * its messages whole, as the read holds them, because compaction may have
 * taken the call that posted its ask out of the model's context and the
 * agent still acts on it; a settled one carries what `settledMessages`
 * keeps, and how many it leaves out.
 */
function lineOf(item: InboxItem): AgentInboxLine {
  const messages = item.thread ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : settledMessages(messages);
  const earlier = messages.length - told.length;
  return {
    key: item.key,
    id: item.id,
    title: item.title,
    status: item.status,
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map((message) => threadLineOf(message, writerOf(message))),
    ...closerOf(item),
    ...settlementOf(item, messages),
  };
}

/**
 * The agent's inbox as it reads it: what is open first, then what was
 * answered, then what was closed, each the latest changed first. Note that
 * closed threads are read last, because they are settled without an answer
 * and the open and answered ones are what it acts on.
 */
function inboxOf(items: readonly InboxItem[]): readonly AgentInboxLine[] {
  const order = [INBOX_STATUS.OPEN, INBOX_STATUS.ANSWERED, INBOX_STATUS.CLOSED];
  return order.flatMap((status) => items.filter((item) => item.status === status).map(lineOf));
}

/** The agent's inbox as the call answers it. */
function accepted(agent: InboxAgent): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return agentInboxItems(agent).pipe(
    Effect.map((items) => ({ status: ACTION_RESULT_STATUS.ACCEPTED, inbox: inboxOf(items) })),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

export function inboxRejected(reason: string): InboxToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

/** An answer's fields' own refusal: a label used twice, a select with no options or one twice, options on a field that takes none, or a recommendation naming none of a select's options. */
function fieldsRefusal(fields: readonly InboxField[]): string | undefined {
  if (!distinct(fields.map((field) => field.label))) return INBOX_REFUSAL.FIELD_LABELS;
  for (const field of fields) {
    const options = field.options;
    const select = field.type === INBOX_FIELD.SELECT;
    if (select ? options === undefined || !distinct(options) : options !== undefined) {
      return INBOX_REFUSAL.SELECT_OPTIONS;
    }
    if (
      field.recommended !== undefined &&
      !(select && options?.includes(field.recommended) === true)
    ) {
      return INBOX_REFUSAL.SELECT_RECOMMENDATION;
    }
  }
  return undefined;
}

/** An ask's own refusal, before the store is asked: a decide's label used twice, a recommendation naming none, one twice, or several where one may be picked, or an answer's fields. */
function askRefusal(ask: InboxAskInput | undefined): string | undefined {
  switch (ask?.type) {
    case INBOX_ASK.DECIDE: {
      const labels = ask.options.map((option) => option.label);
      if (!distinct(labels)) return INBOX_REFUSAL.NO_OPTIONS;
      const media = ask.options.flatMap((option) => option.media ?? []);
      if (media.length > 0 && labels.includes(NONE_OF_THESE)) return INBOX_REFUSAL.NONE_OFFERED;
      if (media.length > INBOX_BOUNDS.MAX_ASK_MEDIA) return INBOX_REFUSAL.TOO_MUCH_MEDIA;
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

/**
 * The pictures the body draws from the sandbox, each read there under the
 * path it is written by and named by its file's own name, or the first
 * refusal among them. Each path is read once, in the order first drawn,
 * and the first path refused ends the reading, so a post with a picture to
 * mend reads no further file for it.
 */
function bodyPictures(
  body: string,
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<readonly InboxBodyPicture[], string>> {
  const paths = inboxSandboxPicturePaths(body);
  if (paths.length > INBOX_BOUNDS.MAX_MESSAGE_PICTURES) {
    return Effect.succeed(Result.fail(INBOX_REFUSAL.TOO_MANY_PICTURES));
  }
  return Effect.gen(function* () {
    const read: InboxBodyPicture[] = [];
    for (const path of paths) {
      const image = yield* readSandboxMedia(sandbox, CODER.CHECKOUT_PATH, path, PICTURE_REFUSALS);
      if (Result.isFailure(image)) return Result.fail(image.failure);
      read.push({ ...image.success, path, name: posix.basename(path) || path });
    }
    return Result.succeed(read);
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
 * stands at now; or the address as posted.
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
  if ("page" in posted) return keptOptionPage(agent, posted.page);
  const { path } = posted;
  return Effect.map(
    readSandboxMedia(sandbox, CODER.CHECKOUT_PATH, path, OPTION_FILE_REFUSALS),
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

/** Where a page stands as a reader names it, where it is the agent's own: on its task, or on the agent itself; nothing for any other. */
function ownPagePlace(agent: InboxAgent, owner: PageOwner): PagePlace | undefined {
  if (owner.kind === PAGE_OWNER.TASK) {
    return owner.taskId === agent.taskId ? { taskId: owner.taskId } : undefined;
  }
  return owner.agentId === agent.agentId ? { agentId: owner.agentId } : undefined;
}

/** A page an option names as the store keeps it: one shown on the agent's task, at its newest version; refused where the agent's account reaches none there. */
function keptOptionPage(
  agent: InboxAgent,
  pageId: string,
): Effect.Effect<
  Result.Result<{ readonly media: InboxOptionMedia }, string>,
  never,
  DatabaseServices
> {
  return readPageById(agent.userId, pageId, undefined).pipe(
    Effect.map((found) => {
      if (Option.isNone(found)) return Result.fail(INBOX_REFUSAL.NO_PAGE);
      const { owner, page } = found.value;
      const place = ownPagePlace(agent, owner);
      if (place === undefined) return Result.fail(INBOX_REFUSAL.NO_PAGE);
      return Result.succeed({
        media: {
          type: INBOX_OPTION_MEDIA.PAGE,
          pageId: page.id,
          version: page.version,
          title: page.title,
          place,
        },
      });
    }),
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
  const files = posted.flat().filter((media) => "path" in media).length;
  if (bodyPictures + files > INBOX_BOUNDS.MAX_ASK_MEDIA) {
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

/** Whom a post waits on, as the store takes it: the member's account, absent where the post names none. */
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
 * names, refused where it names no person. Note that whether that person is
 * of the workspace is the store's to say, under the lock it writes the post
 * under (`postInboxThread`).
 */
function placeOf(post: InboxThreadPostInput): Result.Result<ThreadPlace, string> {
  if (post.to === undefined) return Result.succeed({});
  const addresseeId = addresseeOf(post.to.trim());
  return addresseeId === undefined
    ? Result.fail(INBOX_REFUSAL.NO_MEMBER)
    : Result.succeed({ addresseeId });
}

/** Runs one post: whom it waits on, its pictures read from the sandbox, the message written on the thread under its key, and the agent's threads answered, or why not. */
export function postToInbox(
  agent: ThreadPoster,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readPost(input);
  if (Result.isFailure(read)) return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const post = read.success;
  if (post.body.trim() === "") return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_POST));
  const refused = askRefusal(post.ask);
  if (refused !== undefined) return Effect.succeed(inboxRejected(refused));
  // A place refused is said before any picture is read, since mending it reads them again.
  const place = placeOf(post);
  if (Result.isFailure(place)) return Effect.succeed(inboxRejected(place.failure));
  return Effect.gen(function* () {
    const pictures = yield* bodyPictures(post.body, sandbox);
    if (Result.isFailure(pictures)) return inboxRejected(pictures.failure);
    const options = yield* optionMedia(agent, post.ask, pictures.success.length, sandbox);
    if (Result.isFailure(options)) return inboxRejected(options.failure);
    const thread = threadPost(post, place.success, options.success);
    const wasOpen = yield* threadStandsOpen(agent, thread.key);
    const posted = yield* postInboxThread(agent, thread, pictures.success, options.success.files);
    if (Result.isFailure(posted)) return inboxRejected(storeRefusal(posted.failure));
    const { organizationId } = agent;
    yield* afterResponse(
      "a thread's Slack DM",
      dmThreadPost({
        organizationId,
        item: posted.success,
        asked: post.ask !== undefined,
        wasOpen,
      }),
    );
    yield* afterResponse(
      "a thread's push",
      pushThreadPost({ item: posted.success, asked: post.ask !== undefined, taskId: agent.taskId }),
    );
    return yield* accepted(agent);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one withdrawal: the open ask of the thread under the key withdrawn with why, and the agent's inbox answered, or why not. */
export function withdrawAsk(
  agent: InboxAgent,
  input: UnparsedWireValue,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  const read = readWithdraw(input);
  if (Result.isFailure(read)) {
    return Effect.succeed(inboxRejected(INBOX_REFUSAL.UNREADABLE_WITHDRAW));
  }
  const { key, reason } = read.success;
  return Effect.gen(function* () {
    const withdrawn = yield* closeInboxItem(agent, key, reason);
    if (Option.isNone(withdrawn)) return inboxRejected(INBOX_REFUSAL.NO_OPEN_ASK);
    yield* afterResponse("a withdrawn thread's Slack DM", settleThreadDms(withdrawn.value.id));
    yield* afterResponse("a withdrawn thread's push", pushThreadSettled(withdrawn.value.id));
    return yield* accepted(agent);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

export function readOwnInbox(
  agent: InboxAgent,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return accepted(agent);
}
