/**
 * voice-call-lines.ts -- the lines a call into a coding agent left in its transcript, read out of the rows the service stored: who said each, on which call, when into the call, and where each call begins and ends among the rows a tab draws.
 *
 * A call writes both its speakers' words as rows of the agent's
 * conversation, in the order they were said (`writer.ts`'s
 * `recordVoiceLine`): the caller's lines as user rows the member sent, and
 * the voice's as assistant rows the voice model wrote, each on the voice
 * channel and naming its call, and, where the service kept them, when into
 * the call the line began and ended (`from_ms`, `to_ms`). The voice's rows
 * are no turn of the agent's, so a read that looks for the agent's turns
 * among the rows passes over them (`isAgentTurn`). Pure reads over the
 * wire's shapes, shared by every client that draws a transcript.
 */

import {
  isRecord,
  isWireNumber,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type WireRecord,
} from "@repo/wire";
import { Predicate } from "effect";
import {
  AGENT_SENDER,
  type AgentSender,
  type AgentStandingCall,
  type AgentTranscriptMessage,
} from "./agent-wire.js";

/** Who said a line on a call: the caller, whose words are theirs, or the voice, which answers them. */
export const CALL_SPEAKER = {
  CALLER: "caller",
  VOICE: "voice",
} as const;

export type CallSpeaker = (typeof CALL_SPEAKER)[keyof typeof CALL_SPEAKER];

/** A line said on a call: who said it, the call it was said on, and when into the call it began and ended, where the row keeps it. */
export interface SpokenLine {
  readonly speaker: CallSpeaker;
  readonly callId: string;
  readonly fromMs: number | undefined;
  readonly toMs: number | undefined;
}

/** A row as far as these reads look at it. */
type Row = Pick<AgentTranscriptMessage, "role" | "metadata">;

/** An offset into a call the row's metadata keeps under `key`, a count of milliseconds; none where it keeps none. */
function offsetOf(metadata: WireRecord, key: string): number | undefined {
  const value = metadata[key];

  return isWireNumber(value) && value >= 0 ? value : undefined;
}

/**
 * The line said on a call that a row is, either speaker's; none for a row
 * said on no call, as a typed line or a turn's journal, or one whose
 * metadata names no call.
 */
export function spokenLineOf(message: Row): SpokenLine | undefined {
  const { metadata } = message;

  if (!isRecord(metadata) || metadata.channel !== MESSAGE_CHANNEL.VOICE) return undefined;
  const callId = metadata.voice_session_id;

  if (!Predicate.isString(callId)) return undefined;

  const at = { callId, fromMs: offsetOf(metadata, "from_ms"), toMs: offsetOf(metadata, "to_ms") };

  if (message.role === MESSAGE_ROLE.USER) return { speaker: CALL_SPEAKER.CALLER, ...at };

  return message.role === MESSAGE_ROLE.ASSISTANT && metadata.author === MESSAGE_AUTHOR.VOICE_MODEL
    ? { speaker: CALL_SPEAKER.VOICE, ...at }
    : undefined;
}

/** Whether a row is a line the voice said on a call, which is no turn of the agent's. */
export function isVoiceLine(message: Row): boolean {
  return spokenLineOf(message)?.speaker === CALL_SPEAKER.VOICE;
}

/** Whether a row is one of the agent's own turns: an assistant row the voice did not write. */
export function isAgentTurn(message: Row): boolean {
  return message.role === MESSAGE_ROLE.ASSISTANT && !isVoiceLine(message);
}

/** A call as its rows stand: its id, who called, when it began, how long it ran, and the rows that hold its first and last lines. */
export interface CallSpan {
  readonly callId: string;
  /** Whose call it was: the sender of the caller's first line on it, or, while it stands, the member its row names; none where only the voice's lines stand among the rows of a call that ended. */
  readonly caller: AgentSender | undefined;
  /** When it began on the wall clock: while it stands, when its row says it opened, and once it ended, when its first line among the rows began. */
  readonly startedAt: number | undefined;
  /** How long it ran: to the end of its last line on the call's clock, or, where its rows keep no such times, from when its first line began to when its last did. */
  readonly lengthMs: number | undefined;
  /** The row the call's first line stands in, which its start is drawn before; none for a call that stands with no line among the rows yet, whose start is drawn after every row. */
  readonly opensIn: string | undefined;
  /** The row its last line stands in, which its end is drawn after; none where it has no line among the rows. */
  readonly closesIn: string | undefined;
}

