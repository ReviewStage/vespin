/**
 * manager-chat.ts -- a Manager's transcript as the chat its page draws: people's lines, and the Manager's `send_to_user` messages and `show_media` sets alone, one message to each call, in runs by sender.
 *
 * A Manager's page is a direct-message chat between the people who can open
 * it and the Manager, never its transcript: a person's line stands as they
 * sent it (`isPersonLine`), and each `send_to_user` call a turn made stands
 * as a message of its own, in the order it was sent, so a turn that sent
 * three short messages draws three bubbles. Each `show_media` call that
 * showed its pictures, recordings, or clips stands the same way, as a
 * message of the set it showed, so what the Manager shows reaches the
 * people it is shown to (`chatParts`). On a call, each line the voice
 * said stands as the Manager's own message, as an ordinary agent's
 * transcript draws it as the agent's reply (`isVoiceLine`), since it is what
 * the caller heard the Manager say. A person's line that reached a
 * turn while it ran stands between the messages it arrived between.
 * Everything else the transcript holds (the Manager's own text, its thoughts
 * and other calls, and the lines its agents, wakes, threads, and GitHub sent
 * it) is left out, and a turn that sent nothing stands nowhere. The greeting
 * it opens on is drawn above (`manager-greeting.ts`).
 *
 * What was left out stays a press away (`managerChatWork`): each of the
 * Manager's messages keeps the work that led to it, its thoughts, calls, and
 * own words since the message before, and a turn's last message the work
 * after it too, which the page opens under the message on Show work; and
 * the turn under way keeps its work since its last message, which the page
 * opens under its working line. A turn that ended having sent nothing keeps
 * its work nowhere, so a finished chat draws no more than its messages.
 *
 * The chat's messages stand in runs, as a chat app groups them: consecutive
 * messages from one sender, none further from the one before than
 * `CHAT_RUN_GAP_MS`, are one run, which the page draws close together with
 * one time under its last (`managerChatRuns`).
 */

import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type WireValue,
} from "@repo/wire";
import {
  AGENT_PART,
  type AgentPart,
  agentParts,
  arrivedParts,
  isShownSet,
  messageWords,
} from "./agent-parts.js";
import { AGENT_TOOL } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { TOOL_STATE } from "./tool-call-block.js";
import { isPersonLine } from "./transcript-lines.js";
import { isAgentTurn, isVoiceLine } from "./voice-call-lines.js";

/** The longest pause, in milliseconds, between two messages of one sender that still stand in one run. */
const CHAT_RUN_GAP_MS = 10 * 60 * 1000;

/** Who sent a chat message, which a run keeps to: the Manager, or a person by their account. */
type ChatSender =
  | { readonly manager: true }
  | { readonly manager: false; readonly person: string | undefined };

/** The words of a `send_to_user` call whose input is whole, but one its answer refused; none for any other part. */
function sentWords(part: AgentPart): string | undefined {
  if (part.kind !== AGENT_PART.TOOL || part.tool !== AGENT_TOOL.SEND_TO_USER) return undefined;

  // Note that a call still streaming its input holds only the start of its words, so it stands once they are whole.
  if (part.state === TOOL_STATE.INPUT_STREAMING || part.state === TOOL_STATE.OUTPUT_ERROR) {
    return undefined;
  }

  if (isRecord(part.output) && part.output.status !== ACTION_RESULT_STATUS.ACCEPTED) {
    return undefined;
  }

  const text = isRecord(part.input) ? part.input.text : undefined;

  return isWireString(text) && text.trim() !== "" ? text.trim() : undefined;
}

/**
 * The parts a part of a turn stands in the chat as, a message of its own:
 * a `send_to_user` call's words, or a `show_media` call that showed its set,
 * as the call itself, which every client already draws as the set it
 * showed; none for any other part.
 */
function chatParts(part: AgentPart): readonly WireValue[] | undefined {
  const text = sentWords(part);

  if (text !== undefined) return [{ type: AGENT_PART.TEXT, text }];

  if (!isShownSet(part)) return undefined;

  // Note that a part read whole always carries its input and answer, so null stands only for one a stored row lacked.
  return [
    {
      type: `tool-${part.tool}`,
      toolCallId: part.callId,
      state: part.state,
      input: part.input ?? null,
      output: part.output ?? null,
    },
  ];
}

