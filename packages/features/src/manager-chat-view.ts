/**
 * manager-chat-view.ts -- a Manager's chat as a page draws it from its rows: its messages oldest first, each placed in its sender's run, and the work of each of the Manager's turns a press away.
 *
 * A Manager's chat is its own rows (`manager-chat-live.ts`), which a page
 * reads newest first and draws oldest first. A page with no thread view
 * draws every row in its `seq`'s place (`messages`); a channel draws its
 * top, each message that is no reply and each reply posted to the chat too
 * (`broadcast`), and opens each reply's root's thread beside it (`top`,
 * `threads`). Consecutive messages of
 * one sender, the Manager or one person, none further from the one before
 * than `CHAT_RUN_GAP_MS`, are one run, within the chat's top or within one
 * thread, which a page draws under one head (`ChatRunPlace`). The reader's
 * messages on their way stand after the rows of their scope, the chat's top
 * or their thread, each placed by the same rule from what its row will
 * carry (its sender and when it was sent), so a message drawn on its way
 * stands in the run its row lands in.
 *
 * The chat is the conversation; what the Manager did to say it is its
 * transcript, the work under it, and the two meet only by turn: each of the
 * Manager's messages names the turn it was sent in, and a turn's journal in
 * the transcript stands under the turn's own id. A turn's work is all its
 * journal holds but what the chat already draws: its step boundaries, the
 * lines that reached it, and the messages and sets it sent. A turn that
 * has ended keeps its work folded over the Manager's first message of the
 * turn, words or a set, in the order it was done, as a chat app stands what
 * it thought over its answer; the turn under way's work opens under the
 * working line instead, so a finished chat draws no more than its messages
 * and its folds.
 */

import { AGENT_PART, type AgentPart, agentParts, isShownSet } from "./agent-parts.js";
import { isChatSendTool } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import {
  isOfferedReaction,
  MANAGER_CHAT_AUTHOR,
  MANAGER_CHAT_REACTION,
  type ManagerChatLiveMessage,
  type ManagerChatReaction,
  type ManagerChatReactionCount,
} from "./manager-chat-live.js";
import { isAgentTurn } from "./voice-call-lines.js";
import { countWords } from "./words.js";

/** The longest pause, in milliseconds, between two messages of one sender that still stand in one run. */
const CHAT_RUN_GAP_MS = 10 * 60 * 1000;

/** What Show work says beside a message or in its menu, by whether its work stands open under it. */
const CHAT_WORK_WORDS = {
  SHOW: "Show work",
  HIDE: "Hide work",
} as const;

/** The words of a thread's presses, its box, and its page, on every client: Reply in thread on a message, the box that answers in it, and the page it stands on. */
export const CHAT_THREAD_WORDS = {
  REPLY: "Reply in thread",
  BOX: "Reply…",
  /** What a thread's own page is called. */
  TITLE: "Thread",
  /** What a thread's page says once the message it hung on is gone from the chat, as a rewind drops it. */
  GONE: "This thread is no longer in the chat.",
} as const;

/** What the rule over the first message after the reader's mark of the chat says, on every client, as Slack's New line does. */
export const CHAT_NEW_WORDS = "New";

/** What a thread's replies are counted in. */
const REPLY_NOUN = { one: "reply", many: "replies" } as const;

/** Where a message stands in its sender's run: whether it opens it, under its sender's name where one is drawn, and whether it closes it, over the run's one time. */
export interface ChatRunPlace {
  readonly opens: boolean;
  readonly closes: boolean;
}

/** One message of the chat as a page draws it: the row, where it stands in its run, and the turn whose work it opens, where it opens one. */
export interface ManagerChatLine {
  readonly message: ManagerChatLiveMessage;
  readonly place: ChatRunPlace;
  /** The turn whose work stands folded over the message: set on the Manager's first message of each turn that has ended and did work; none otherwise. */
  readonly work?: string;
}

/** One of the reader's messages on its way to the chat, as the run its row will stand in reads it: the key it went under, the person who sent it and when, and the thread it replies in, where it does. */
export interface ChatSendingMark {
  readonly clientKey: string;
  readonly sentAt: number;
  readonly sentBy?: string;
  readonly threadRoot?: string;
}

