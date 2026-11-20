/**
 * manager-chat.ts -- a Manager's transcript as the chat its page draws: people's lines, and the Manager's `send_to_user` messages alone, one message to each call, in runs by sender.
 *
 * A Manager's page is a direct-message chat between the people who can open
 * it and the Manager, never its transcript: a person's line stands as they
 * sent it (`isPersonLine`), and each `send_to_user` call a turn made stands
 * as a message of its own, in the order it was sent, so a turn that sent
 * three short messages draws three bubbles. A person's line that reached a
 * turn while it ran stands between the messages it arrived between.
 * Everything else the transcript holds (the Manager's own text, its thoughts
 * and other calls, and the lines its agents, wakes, threads, and GitHub sent
 * it) is left out, and a turn that sent nothing stands nowhere. The greeting
 * it opens on is drawn above (`manager-greeting.ts`).
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
import { AGENT_PART, type AgentPart, arrivedParts } from "./agent-parts.js";
import { AGENT_TOOL } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { TOOL_STATE } from "./tool-call-block.js";
import { isPersonLine } from "./transcript-lines.js";

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

/** A person's line as the chat stands it where it arrived, out of the turn that took it in, so no later read moves it back into the turn's first message. */
function standingLine(line: AgentTranscriptMessage): AgentTranscriptMessage {
  const { arrivedIn: _arrived, ...kept } = line;

  return kept;
}

/**
 * A turn as its chat messages: one to each `send_to_user` call it made, in
 * the order sent, the first under the turn's own id and each after it under
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

    const text = sentWords(part);

    if (text === undefined || part.kind !== AGENT_PART.TOOL) continue;
    const id = sends === 0 ? message.id : part.callId;
    const parts: readonly WireValue[] = [{ type: AGENT_PART.TEXT, text }];

    lastAt = chat.push({ ...kept, id, parts }) - 1;
    sends += 1;
  }

  const last = chat[lastAt];

  if (last !== undefined && finishedAt !== undefined) chat[lastAt] = { ...last, finishedAt };

  return chat;
}

/** A Manager's transcript as its chat: people's lines, and each `send_to_user` call as a message of its own, the lines that reached a turn standing between its messages where they arrived. */
export function managerChatLines(
  messages: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  const turns = new Set(
    messages.flatMap((message) => (message.role === MESSAGE_ROLE.ASSISTANT ? [message.id] : [])),
  );

  const arrived = new Map<string, AgentTranscriptMessage[]>();

  for (const message of messages) {
    const journal = message.arrivedIn?.journalId;

    if (message.role !== MESSAGE_ROLE.USER || journal === undefined || !turns.has(journal)) {
      continue;
    }

    arrived.set(journal, [...(arrived.get(journal) ?? []), message]);
  }

  return messages.flatMap((message): readonly AgentTranscriptMessage[] => {
    if (message.role === MESSAGE_ROLE.ASSISTANT) {
      return turnChat(message, arrived.get(message.id) ?? []);
    }

    if (message.role !== MESSAGE_ROLE.USER || !isPersonLine(message)) return [];
    const journal = message.arrivedIn?.journalId;

    // A line a held turn took in stands among that turn's messages instead.
    return journal !== undefined && turns.has(journal) ? [] : [message];
  });
}

/** Where a chat message stands in its run: whether it opens it, under its sender's name where one is drawn, and whether it closes it, over the run's one time. */
export interface ChatRunPlace {
  readonly opens: boolean;
  readonly closes: boolean;
}

/** A Manager's chat in runs: where each message stands in its run, by its id, and how many people wrote in it. */
export interface ManagerChatRuns {
  readonly places: ReadonlyMap<string, ChatRunPlace>;
  readonly people: number;
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

/** A Manager's chat lines (`managerChatLines`) in runs: where each stands in its run, and how many people wrote, the reader's lines still on their way counted as the reader's. */
export function managerChatRuns(
  lines: readonly AgentTranscriptMessage[],
  readerId: string | undefined,
): ManagerChatRuns {
  const places = new Map<string, ChatRunPlace>();
  const people = new Set<string | undefined>();

  lines.forEach((message, index) => {
    const before = lines[index - 1];
    const after = lines[index + 1];
    const sender = chatSender(message, readerId);

    if (!sender.manager) people.add(sender.person);

    places.set(message.id, {
      opens: before === undefined || !continuesRun(before, message, readerId),
      closes: after === undefined || !continuesRun(message, after, readerId),
    });
  });

  return { places, people: people.size };
}