/** A person's line as the chat stands it where it arrived, out of the turn that took it in, so no later read moves it back into the turn's first message. */
function standingLine(line: AgentTranscriptMessage): AgentTranscriptMessage {
  const { arrivedIn: _arrived, ...kept } = line;

  return kept;
}

/** The id the chat stands a turn's sent message under: the turn's own for its first, its call's for each after it. */
function sentId(message: AgentTranscriptMessage, sends: number, callId: string): string {
  return sends === 0 ? message.id : callId;
}

/**
 * A turn as its chat messages: one to each `send_to_user` call it made and
 * each set it showed (`chatParts`), in the order sent, the first under the turn's own id and each after it under
 * its call's, with the people's lines that reached the turn while it ran
 * (`arrived`) between the messages they arrived between. Each keeps the
 * turn's start, and only the last the turn's end, since that is when the
 * last was sent and the others' times are not kept.
 */
function turnChat(
  message: AgentTranscriptMessage,
  arrived: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  // Note that the parts are new, so the cuts that named the old ones by index go with them, as does the turn's end, which only its last message takes.
  const { cutParts: _cut, finishedAt, ...kept } = message;
  const chat: AgentTranscriptMessage[] = [];
  let sends = 0;
  let lastAt = -1;

  for (const part of arrivedParts(message, arrived)) {
    if (part.kind === AGENT_PART.ARRIVED) {
      if (isPersonLine(part.line)) chat.push(standingLine(part.line));
      continue;
    }

    const parts = chatParts(part);

    if (parts === undefined || part.kind !== AGENT_PART.TOOL) continue;
    const id = sentId(message, sends, part.callId);

    lastAt = chat.push({ ...kept, id, parts }) - 1;
    sends += 1;
  }

  const last = chat[lastAt];

  if (last !== undefined && finishedAt !== undefined) chat[lastAt] = { ...last, finishedAt };

  return chat;
}

/**
 * A line the voice said on a call as the Manager's chat message, as a
 * `send_to_user` call becomes one: its words alone, sent when it was said,
 * which is its start and its end. It keeps its row's id and metadata, so
 * it is still the call's line (`isVoiceLine`) and never a turn.
 */
function voiceChat(line: AgentTranscriptMessage): readonly AgentTranscriptMessage[] {
  const text = messageWords(line).trim();

  if (text === "") return [];
  const { cutParts: _cut, sentAt, ...kept } = line;
  const parts: readonly WireValue[] = [{ type: AGENT_PART.TEXT, text }];
  const at = sentAt === undefined ? undefined : { sentAt, startedAt: sentAt, finishedAt: sentAt };

  return [{ ...kept, parts, ...at }];
}

/** A Manager's transcript as its chat: people's lines, each `send_to_user` call and each set shown as a message of its own, the lines that reached a turn standing between its messages where they arrived, and the voice's lines on a call. */
export function managerChatLines(
  messages: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  const turns = new Set(messages.flatMap((message) => (isAgentTurn(message) ? [message.id] : [])));

  const arrived = new Map<string, AgentTranscriptMessage[]>();

  for (const message of messages) {
    const journal = message.arrivedIn?.journalId;

    if (message.role !== MESSAGE_ROLE.USER || journal === undefined || !turns.has(journal)) {
      continue;
    }

    arrived.set(journal, [...(arrived.get(journal) ?? []), message]);
  }

  return messages.flatMap((message): readonly AgentTranscriptMessage[] => {
    // Note that the voice's line is no turn, so it stands as a message of its own rather than as a turn's sent words, which it holds none of.
    if (isVoiceLine(message)) return voiceChat(message);

    if (message.role === MESSAGE_ROLE.ASSISTANT) {
      return turnChat(message, arrived.get(message.id) ?? []);
    }

    if (message.role !== MESSAGE_ROLE.USER || !isPersonLine(message)) return [];
    const journal = message.arrivedIn?.journalId;

    // A line a held turn took in stands among that turn's messages instead.
    return journal !== undefined && turns.has(journal) ? [] : [message];
  });
}

/** What Show work says beside a message or in its menu, by whether its work stands open under it. */
const CHAT_WORK_WORDS = {
  SHOW: "Show work",
  HIDE: "Hide work",
} as const;

/** What the press that opens a message's work under it, or folds it away, says, by whether it stands open. */
export function chatWorkWords(shown: boolean): string {
  return shown ? CHAT_WORK_WORDS.HIDE : CHAT_WORK_WORDS.SHOW;
}

