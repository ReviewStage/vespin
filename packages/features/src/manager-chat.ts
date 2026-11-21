/**
 * manager-chat.ts -- a Manager's transcript as the chat its page draws: people's lines, and the Manager's `send_to_user` messages alone, one message to each call, in runs by sender.
 *
 * A Manager's page is a direct-message chat between the people who can open
 * it and the Manager, never its transcript: a person's line stands as they
 * sent it (`isPersonLine`), and each `send_to_user` call a turn made stands
 * as a message of its own, in the order it was sent, so a turn that sent
 * three short messages draws three bubbles. On a call, each line the voice
 * said stands as the Manager's own message, as an ordinary agent's
 * transcript draws it as the agent's reply (`isVoiceLine`), since it is what
 * the caller heard the Manager say. A person's line that reached a
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
 *
 * A person may answer one of the Manager's messages, as a chat app's Reply
 * does. The reply is no field of the line's own but its words: the
 * Manager's message, as one line of plain words cut to `REPLY_QUOTE_CHARS`,
 * as a Markdown quote over the person's own words (`chatReplyText`), so the
 * Manager reads what is answered at the head of its turn's input, a client
 * that knows nothing of replies draws it as any quote, and it stands
 * through a reload with nothing stored beside it. Read back, a person's
 * line that opens on such a quote of a Manager's message before it is that
 * message's reply (`ManagerChatRuns`' `replies`); a quote of no message
 * the chat holds is the words it is.
 */

import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type WireValue,
} from "@repo/wire";
import { AGENT_PART, type AgentPart, arrivedParts, messageWords } from "./agent-parts.js";
import { AGENT_TOOL } from "./agent-tools.js";
import { AGENT_BOUNDS, type AgentTranscriptMessage } from "./agent-wire.js";
import { plainWords } from "./plain-words.js";
import { cutReply, MESSAGE_BLOCK, messageBlocks, messageText, QUOTE_GAP } from "./reply-quote.js";
import { TOOL_STATE } from "./tool-call-block.js";
import { isPersonLine } from "./transcript-lines.js";
import { isAgentTurn, isVoiceLine } from "./voice-call-lines.js";

/** The longest pause, in milliseconds, between two messages of one sender that still stand in one run. */
const CHAT_RUN_GAP_MS = 10 * 60 * 1000;

/** The most characters of a Manager's message a reply quotes, its ellipsis included: enough to say which it answers. */
const REPLY_QUOTE_CHARS = 280;

/** The ellipsis a quote cut short ends on (`cutReply`). */
const ELLIPSIS = "…";

/** What a quote's line opens on before its words (`quoteOf`). */
const QUOTE_MARK = "> ";

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

/** A Manager's transcript as its chat: people's lines, each `send_to_user` call as a message of its own, the lines that reached a turn standing between its messages where they arrived, and the voice's lines on a call. */
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

/** A Manager's message as a reply quotes it: its words as one line of plain words, links by their names. */
function quotedWords(words: string): string {
  return plainWords(words).replace(/\s+/gu, " ").trim();
}

/**
 * The words a reply to the Manager's message `quoted` sends: the message
 * as one quoted line, cut to `REPLY_QUOTE_CHARS` or to what room the
 * person's `words` leave in a message, over their words. Their words alone
 * where no word of the message fits, or the message has none.
 */
export function chatReplyText(quoted: string, words: string): string {
  const room = AGENT_BOUNDS.MAX_MESSAGE_CHARS - words.length - QUOTE_GAP.length - QUOTE_MARK.length;
  const quote = cutReply(quotedWords(quoted), Math.min(REPLY_QUOTE_CHARS, room));

  if (quote === "") return words;

  return messageText([
    { kind: MESSAGE_BLOCK.QUOTE, words: quote },
    { kind: MESSAGE_BLOCK.WORDS, lines: words.split("\n") },
  ]);
}

/** A person's line that answers one of the Manager's messages: the message it answers, by its chat id, the quote it opens on, and the person's own words under it. */
export interface ChatReply {
  readonly to: string;
  readonly quote: string;
  readonly words: string;
}

/** Whether `quote` is the Manager's message `words` as a reply quotes it, whole or cut short. */
function quotes(quote: string, words: string): boolean {
  const said = quotedWords(words);

  return quote.endsWith(ELLIPSIS)
    ? quote.length > ELLIPSIS.length && said.startsWith(quote.slice(0, -ELLIPSIS.length))
    : said === quote;
}

/** The reply the chat's line at `index` is, where it opens on a quote of one of the Manager's messages before it, the nearest such; none for any other line. */
function replyOf(lines: readonly AgentTranscriptMessage[], index: number): ChatReply | undefined {
  const line = lines[index];
  const [head, ...rest] = line === undefined ? [] : messageBlocks(messageWords(line));

  if (head?.kind !== MESSAGE_BLOCK.QUOTE || head.words.includes("\n")) return undefined;
  const quote = head.words;

  const to = lines.findLast(
    (message, at) =>
      at < index && message.role === MESSAGE_ROLE.ASSISTANT && quotes(quote, messageWords(message)),
  );

  return to === undefined ? undefined : { to: to.id, quote, words: messageText(rest) };
}

/** Where a chat message stands in its run: whether it opens it, under its sender's name where one is drawn, and whether it closes it, over the run's one time. */
export interface ChatRunPlace {
  readonly opens: boolean;
  readonly closes: boolean;
}

/** A Manager's chat in runs: where each message stands in its run, by its id, and the people's lines that answer one of the Manager's messages, by their ids. */
export interface ManagerChatRuns {
  readonly places: ReadonlyMap<string, ChatRunPlace>;
  readonly replies: ReadonlyMap<string, ChatReply>;
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

/** A Manager's chat lines (`managerChatLines`) in runs: where each stands in its run, the reader's lines still on their way counted as the reader's, and which of the people's lines are replies. */
export function managerChatRuns(
  lines: readonly AgentTranscriptMessage[],
  readerId: string | undefined,
): ManagerChatRuns {
  const places = new Map<string, ChatRunPlace>();
  const replies = new Map<string, ChatReply>();

  lines.forEach((message, index) => {
    const before = lines[index - 1];
    const after = lines[index + 1];
    const reply = message.role === MESSAGE_ROLE.USER ? replyOf(lines, index) : undefined;

    if (reply !== undefined) replies.set(message.id, reply);
    places.set(message.id, {
      opens: before === undefined || !continuesRun(before, message, readerId),
      closes: after === undefined || !continuesRun(message, after, readerId),
    });
  });

  return { places, replies };
}