/**
 * Where each of the reader's messages on their way stands, by its key: after
 * every message in `messages`' one run of runs, as a page with no thread view
 * draws it, and after its scope's in the channel, the chat's top or its
 * thread.
 */
export interface ChatSendingPlaces {
  readonly messages: ReadonlyMap<string, ChatRunPlace>;
  readonly channel: ReadonlyMap<string, ChatRunPlace>;
}

/**
 * A Manager's chat as a page draws it: every message oldest first in one
 * run of runs, as a page with no thread view draws it (`messages`); the
 * messages at its top and each thread's replies, by its root's id, each in
 * runs of their own, as a channel draws them (`top`, `threads`); where each
 * of the reader's messages on their way stands in the runs of each, by its
 * key (`sending`); each turn's work by the turn's id; and the turn under
 * way's work.
 */
export interface ManagerChatView {
  readonly messages: readonly ManagerChatLine[];
  readonly top: readonly ManagerChatLine[];
  readonly threads: ReadonlyMap<string, readonly ManagerChatLine[]>;
  readonly sending: ChatSendingPlaces;
  readonly work: ReadonlyMap<string, readonly AgentPart[]>;
  /** The turn under way's work so far, which its working line opens; none where no turn is under way or it has done none. */
  readonly live: readonly AgentPart[];
}

/** Whether a part of a turn is work its chat leaves out: anything but a step boundary, a line that reached the turn, and a message or a set the turn sent to the chat. */
function isWork(part: AgentPart): boolean {
  if (part.kind === AGENT_PART.STEP_START || part.kind === AGENT_PART.ARRIVED) return false;

  return !(part.kind === AGENT_PART.TOOL && (isChatSendTool(part.tool) || isShownSet(part)));
}

/** The place of a message that stands in a run of its own. */
export const CHAT_RUN_ALONE: ChatRunPlace = { opens: true, closes: true };

/** Where a link to one of the chat's messages lands among the messages read (`chatMessageLanding`). */
export const CHAT_LANDING = {
  /** On its row at the chat's top. */
  CHAT: "chat",
  /** In its thread, where it is a reply standing there alone. */
  THREAD: "thread",
  /** Nowhere yet: it is not among the messages read, so it stands on an older page, or is gone. */
  UNREAD: "unread",
} as const;

export type ChatLanding =
  | { readonly kind: typeof CHAT_LANDING.CHAT }
  | { readonly kind: typeof CHAT_LANDING.THREAD; readonly root: string }
  | { readonly kind: typeof CHAT_LANDING.UNREAD };

/**
 * Where a link to one of the chat's messages, by its id, lands among the
 * messages read: on its row at the chat's top, a reply also posted to the
 * chat among them, as Slack lands one; in its thread, by the thread's root,
 * where it is a reply standing there alone; or nowhere yet.
 */
export function chatMessageLanding(view: ManagerChatView, messageId: string): ChatLanding {
  if (view.top.some((line) => line.message.id === messageId)) return { kind: CHAT_LANDING.CHAT };
  const root = view.messages.find((line) => line.message.id === messageId)?.message.threadRoot;

  return root === undefined || root === null
    ? { kind: CHAT_LANDING.UNREAD }
    : { kind: CHAT_LANDING.THREAD, root };
}

/** What a message's place in its sender's run is read from: who wrote it, and when. */
type RunMark = Pick<ManagerChatLiveMessage, "authorKind" | "authorUserId" | "createdAt">;

/** Whether two messages are one sender's: both the Manager's, or both one person's. */
function sameSender(a: RunMark, b: RunMark): boolean {
  if (a.authorKind !== b.authorKind) return false;

  return a.authorKind === MANAGER_CHAT_AUTHOR.AGENT || a.authorUserId === b.authorUserId;
}

/** Whether `next` stands in the run of `before`: one sender's, with no pause between them past `CHAT_RUN_GAP_MS`. */
function continuesRun(before: RunMark, next: RunMark): boolean {
  return sameSender(before, next) && next.createdAt - before.createdAt <= CHAT_RUN_GAP_MS;
}

/** A message on its way as its row will read: a person's, by who sent it, written as it was sent. */
function sendingMark(message: ChatSendingMark): RunMark {
  return {
    authorKind: MANAGER_CHAT_AUTHOR.PERSON,
    authorUserId: message.sentBy ?? null,
    createdAt: message.sentAt,
  };
}