/** The work a Manager's chat holds a press away: each message's, by its chat id, and the turn under way's since its last message. */
export interface ManagerChatWork {
  readonly work: ReadonlyMap<string, readonly AgentPart[]>;
  /** The turn under way's work since its last message, or since it began where it sent none; none where no turn is under way. */
  readonly live: readonly AgentPart[];
}

/** Whether a part of a turn is work its chat leaves out: anything but a step boundary, a line that reached the turn, and a message the turn sent. */
function isWork(part: AgentPart): boolean {
  return (
    part.kind !== AGENT_PART.STEP_START &&
    part.kind !== AGENT_PART.ARRIVED &&
    chatParts(part) === undefined
  );
}

/**
 * A Manager's transcript's work as its chat holds it (`ManagerChatWork`):
 * each message's work since the message before it, the work after a turn's
 * last message with that message, and, while the newest turn is under way
 * (`running`), that turn's work since its last message as its live work
 * instead. Each part keeps the cut it was read with.
 */
export function managerChatWork(
  messages: readonly AgentTranscriptMessage[],
  running: boolean,
): ManagerChatWork {
  const work = new Map<string, readonly AgentPart[]>();
  const newest = messages.findLast(isAgentTurn);
  let live: readonly AgentPart[] = [];

  for (const message of messages) {
    if (message.role !== MESSAGE_ROLE.ASSISTANT || isVoiceLine(message)) continue;
    let pending: AgentPart[] = [];
    let last: string | undefined;
    let sends = 0;

    for (const part of agentParts(message)) {
      if (part.kind === AGENT_PART.TOOL && chatParts(part) !== undefined) {
        last = sentId(message, sends, part.callId);
        work.set(last, pending);
        pending = [];
        sends += 1;
      } else if (isWork(part)) {
        pending.push(part);
      }
    }

    // Note that the turn under way's work since its last message is still going, so it stands under the working line rather than with a message it may not lead to.
    if (running && message === newest) {
      live = pending;
    } else if (last !== undefined) {
      work.set(last, [...(work.get(last) ?? []), ...pending]);
    }
  }

  return { work, live };
}

/** Where a chat message stands in its run: whether it opens it, under its sender's name where one is drawn, and whether it closes it, over the run's one time. */
export interface ChatRunPlace {
  readonly opens: boolean;
  readonly closes: boolean;
}

/** A Manager's chat in runs: where each message stands in its run, by its id. */
export interface ManagerChatRuns {
  readonly places: ReadonlyMap<string, ChatRunPlace>;
}

/** Who sent a chat message: the Manager for its own, else the person's account, the reader's for a line of theirs still on its way. */
function chatSender(message: AgentTranscriptMessage, readerId: string | undefined): ChatSender {
  if (message.role === MESSAGE_ROLE.ASSISTANT) return { manager: true };
  const { sentBy } = message;

  return { manager: false, person: sentBy === undefined ? readerId : sentBy.userId };
}

function sameSender(a: ChatSender, b: ChatSender): boolean {
  return a.manager === b.manager && (a.manager || (!b.manager && a.person === b.person));
}

/** When a chat message was sent, as near as it is known: a person's line's send, or the start of the turn that sent the Manager's. */
function sentAtOf(message: AgentTranscriptMessage): number | undefined {
  return message.sentAt ?? message.startedAt;
}

/** Whether `next` stands in the run of `before`: one sender's, with no pause between them past `CHAT_RUN_GAP_MS` where both times are known. */
function continuesRun(
  before: AgentTranscriptMessage,
  next: AgentTranscriptMessage,
  readerId: string | undefined,
): boolean {
  if (!sameSender(chatSender(before, readerId), chatSender(next, readerId))) return false;
  const was = sentAtOf(before);
  const is = sentAtOf(next);

  return was === undefined || is === undefined || is - was <= CHAT_RUN_GAP_MS;
}

/** A Manager's chat lines (`managerChatLines`) in runs: where each stands in its run, the reader's lines still on their way counted as the reader's. */
export function managerChatRuns(
  lines: readonly AgentTranscriptMessage[],
  readerId: string | undefined,
): ManagerChatRuns {
  const places = new Map<string, ChatRunPlace>();

  lines.forEach((message, index) => {
    const before = lines[index - 1];
    const after = lines[index + 1];
    places.set(message.id, {
      opens: before === undefined || !continuesRun(before, message, readerId),
      closes: after === undefined || !continuesRun(message, after, readerId),
    });
  });

  return { places };
}
