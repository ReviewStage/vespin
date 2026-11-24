/**
 * manager-chat-view.ts -- a Manager's chat as a page draws it from its rows: its messages oldest first, each placed in its sender's run, and the work of each of the Manager's turns a press away.
 *
 * A Manager's chat is its own rows (`manager-chat-live.ts`), which a page
 * reads newest first and draws oldest first, as a team channel does. The
 * chat's top holds each message that is no reply, and each reply posted to
 * the chat too (`broadcast`); every reply stands in its root's thread,
 * which a page opens beside the chat (`threads`). Consecutive messages of
 * one sender, the Manager or one person, none further from the one before
 * than `CHAT_RUN_GAP_MS`, are one run, within the chat's top or within one
 * thread, which a page draws under one head (`ChatRunPlace`).
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
import { AGENT_TOOL } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "./manager-chat-live.js";
import { isAgentTurn } from "./voice-call-lines.js";

/** The longest pause, in milliseconds, between two messages of one sender that still stand in one run. */
const CHAT_RUN_GAP_MS = 10 * 60 * 1000;

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

/** A Manager's chat as a page draws it: the messages at its top oldest first, each thread's replies oldest first by its root's id, each turn's work by the turn's id, and the turn under way's work. */
export interface ManagerChatView {
  readonly messages: readonly ManagerChatLine[];
  readonly threads: ReadonlyMap<string, readonly ManagerChatLine[]>;
  readonly work: ReadonlyMap<string, readonly AgentPart[]>;
  /** The turn under way's work so far, which its working line opens; none where no turn is under way or it has done none. */
  readonly live: readonly AgentPart[];
}

/** Whether a part of a turn is work its chat leaves out: anything but a step boundary, a line that reached the turn, and a message or a set the turn sent to the chat. */
function isWork(part: AgentPart): boolean {
  if (part.kind === AGENT_PART.STEP_START || part.kind === AGENT_PART.ARRIVED) return false;

  return !(
    part.kind === AGENT_PART.TOOL &&
    (part.tool === AGENT_TOOL.SEND_TO_USER || isShownSet(part))
  );
}

/** Whether two messages are one sender's: both the Manager's, or both one person's. */
function sameSender(a: ManagerChatLiveMessage, b: ManagerChatLiveMessage): boolean {
  if (a.authorKind !== b.authorKind) return false;

  return a.authorKind === MANAGER_CHAT_AUTHOR.AGENT || a.authorUserId === b.authorUserId;
}

/** Whether `next` stands in the run of `before`: one sender's, with no pause between them past `CHAT_RUN_GAP_MS`. */
function continuesRun(before: ManagerChatLiveMessage, next: ManagerChatLiveMessage): boolean {
  return sameSender(before, next) && next.createdAt - before.createdAt <= CHAT_RUN_GAP_MS;
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
  options: { readonly running: string | undefined },
): ManagerChatView {
  const { work, live } = turnWork(transcript, options.running);
  const ordered = rows.toReversed();
  /** The Manager's first message of each turn, by the turn's id, which the turn's work stands over. */
  const firstOfTurn = new Map<string, ManagerChatLiveMessage>();

  for (const message of ordered) {
    if (message.authorKind !== MANAGER_CHAT_AUTHOR.AGENT || message.turnId === null) continue;

    if (!firstOfTurn.has(message.turnId)) firstOfTurn.set(message.turnId, message);
  }

  /** A run of messages as lines, each placed in its sender's run within it, and the first of each turn that did work opening it. */
  const linesOf = (run: readonly ManagerChatLiveMessage[]) =>
    run.map((message, index): ManagerChatLine => {
      const before = run[index - 1];
      const after = run[index + 1];

      const place = {
        opens: before === undefined || !continuesRun(before, message),
        closes: after === undefined || !continuesRun(message, after),
      };

      const turn = message.turnId;
      const opener = turn !== null && firstOfTurn.get(turn) === message && work.has(turn);

      return opener ? { message, place, work: turn } : { message, place };
    });

  const top = ordered.filter((message) => message.threadRoot === null || message.broadcast);
  const replies = new Map<string, ManagerChatLiveMessage[]>();

  for (const message of ordered) {
    if (message.threadRoot === null) continue;
    replies.set(message.threadRoot, [...(replies.get(message.threadRoot) ?? []), message]);
  }

  const threads = new Map([...replies].map(([root, thread]) => [root, linesOf(thread)]));

  return { messages: linesOf(top), threads, work, live };
}