/** Where each message of a scope, oldest first, stands in its sender's run within it. */
function placesOf(run: readonly RunMark[]): readonly ChatRunPlace[] {
  return run.map((mark, index) => {
    const before = run[index - 1];
    const after = run[index + 1];

    return {
      opens: before === undefined || !continuesRun(before, mark),
      closes: after === undefined || !continuesRun(mark, after),
    };
  });
}

/** Each turn's work by the turn's id, the turn under way's apart as the live work. */
function turnWork(
  transcript: readonly AgentTranscriptMessage[],
  running: string | undefined,
): Pick<ManagerChatView, "work" | "live"> {
  const work = new Map<string, readonly AgentPart[]>();
  let live: readonly AgentPart[] = [];

  for (const message of transcript) {
    if (!isAgentTurn(message)) continue;
    const parts = agentParts(message).filter(isWork);

    if (message.id === running) live = parts;
    else if (parts.length > 0) work.set(message.id, parts);
  }

  return { work, live };
}

/** How a thread's replies are counted: "1 reply", "3 replies". */
export function repliesWords(count: number): string {
  return countWords(count, REPLY_NOUN);
}

/** Each reaction offered first: its emoji, its name as a reaction's words say it, and the name of the press that gives it. */
export const MANAGER_CHAT_REACTION_FACES = {
  [MANAGER_CHAT_REACTION.THUMBS_UP]: { emoji: "👍", name: "thumbs up", press: "Thumbs up" },
  [MANAGER_CHAT_REACTION.THUMBS_DOWN]: { emoji: "👎", name: "thumbs down", press: "Thumbs down" },
} as const satisfies Record<
  ManagerChatReaction,
  { readonly emoji: string; readonly name: string; readonly press: string }
>;

/** What a reaction the service would not take says, as it is taken back off. */
export const CHAT_REACTION_REFUSED_WORDS = "Could not react to the message.";

/** The words of a person's edit of their own message: the mark an edited message wears after its words, as Slack's, the edit box's presses, and what an edit the service would not take says as its words go back. */
export const CHAT_EDIT_WORDS = {
  EDITED: "(edited)",
  SAVE: "Save",
  CANCEL: "Cancel",
  REFUSED: "Could not edit the message.",
} as const;

/** What the press that picks any reaction for a message is called, in its actions and its menu alike. */
export const CHAT_ADD_REACTION_WORDS = "Add reaction";

/** What the picker of any reaction searches for, and the group 👍 and 👎 lead it under. */
export const CHAT_REACTION_PICKER_WORDS = {
  SEARCH: "Search emoji",
  LEGEND: "Emoji",
  QUICK: "Quick reactions",
} as const;

/** What a pick of an emoji Slack gives no name says, which can be no reaction. */
export const CHAT_REACTION_UNNAMED_WORDS = "That emoji can't be a reaction.";

/** Who else gave a reaction beside the reader. */
const OTHER_NOUN = { one: "other", many: "others" } as const;

/** A kind as Slack writes it in words, which a kind with no emoji to draw is drawn as too: `:tada:`. */
function slackName(kind: string): string {
  return `:${kind}:`;
}

/**
 * What a reaction's chip draws: an offered one's own emoji, any other's as
 * the service sent it, and a kind sent with none by its name as Slack
 * writes it, so a kind a later service gives always draws.
 */
export function chatReactionEmoji({
  kind,
  emoji,
}: Pick<ManagerChatReactionCount, "kind" | "emoji">): string {
  if (isOfferedReaction(kind)) return MANAGER_CHAT_REACTION_FACES[kind].emoji;

  return emoji ?? slackName(kind);
}

/**
 * Who gave a reaction, as its chip says it to a reader: the reader as
 * "You" where they gave it, the rest counted, since the chat's read counts
 * who gave it without naming them, and an offered kind by its name, any
 * other as Slack writes it. "You reacted with thumbs up", "You and 1 other
 * reacted with thumbs up", "2 reacted with :tada:".
 */