/** A row as a tab places it: the message, and the lines a turn took in under way that the service placed in it (`placedMessages`). */
interface PlacedRow {
  readonly message: AgentTranscriptMessage;
  readonly arrived: readonly AgentTranscriptMessage[];
}

/** What a tab draws, in order: where a call begins, a row, or where a call ends. */
export const CALL_ITEM = {
  START: "start",
  ROW: "row",
  END: "end",
} as const;

/** One thing a tab draws: a call's start or end, or a row. */
export type CallItem =
  | { readonly kind: typeof CALL_ITEM.START; readonly span: CallSpan }
  | { readonly kind: typeof CALL_ITEM.END; readonly span: CallSpan }
  | { readonly kind: typeof CALL_ITEM.ROW; readonly message: AgentTranscriptMessage };

/** What a call's rows have said of it so far. */
interface HeldSpan {
  opensIn: string;
  closesIn: string;
  callerLine?: AgentTranscriptMessage;
  firstAt?: number;
  lastAt?: number;
  endMs?: number;
}

/** The latest of two times, either of which may be unknown. */
function latest(held: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return held;

  return held === undefined ? next : Math.max(held, next);
}

/** The member a standing call's row names as the one on it, as a line of theirs names its sender. */
function callerOfRow(standing: AgentStandingCall): AgentSender {
  return { name: "", kind: AGENT_SENDER.MEMBER, userId: standing.callerId };
}

/** A call that stands with no line among the rows yet, drawn from its row alone. */
function openingSpan(standing: AgentStandingCall): CallSpan {
  return {
    callId: standing.callId,
    caller: callerOfRow(standing),
    startedAt: standing.startedAt,
    lengthMs: undefined,
    opensIn: undefined,
    closesIn: undefined,
  };
}

/** The call's span as its rows have said it, and its row where it stands. */
function spanOf(callId: string, held: HeldSpan, standing: AgentStandingCall | undefined): CallSpan {
  const walled =
    held.firstAt === undefined || held.lastAt === undefined
      ? undefined
      : held.lastAt - held.firstAt;

  const rowCaller = standing === undefined ? undefined : callerOfRow(standing);

  return {
    callId,
    caller: held.callerLine?.sentBy ?? rowCaller,
    startedAt: standing?.startedAt ?? held.firstAt,
    lengthMs: held.endMs ?? walled,
    opensIn: held.opensIn,
    closesIn: held.closesIn,
  };
}

/** Each call's span among the rows, from the row its first line stands in to the row its last does. */
function spansOf(
  rows: readonly PlacedRow[],
  standing: ReadonlyMap<string, AgentStandingCall>,
): ReadonlyMap<string, CallSpan> {
  const spans = new Map<string, HeldSpan>();

  for (const { message: row, arrived } of rows) {
    for (const line of [row, ...arrived]) {
      const spoken = spokenLineOf(line);

      if (spoken === undefined) continue;

      const held = spans.get(spoken.callId) ?? { opensIn: row.id, closesIn: row.id };
      spans.set(spoken.callId, held);
      held.closesIn = row.id;

      if (held.callerLine === undefined && spoken.speaker === CALL_SPEAKER.CALLER) {
        held.callerLine = line;
      }

      if (held.firstAt === undefined && line.sentAt !== undefined) held.firstAt = line.sentAt;

      const lastAt = latest(held.lastAt, line.sentAt);
      const endMs = latest(held.endMs, spoken.toMs ?? spoken.fromMs);

      if (lastAt !== undefined) held.lastAt = lastAt;

      if (endMs !== undefined) held.endMs = endMs;
    }
  }

  return new Map(
    [...spans].map(([callId, held]) => [callId, spanOf(callId, held, standing.get(callId))]),
  );
}

