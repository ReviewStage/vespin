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
import type { AgentTranscriptMessage } from "./agent-wire.js";

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

const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;

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

/** A time into a call as a call's clock says it: "0:42", "12:05", "1:02:09". */
export function callClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / SECOND_MS);
  const hours = Math.floor(seconds / HOUR_SECONDS);
  const minutes = Math.floor((seconds % HOUR_SECONDS) / MINUTE_SECONDS);
  const rest = String(seconds % MINUTE_SECONDS).padStart(2, "0");

  return hours === 0
    ? `${minutes}:${rest}`
    : `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
}

/** A call as its rows stand: its id, the caller's first line, when it began, how long it ran, and the rows that hold its first and last lines. */
export interface CallSpan {
  readonly callId: string;
  /** The caller's first line on it, whose sender is whose call it was; none where only the voice's lines stand among the rows. */
  readonly callerLine: AgentTranscriptMessage | undefined;
  /** When its first line among the rows began, on the wall clock. */
  readonly startedAt: number | undefined;
  /** How long it ran: to the end of its last line on the call's clock, or, where its rows keep no such times, from when its first line began to when its last did. */
  readonly lengthMs: number | undefined;
  /** The row the call's first line stands in, which its start is drawn before. */
  readonly opensIn: string;
  /** The row its last line stands in, which its end is drawn after. */
  readonly closesIn: string;
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

/** One thing a tab draws: a call's start or end, or a row, folded where it is a turn the voice retells. */
export type CallItem =
  | { readonly kind: typeof CALL_ITEM.START; readonly span: CallSpan }
  | { readonly kind: typeof CALL_ITEM.END; readonly span: CallSpan }
  | {
      readonly kind: typeof CALL_ITEM.ROW;
      readonly message: AgentTranscriptMessage;
      /** Whether it is a finished turn a spoken ask opened, drawn folded closed, since the voice retells it. */
      readonly folded: boolean;
    };

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

/** The call's span as its rows have said it. */
function spanOf(callId: string, held: HeldSpan): CallSpan {
  const walled =
    held.firstAt === undefined || held.lastAt === undefined
      ? undefined
      : held.lastAt - held.firstAt;

  return {
    callId,
    callerLine: held.callerLine,
    startedAt: held.firstAt,
    lengthMs: held.endMs ?? walled,
    opensIn: held.opensIn,
    closesIn: held.closesIn,
  };
}

/** Each call's span among the rows, from the row its first line stands in to the row its last does. */
function spansOf(rows: readonly PlacedRow[]): ReadonlyMap<string, CallSpan> {
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

  return new Map([...spans].map(([callId, held]) => [callId, spanOf(callId, held)]));
}

/** Whether a line opens a turn: a line of the developer's that is no line of a call, or a line of a call a delegation handed the agent. */
function opensTurn(message: AgentTranscriptMessage): boolean {
  if (message.role !== MESSAGE_ROLE.USER) return false;
  const spoken = spokenLineOf(message);

  return (
    spoken === undefined ||
    (isRecord(message.metadata) && Predicate.isString(message.metadata.delegation_id))
  );
}

/**
 * Whether the turn at `index` among the rows is one to fold: finished, and
 * opened by a spoken ask, the newest line before it that opens a turn
 * (`opensTurn`) being a line of a call. Note that it reads only the turn's
 * own opening line, never what follows it, so small talk said while it ran
 * leaves it folded all the same.
 */
function retold(rows: readonly PlacedRow[], index: number): boolean {
  const turn = rows[index]?.message;

  if (turn === undefined || !isAgentTurn(turn) || turn.finishedAt === undefined) return false;

  for (let at = index - 1; at >= 0; at -= 1) {
    const before = rows[at]?.message;

    if (before === undefined || isAgentTurn(before)) return false;

    if (opensTurn(before)) return spokenLineOf(before) !== undefined;
  }

  return false;
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
 *    stands between rows (its start and its end) and folds a row in place.
 * 2. When into a call a line was said (`from_ms`, `to_ms`) is for the eye
 *    alone, a line's time on hover and a call's length, and orders nothing.
 * 3. A turn is one row, its journal, written as it starts and grown in place
 *    (`writer.ts`), so a line said while it runs stands after all of it.
 * 4. A spoken turn's work reads once: a finished turn a spoken ask opened is
 *    folded closed, one press opening it, since the voice retells it,
 *    wherever that retelling stands. A running turn and a typed one stay
 *    open. Folding never moves a row.
 *
 * A call starts before the row its first line stands in and ends after the
 * row its last stands in, a line a turn took in under way standing in that
 * turn's row (`placedMessages`). Each edge case is a row of
 * `voice-call-lines.test.ts`'s table, so a change cannot break one quietly.
 */
export function callItemsOf(rows: readonly PlacedRow[]): readonly CallItem[] {
  const spans = [...spansOf(rows).values()];

  return rows.flatMap(({ message }, index): CallItem[] => [
    ...spans.flatMap((span) =>
      span.opensIn === message.id ? [{ kind: CALL_ITEM.START, span }] : [],
    ),
    { kind: CALL_ITEM.ROW, message, folded: retold(rows, index) },
    ...spans.flatMap((span) =>
      span.closesIn === message.id ? [{ kind: CALL_ITEM.END, span }] : [],
    ),
  ]);
}

/** Where calls begin and end among a tab's rows, by the id of the row each stands at, and the turns drawn folded. */
export interface CallMarks {
  readonly opens: ReadonlyMap<string, readonly CallSpan[]>;
  readonly closes: ReadonlyMap<string, readonly CallSpan[]>;
  readonly folded: ReadonlySet<string>;
}

/** The calls' marks among the rows as the tab hangs them on its rows, read off what it draws (`callItemsOf`). */
export function callMarksOf(rows: readonly PlacedRow[]): CallMarks {
  const opens = new Map<string, CallSpan[]>();
  const closes = new Map<string, CallSpan[]>();
  const folded = new Set<string>();

  for (const item of callItemsOf(rows)) {
    if (item.kind === CALL_ITEM.ROW) {
      if (item.folded) folded.add(item.message.id);
      continue;
    }

    const marks = item.kind === CALL_ITEM.START ? opens : closes;
    const at = item.kind === CALL_ITEM.START ? item.span.opensIn : item.span.closesIn;
    marks.set(at, [...(marks.get(at) ?? []), item.span]);
  }

  return { opens, closes, folded };
}