export function chatReactionWords({ kind, count, reacted }: ManagerChatReactionCount): string {
  const name = isOfferedReaction(kind) ? MANAGER_CHAT_REACTION_FACES[kind].name : slackName(kind);

  if (!reacted) return `${count} reacted with ${name}`;
  const others = count - 1;

  return others > 0
    ? `You and ${countWords(others, OTHER_NOUN)} reacted with ${name}`
    : `You reacted with ${name}`;
}

/** What the press that opens a message's work under it, or folds it away, says, by whether it stands open. */
export function chatWorkWords(shown: boolean): string {
  return shown ? CHAT_WORK_WORDS.HIDE : CHAT_WORK_WORDS.SHOW;
}

/**
 * A Manager's chat as a page draws it: its rows, read newest first, drawn
 * oldest first, each placed in its sender's run; each ended turn's work,
 * from the transcript held, folded over the Manager's first message of the
 * turn; and the work of the turn under way (`running`, its id), drawn
 * under the working line. A turn whose journal is not held keeps its work
 * nowhere, so its messages offer none.
 */
export function managerChatView(
  rows: readonly ManagerChatLiveMessage[],
  transcript: readonly AgentTranscriptMessage[],
  options: {
    readonly running: string | undefined;
    /** The reader's messages on their way to the chat, oldest sent first; none where none is. */
    readonly sending?: readonly ChatSendingMark[];
  },
): ManagerChatView {
  const { work, live } = turnWork(transcript, options.running);
  const ordered = rows.toReversed();
  /** The Manager's first message of each turn, by the turn's id, which the turn's work stands over. */
  const firstOfTurn = new Map<string, ManagerChatLiveMessage>();

  for (const message of ordered) {
    if (message.authorKind !== MANAGER_CHAT_AUTHOR.AGENT || message.turnId === null) continue;

    if (!firstOfTurn.has(message.turnId)) firstOfTurn.set(message.turnId, message);
  }

  const going = options.sending ?? [];

  const sending = {
    messages: new Map<string, ChatRunPlace>(),
    channel: new Map<string, ChatRunPlace>(),
  };

  /**
   * A scope's messages as lines, each placed in its sender's run within it,
   * and the first of each turn that did work opening it; the messages on
   * their way to the scope (`after`) placed after them by the same rule, into
   * `placed`.
   */
  const linesOf = (
    run: readonly ManagerChatLiveMessage[],
    placed: Map<string, ChatRunPlace>,
    after: readonly ChatSendingMark[] = [],
  ): readonly ManagerChatLine[] => {
    const places = placesOf([...run, ...after.map(sendingMark)]);

    for (const [index, message] of after.entries()) {
      placed.set(message.clientKey, places[run.length + index] ?? CHAT_RUN_ALONE);
    }

    return run.map((message, index): ManagerChatLine => {
      const place = places[index] ?? CHAT_RUN_ALONE;
      const turn = message.turnId;
      const opener = turn !== null && firstOfTurn.get(turn) === message && work.has(turn);

      return opener ? { message, place, work: turn } : { message, place };
    });
  };

  const top = ordered.filter((message) => message.threadRoot === null || message.broadcast);
  const replies = new Map<string, ManagerChatLiveMessage[]>();
  const repliesGoing = new Map<string, ChatSendingMark[]>();

  for (const message of ordered) {
    if (message.threadRoot === null) continue;
    replies.set(message.threadRoot, [...(replies.get(message.threadRoot) ?? []), message]);
  }

  for (const message of going) {
    if (message.threadRoot === undefined) continue;
    repliesGoing.set(message.threadRoot, [
      ...(repliesGoing.get(message.threadRoot) ?? []),
      message,
    ]);
  }

  const threads = new Map(
    [...replies].map(([root, thread]) => [
      root,
      linesOf(thread, sending.channel, repliesGoing.get(root)),
    ]),
  );

  // Note that a reply on its way to a thread that holds no reply yet stands alone in it.
  for (const [root, replying] of repliesGoing) {
    if (!replies.has(root)) linesOf([], sending.channel, replying);
  }

  const topGoing = going.filter((message) => message.threadRoot === undefined);

  return {
    messages: linesOf(ordered, sending.messages, going),
    top: linesOf(top, sending.channel, topGoing),
    threads,
    sending,
    work,
    live,
  };
}