/** Whether a line opens a turn: a line of the developer's that is no line of a call, or a line of a call a delegation handed the agent. */
export function opensTurn(message: AgentTranscriptMessage): boolean {
  if (message.role !== MESSAGE_ROLE.USER) return false;
  const spoken = spokenLineOf(message);

  return (
    spoken === undefined ||
    (isRecord(message.metadata) && Predicate.isString(message.metadata.delegation_id))
  );
}

/**
 * How a tab draws a transcript's rows with the calls among them.
 *
 * The rules, settled with Dean (Nov 13, 2026), each because the transcript
 * that drew calls before broke on moving rows:
 *
 * 1. The rows stand in the conversation's order (`seq`) and in no other: no
 *    row is moved, so a line of a call never moves into a turn, up to the
 *    turn it answers, or past another by its time. A call only adds what
 *    stands between rows (its start and its end).
 * 2. When into a call a line was said (`from_ms`, `to_ms`) gives the
 *    call's length alone, and orders nothing.
 * 3. A turn is one row, its journal, written as it starts and grown in place
 *    (`writer.ts`), so a line said while it runs stands after all of it.
 * 4. A spoken turn draws as a typed one does: its words, its runs of calls
 *    folded as any turn's are, and its foot.
 * 5. A call is marked by its start and end alone: its lines are drawn as
 *    any line of the member's and any reply of the agent's are, so two calls
 *    into the agent at once interleave by `seq` between their own starts
 *    and ends.
 * 6. A call is drawn from the moment it opens, by its row, which stands
 *    exactly while the call does (`standing`): its start after every row
 *    until its first line lands, dated and named by the row, and no end
 *    while it stands. Once it ends, its marks are its lines' alone, so a
 *    call nobody spoke on leaves no trace.
 *
 * A call starts before the row its first line stands in and ends after the
 * row its last stands in, a line a turn took in under way standing in that
 * turn's row (`placedMessages`). Each edge case is a row of
 * `voice-call-lines.test.ts`'s table, so a change cannot break one quietly.
 */
export function callItemsOf(
  rows: readonly PlacedRow[],
  standing: readonly AgentStandingCall[] = [],
): readonly CallItem[] {
  const stands = new Map(standing.map((call) => [call.callId, call]));
  const lined = spansOf(rows, stands);
  const spans = [...lined.values()];

  const drawn = rows.flatMap(({ message }): CallItem[] => [
    ...spans.flatMap((span) =>
      span.opensIn === message.id ? [{ kind: CALL_ITEM.START, span }] : [],
    ),
    { kind: CALL_ITEM.ROW, message },
    ...spans.flatMap((span) =>
      span.closesIn === message.id && !stands.has(span.callId)
        ? [{ kind: CALL_ITEM.END, span }]
        : [],
    ),
  ]);

  const opening = standing.flatMap((call): CallItem[] =>
    lined.has(call.callId) ? [] : [{ kind: CALL_ITEM.START, span: openingSpan(call) }],
  );

  return [...drawn, ...opening];
}

/** Where calls begin and end among a tab's rows, by the id of the row each stands at, and the calls that opened with no line yet. */
export interface CallMarks {
  readonly opens: ReadonlyMap<string, readonly CallSpan[]>;
  readonly closes: ReadonlyMap<string, readonly CallSpan[]>;
  /** The calls that stand with no line among the rows yet, whose starts are drawn after every row. */
  readonly opening: readonly CallSpan[];
}

/** The calls' marks among the rows as the tab hangs them on its rows, read off what it draws (`callItemsOf`). */
export function callMarksOf(
  rows: readonly PlacedRow[],
  standing?: readonly AgentStandingCall[],
): CallMarks {
  const opens = new Map<string, CallSpan[]>();
  const closes = new Map<string, CallSpan[]>();
  const opening: CallSpan[] = [];

  for (const item of callItemsOf(rows, standing)) {
    if (item.kind === CALL_ITEM.ROW) continue;

    const marks = item.kind === CALL_ITEM.START ? opens : closes;
    const at = item.kind === CALL_ITEM.START ? item.span.opensIn : item.span.closesIn;

    if (at === undefined) opening.push(item.span);
    else marks.set(at, [...(marks.get(at) ?? []), item.span]);
  }

  return { opens, closes, opening };
}
