/**
 * agent-parts.ts -- a coding agent's stored messages as every transcript draws them: each message's parts read for drawing, a turn's parts folded into rows (`turn-rows.ts`), and the lines that reached a turn while it ran placed where they arrived.
 *
 * Pure decisions over the wire's shapes, which the panel's agent tab and
 * the iPhone's agent page both read, so the two draw one transcript: a
 * stored part is read forgivingly (`agentPart`), a native harness's call as
 * the call of the same kind (`native-tool-calls.ts`); a message's parts
 * leave out step boundaries and a `connection_execute` its integration's
 * own call stands for, and join a run of shown sets into one; a delegation
 * is a subagent, a start of an agent counted apart, and a to-do list, a
 * set of pictures, a page, and a recording stand on rows of their own that
 * a finished turn never folds away. Nothing here draws.
 */

import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type UnparsedWireValue,
  type WireValue,
} from "@repo/wire";
import {
  COMPACTED_PART,
  CONNECTION_LOST_PART,
  type CompactedNotice,
  CompactedNoticeSchema,
  type ConnectionLostNotice,
  ConnectionLostNoticeSchema,
  SESSION_CLEARED_PART,
  USAGE_LIMIT_PART,
  UsageLimitAnswerSchema,
  type UsageLimitNotice,
  UsageLimitNoticeSchema,
} from "@repo/wire/ui-messages";
import { Option, Predicate, Schema } from "effect";
import { recordedVideosOf } from "./agent-pictures-model.js";
import {
  AGENT_TOOL,
  CLAUDE_CODE_TOOL,
  CONNECTION_TOOL,
  EVE_TOOL,
  RETIRED_TOOL,
} from "./agent-tools.js";
import {
  AGENT_DELEGATE_TOOL,
  type AgentTranscriptMessage,
  PART_CUT_FIELD,
  type PartCut,
} from "./agent-wire.js";
import { drawnCall } from "./native-tool-calls.js";
import { formatBytes } from "./number-format.js";
import { TOOL_STATE, type ToolState } from "./tool-call-block.js";
import {
  computerAppIcon,
  computerAppName,
  remoteCallOf,
  TOOL_TARGET,
  toolTarget,
} from "./tool-call-model.js";
import { ROW_PART, type RowReading, TURN_ROW, type TurnRow, turnRows } from "./turn-rows.js";

/** The kinds of part a stored message holds that the tab draws apart. */
export const AGENT_PART = {
  USAGE_LIMIT: USAGE_LIMIT_PART,
  CONNECTION_LOST: CONNECTION_LOST_PART,
  /** Where the harness compacted its session. */
  COMPACTED: COMPACTED_PART,
  /** Where the agent's harness was started on a fresh session (`/clear`). */
  SESSION_CLEARED: SESSION_CLEARED_PART,
  TEXT: "text",
  REASONING: "reasoning",
  TOOL: "tool",
  STEP_START: "step-start",
  /** A part of a kind this build does not draw, which is skipped rather than refused. */
  OTHER: "other",
  /** One of the developer's lines that reached the turn while it ran, drawn among the turn's parts where it arrived; never a part a message stores. */
  ARRIVED: "arrived",
} as const;

/** How the SDK spells a tool part's type: the tool's name behind this prefix. */
const TOOL_PART_TYPE_PREFIX = "tool-";

const TOOL_STATES: ReadonlySet<string> = new Set(Object.values(TOOL_STATE));

/** A part its page carried cut (`cutParts`): its two ends and its whole size, and the message and index it is fetched whole by. */
export type AgentPartCut = Omit<PartCut, "field"> & { readonly messageId: string };

/** Where a cut part's whole read (`AGENTS_PART`) stands: not asked, under way, read, or failed, which leaves it at its ends. */
export const WHOLE_PART = {
  CUT: "cut",
  READING: "reading",
  WHOLE: "whole",
  FAILED: "failed",
} as const;

export type WholePartState = (typeof WHOLE_PART)[keyof typeof WHOLE_PART];

/** A cut part's whole read as a client holds it once asked: under way, failed, or read whole. */
export type WholePartRead =
  | { readonly state: typeof WHOLE_PART.READING | typeof WHOLE_PART.FAILED }
  | { readonly state: typeof WHOLE_PART.WHOLE; readonly part: WireValue };

/** What a cut part's body says while its whole is read, by what it is. */
export const CUT_PART_WORDS = {
  THOUGHT: "Reading the whole thought…",
  OUTPUT: "Reading the whole output…",
} as const;

/** A cut part's two ends, the middle that could not be read said between them, as a part whose whole read failed draws. */
export function cutPartText(cut: Pick<AgentPartCut, "head" | "tail" | "bytes">): string {
  return `${cut.head}\n\n… ${formatBytes(cut.bytes)} in all; only its start and end could be read …\n\n${cut.tail}`;
}

/** One part of a stored message as the tab draws it. */
export type AgentPart =
  | { readonly kind: typeof AGENT_PART.USAGE_LIMIT; readonly notice: UsageLimitNotice }
  | { readonly kind: typeof AGENT_PART.CONNECTION_LOST; readonly notice: ConnectionLostNotice }
  | { readonly kind: typeof AGENT_PART.COMPACTED; readonly notice: CompactedNotice }
  | { readonly kind: typeof AGENT_PART.SESSION_CLEARED }
  | { readonly kind: typeof AGENT_PART.TEXT; readonly text: string }
  | {
      readonly kind: typeof AGENT_PART.REASONING;
      /** Empty on a thought its page carried cut, whose words `cut` holds the ends of. */
      readonly text: string;
      readonly cut?: AgentPartCut;
    }
  | {
      readonly kind: typeof AGENT_PART.TOOL;
      readonly tool: string;
      readonly callId: string;
      readonly state: ToolState;
      readonly input: WireValue | undefined;
      /** None while the call has not answered, and on a call whose answer its page carried cut, which `cut` holds the ends of. */
      readonly output: WireValue | undefined;
      /** The error's own text, on a call that ended in one. */
      readonly errorText: string | undefined;
      readonly cut?: AgentPartCut;
    }
  | { readonly kind: typeof AGENT_PART.STEP_START }
  | { readonly kind: typeof AGENT_PART.OTHER }
  | { readonly kind: typeof AGENT_PART.ARRIVED; readonly line: AgentTranscriptMessage };

function toolState(value: WireValue | undefined): ToolState {
  // SAFETY: membership in the set built from TOOL_STATE's values is what the union names.
  return isWireString(value) && TOOL_STATES.has(value)
    ? (value as ToolState)
    : TOOL_STATE.INPUT_AVAILABLE;
}

/**
 * A stored part read for drawing. The row carries the SDK's own vocabulary
 * rather than one this wire declares, so the read is forgiving: a text or
 * reasoning part without its words, and any kind this build does not know,
 * draws nothing rather than refusing the message.
 */
export function agentPart(part: WireValue): AgentPart {
  if (!isRecord(part) || !isWireString(part.type)) return { kind: AGENT_PART.OTHER };

  if (part.type === AGENT_PART.TEXT || part.type === AGENT_PART.REASONING) {
    return isWireString(part.text)
      ? { kind: part.type, text: part.text }
      : { kind: AGENT_PART.OTHER };
  }

  if (part.type === AGENT_PART.USAGE_LIMIT) {
    const notice = Schema.decodeUnknownOption(UsageLimitNoticeSchema)(part.data);

    return Option.isSome(notice)
      ? { kind: AGENT_PART.USAGE_LIMIT, notice: notice.value }
      : { kind: AGENT_PART.OTHER };
  }

  if (part.type === AGENT_PART.CONNECTION_LOST) {
    const notice = Schema.decodeUnknownOption(ConnectionLostNoticeSchema)(part.data);

    return Option.isSome(notice)
      ? { kind: AGENT_PART.CONNECTION_LOST, notice: notice.value }
      : { kind: AGENT_PART.OTHER };
  }

  if (part.type === AGENT_PART.COMPACTED) {
    const notice = Schema.decodeUnknownOption(CompactedNoticeSchema)(part.data);

    return Option.isSome(notice)
      ? { kind: AGENT_PART.COMPACTED, notice: notice.value }
      : { kind: AGENT_PART.OTHER };
  }

  if (part.type === AGENT_PART.SESSION_CLEARED) return { kind: AGENT_PART.SESSION_CLEARED };

  if (part.type === AGENT_PART.STEP_START) return { kind: AGENT_PART.STEP_START };

  if (part.type.startsWith(TOOL_PART_TYPE_PREFIX)) {
    // A native harness's call is read as the call of the same kind, which draws it (`native-tool-calls.ts`).
    const call = drawnCall({
      tool: part.type.slice(TOOL_PART_TYPE_PREFIX.length),
      input: part.input,
      output: part.output,
    });

    return {
      kind: AGENT_PART.TOOL,
      ...call,
      callId: isWireString(part.toolCallId) ? part.toolCallId : "",
      state: toolState(part.state),
      errorText: isWireString(part.errorText) ? part.errorText : undefined,
    };
  }

  return { kind: AGENT_PART.OTHER };
}

/**
 * A part its page carried cut, as the tab draws it: a thought with no words
 * of its own, or a call with no answer of its own, each with the ends it was
 * cut to; a part that is neither draws as it reads.
 */
function cutAgentPart(part: WireValue, cut: PartCut, messageId: string): AgentPart {
  const { field: _field, ...ends } = cut;
  const marked = { ...ends, messageId };

  if (cut.field === PART_CUT_FIELD.TEXT) {
    return { kind: AGENT_PART.REASONING, text: "", cut: marked };
  }

  const read = agentPart(part);

  return read.kind === AGENT_PART.TOOL ? { ...read, cut: marked } : read;
}

/**
 * The call a cut call's whole read answered, read for drawing, where it is
 * the call that was cut (`callId`); none where the read answers another
 * part, as an index read across a deploy that retired a tool would.
 */
export function wholeCallOf(
  read: WireValue,
  callId: string,
): Extract<AgentPart, { readonly kind: typeof AGENT_PART.TOOL }> | undefined {
  const whole = agentPart(read);

  return whole.kind === AGENT_PART.TOOL && whole.callId === callId ? whole : undefined;
}

/** The parts of a message as the tab draws them, in the row's order, each its page carried cut marked so. */
export function agentParts(message: AgentTranscriptMessage): readonly AgentPart[] {
  const read = partsRead.get(message);

  if (read !== undefined) return read;
  const cuts = new Map((message.cutParts ?? []).map((cut) => [cut.index, cut]));

  const parts = message.parts.map((part, index) => {
    const cut = cuts.get(index);

    return cut === undefined ? storedPartRead(part) : cutAgentPart(part, cut, message.id);
  });

  partsRead.set(message, parts);

  return parts;
}

/**
 * The icon each `computer` call's row wears, by its call: the one its answer
 * kept, or, where it kept none, the one the newest call before it on the
 * same app kept, as a call the Mac answered as text or with no icon does; a
 * call no call on its app kept an icon for by then is left out, and wears
 * the placeholder.
 */
export function computerIconsByCall(
  messages: readonly AgentTranscriptMessage[],
): ReadonlyMap<string, string> {
  const byApp = new Map<string, string>();
  const byCall = new Map<string, string>();

  for (const message of messages) {
    for (const part of agentParts(message)) {
      if (part.kind !== AGENT_PART.TOOL || part.tool !== AGENT_TOOL.COMPUTER) continue;
      const app = computerAppName(part.input, part.output);
      const kept = computerAppIcon(part.output);

      if (app !== undefined && kept !== undefined) byApp.set(app, kept);
      const icon = kept ?? (app === undefined ? undefined : byApp.get(app));

      if (icon !== undefined) byCall.set(part.callId, icon);
    }
  }

  return byCall;
}

/**
 * Each stored part as read, by the part: a page that rewrites a message
 * keeps every part it did not touch (`keepIdentity`), so a running turn's
 * thousand parts are read once and each read stays the same value, which
 * lets the rows drawn from them stand as they were drawn.
 */
const partRead = new WeakMap<object, AgentPart>();

/** A stored part read for drawing, once per part. */
function storedPartRead(part: WireValue): AgentPart {
  if (!Predicate.isObjectOrArray(part)) return agentPart(part);
  const read = partRead.get(part);

  if (read !== undefined) return read;
  const fresh = agentPart(part);
  partRead.set(part, fresh);

  return fresh;
}

/**
 * Each message's parts as last read, by the message: a message is never
 * changed in place (a page that rewrites one hands a new one), and a
 * running agent's transcript reads every message's parts on every page.
 */
const partsRead = new WeakMap<AgentTranscriptMessage, readonly AgentPart[]>();

/**
 * The coding agent a call started, read off its answer, which is the agent
 * its row opens; nothing for any other call, one still running, or a start
 * refused, which answers no agent.
 */
export function startedAgentOf(part: AgentPart): string | undefined {
  if (
    part.kind !== AGENT_PART.TOOL ||
    (part.tool !== AGENT_TOOL.START_AGENT && part.tool !== RETIRED_TOOL.START_CODING_AGENT)
  ) {
    return undefined;
  }

  const target = toolTarget(part);

  return target?.kind === TOOL_TARGET.AGENT ? target.agent : undefined;
}

/**
 * Whether a call is a delegation to a worker, a coding agent's, the brain's,
 * or a native harness's subagent (`native-tool-calls.ts` draws Codex's spawn
 * as Claude Code's `Agent`), which the tab draws as a subagent's row rather
 * than a call's.
 */
export function delegates(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): boolean {
  return part.tool === AGENT_DELEGATE_TOOL || part.tool === EVE_TOOL.WORKER || nativeSubagent(part);
}

/**
 * Whether a delegation is a native harness's subagent, whose own work we
 * keep no transcript of yet, so its row opens no worker's tab.
 */
export function nativeSubagent(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
): boolean {
  return part.tool === CLAUDE_CODE_TOOL.AGENT;
}

/** The usage limit's notice a worker's call answered with where the plan's limit ended it, which its row draws in its answer's place; none for any other answer. */
export function callUsageLimit(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
): UsageLimitNotice | undefined {
  const answer = Schema.decodeUnknownOption(UsageLimitAnswerSchema)(part.output);

  return Option.isSome(answer) ? answer.value.usageLimit : undefined;
}

/** Whether a part is a delegation to a worker (`delegates`). */
export function isDelegation(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return part.kind === AGENT_PART.TOOL && delegates(part);
}

/** Claude Code's calls on its task list, each of which the tab draws as the list as it stood after it (`agent-todos.ts`). */
const TASK_CALL_TOOLS: ReadonlySet<string> = new Set([
  CLAUDE_CODE_TOOL.TASK_CREATE,
  CLAUDE_CODE_TOOL.TASK_UPDATE,
  CLAUDE_CODE_TOOL.TASK_LIST,
  CLAUDE_CODE_TOOL.TASK_GET,
]);

/** Whether a tool is one of Claude Code's calls on its task list. */
export function isTaskCall(tool: string): boolean {
  return TASK_CALL_TOOLS.has(tool);
}

/** Whether a tool part carries the agent's to-do list, which the tab draws as the list on a row of its own: a write of the whole list, or a call on Claude Code's task list. */
export function isTodos(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return (
    part.kind === AGENT_PART.TOOL && (part.tool === AGENT_TOOL.WRITE_TODOS || isTaskCall(part.tool))
  );
}

/** How the fold reads a part: its words, its reasoning as a note, a delegation as a subagent, a to-do list and a set of pictures, a page, or a recording shown each on a row of its own, a start that began a coding agent counted apart, and every other call grouped with the calls beside it. */
const AGENT_READING: RowReading<AgentPart> = {
  key: (part, index) => {
    if (part.kind === AGENT_PART.TOOL) return part.callId;

    return part.kind === AGENT_PART.ARRIVED ? part.line.id : String(index);
  },
  part: (part) => {
    if (
      part.kind === AGENT_PART.USAGE_LIMIT ||
      part.kind === AGENT_PART.CONNECTION_LOST ||
      part.kind === AGENT_PART.COMPACTED ||
      part.kind === AGENT_PART.SESSION_CLEARED
    ) {
      return ROW_PART.NOTICE;
    }

    if (part.kind === AGENT_PART.TEXT) return ROW_PART.WORDS;

    if (part.kind === AGENT_PART.ARRIVED) return ROW_PART.ARRIVED;

    if (part.kind !== AGENT_PART.TOOL) return ROW_PART.NOTE;

    if (isDelegation(part)) return ROW_PART.SUBAGENT;

    if (startedAgentOf(part) !== undefined) return ROW_PART.AGENT;

    // Note that what the agent showed is never grouped, because a group folds closed once the agent moves on and would fold the pictures with it.
    return isTodos(part) || isShownSet(part) || isShownPage(part) || keptRecording(part)
      ? ROW_PART.LONE_CALL
      : ROW_PART.CALL;
  },
  running: (part) =>
    part.kind === AGENT_PART.TOOL &&
    (part.state === TOOL_STATE.INPUT_STREAMING || part.state === TOOL_STATE.INPUT_AVAILABLE),
};

/** No subagent's session saying where it stands. */
const NO_WORKERS: ReadonlyMap<string, ToolState> = new Map();

/** What a tab knows of a turn beyond its message, which its rows read. */
interface AgentTurnPlace {
  /** Where each call's subagent stands as its own session says, which its row draws over the call's own state, since a call may settle the moment its worker is under way. */
  readonly workers?: ReadonlyMap<string, ToolState>;
  /** The developer's lines that reached the turn while it ran (`arrivedIn`), each drawn among its parts after the steps it arrived after. */
  readonly arrived?: readonly AgentTranscriptMessage[];
}

/** The `connection_execute` calls among the parts that an integration's own call ran under, by their ids. */
function runConnectionCalls(parts: readonly AgentPart[]): ReadonlySet<string> {
  return new Set(
    parts.flatMap((part) => {
      const remote =
        part.kind === AGENT_PART.TOOL ? remoteCallOf(part.tool, part.input) : undefined;

      return remote === undefined ? [] : [remote.call.parentCallId];
    }),
  );
}

type ToolPart = Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;

/** Whether a part is a `show_image` call that showed its pictures, which a reader reads as their own and never folds away. */
function isShownSet(part: AgentPart): part is ToolPart {
  return (
    part.kind === AGENT_PART.TOOL &&
    part.tool === AGENT_TOOL.SHOW_IMAGE &&
    part.state === TOOL_STATE.OUTPUT_AVAILABLE &&
    isRecord(part.output) &&
    part.output.status === ACTION_RESULT_STATUS.ACCEPTED
  );
}

/**
 * Whether a part is a `show_page` call, whose page is drawn under its row
 * and, as a set of pictures is, never folds away. Note that the call stands
 * on a row of its own from the moment it starts, not only once it showed
 * its page, so a row opened while it runs stays open as the page lands.
 */
function isShownPage(part: AgentPart): boolean {
  return part.kind === AGENT_PART.TOOL && part.tool === AGENT_TOOL.SHOW_PAGE;
}

/** Whether a part is a browser call that kept a recording, which a reader watches as a shown set and never folds away. */
function keptRecording(part: AgentPart): boolean {
  return part.kind === AGENT_PART.TOOL && recordedVideosOf(part.tool, part.output).length > 0;
}

/**
 * A `show_image` call its tool refused, as the call that failed it is: the
 * service answers a refusal as an output carrying why, so the row reads
 * the reason as its error, its line wears the failed mark, and no picture
 * waits for bytes that were never kept; nothing for any other part.
 */
function refusedSet(part: AgentPart): ToolPart | undefined {
  if (part.kind !== AGENT_PART.TOOL || part.tool !== AGENT_TOOL.SHOW_IMAGE) return undefined;

  if (part.state !== TOOL_STATE.OUTPUT_AVAILABLE || !isRecord(part.output)) return undefined;
  const reason = part.output.reason;

  if (part.output.status !== ACTION_RESULT_STATUS.REJECTED || !isWireString(reason))
    return undefined;

  return { ...part, state: TOOL_STATE.OUTPUT_ERROR, errorText: reason };
}

function listOf(value: UnparsedWireValue, key: string): readonly WireValue[] {
  if (!isRecord(value)) return [];
  const list = value[key];

  return Array.isArray(list) ? list : [];
}

/** Two shown sets as one: the first's call, both sets' pictures in order. */
function joinedSets(first: ToolPart, second: ToolPart): ToolPart {
  return {
    ...first,
    input: { images: [...listOf(first.input, "images"), ...listOf(second.input, "images")] },
    output: {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      pictures: [...listOf(first.output, "pictures"), ...listOf(second.output, "pictures")],
    },
  };
}

/**
 * The parts of a message a row is drawn from: every part but a step
 * boundary, a kind this build does not draw, and a `connection_execute`
 * whose integration's own call stands in the message; and every run of
 * shown sets, one straight after another, joined into one set, as the
 * parallel calls of one step are meant to be. Note that such a wrapper is
 * left out, because the call it ran is the same call told twice, and that
 * one with no such call, or one that failed, keeps its row, because its row
 * is where it, or its error, is read. Each line that reached the turn
 * while it ran stands ahead of the first step after the steps it arrived
 * after, or at the end where that step has not begun.
 */
function drawnParts(
  message: AgentTranscriptMessage,
  arrived: readonly AgentTranscriptMessage[] = [],
): readonly AgentPart[] {
  const parts = agentParts(message);
  const ran = runConnectionCalls(parts);
  const drawn: AgentPart[] = [];
  const waiting = arrived.toSorted((a, b) => afterStepOf(a) - afterStepOf(b));
  let begun = 0;

  const arrive = (steps: number) => {
    while (waiting[0] !== undefined && afterStepOf(waiting[0]) <= steps) {
      const line = waiting.shift();

      if (line !== undefined) drawn.push({ kind: AGENT_PART.ARRIVED, line });
    }
  };

  for (const part of parts) {
    if (part.kind === AGENT_PART.STEP_START) {
      arrive(begun);
      begun += 1;
      continue;
    }

    if (part.kind === AGENT_PART.OTHER) continue;

    if (
      part.kind === AGENT_PART.TOOL &&
      part.tool === CONNECTION_TOOL.EXECUTE &&
      part.state !== TOOL_STATE.OUTPUT_ERROR &&
      ran.has(part.callId)
    ) {
      continue;
    }

    const last = drawn.at(-1);
    const refusal = refusedSet(part);

    if (refusal !== undefined) {
      drawn.push(refusal);
      continue;
    }

    if (last !== undefined && isShownSet(last) && isShownSet(part)) {
      drawn[drawn.length - 1] = joinedSets(last, part);
    } else {
      drawn.push(part);
    }
  }

  arrive(Number.POSITIVE_INFINITY);

  return drawn;
}

/** The steps of its turn a line arrived after; none for a line no turn took in under way. */
function afterStepOf(line: AgentTranscriptMessage): number {
  return line.arrivedIn?.afterStep ?? 0;
}

/** How a turn ended where it ended with `end_turn`: the summary its developer reads as its reply, and the follow-ups it offered, at most three. */
export interface TurnEnding {
  readonly summary: string;
  readonly followUps: readonly string[];
}

/**
 * A turn's last `end_turn`, where that call was taken: its summary, which is
 * what its developer reads as the turn's reply, and its follow-ups; none where
 * the turn ended no other way than in its own words, or the call was refused
 * or has not answered.
 */
export function endTurnOf(parts: readonly AgentPart[]): TurnEnding | undefined {
  // Note that the last call stands for the turn, so a later refused one hides an earlier one taken.
  const ended = parts.findLast(
    (part) => part.kind === AGENT_PART.TOOL && part.tool === AGENT_TOOL.END_TURN,
  );

  if (
    ended?.kind !== AGENT_PART.TOOL ||
    ended.state !== TOOL_STATE.OUTPUT_AVAILABLE ||
    // Note that a call a turn ended before it answered is kept as available too, so only an answer that took it counts.
    !isRecord(ended.output) ||
    ended.output.status !== ACTION_RESULT_STATUS.ACCEPTED ||
    !isRecord(ended.input)
  ) {
    return undefined;
  }

  const { summary, followUps } = ended.input;

  if (!isWireString(summary) || summary.trim() === "") return undefined;

  const offered = Array.isArray(followUps)
    ? followUps.flatMap((each) => (isWireString(each) && each.trim() !== "" ? [each.trim()] : []))
    : [];

  // Note that the tool takes a follow-up twice, and one offered twice is one to tick.
  return { summary: summary.trim(), followUps: [...new Set(offered)] };
}

/** The summary of a turn's last `end_turn` that was taken (`endTurnOf`), its reply. */
export function endTurnSummary(parts: readonly AgentPart[]): string | undefined {
  return endTurnOf(parts)?.summary;
}

/** What a message carries of the follow-ups ticked to send, under the developer's own words. */
export const FOLLOW_UPS_HEAD = "Follow-ups:";

/** The follow-ups ticked, as the lines a message sends them in; none where none is ticked. */
export function followUpsWords(chosen: readonly string[]): string | undefined {
  return chosen.length === 0
    ? undefined
    : [FOLLOW_UPS_HEAD, ...chosen.map((each) => `- ${each}`)].join("\n");
}

/**
 * One of the agent's turns as the rows every transcript draws, folded as
 * `turn-rows.ts` folds a turn. A step boundary and a part
 * this build does not draw are left out, because the parts keep one rhythm
 * across them. The turn moves while the agent may still write to it, which
 * is its last message; any other has ended. A worker's session folds as
 * its agent's does, since a run of calls reads the same whoever made it.
 * The agent's words, its to-do lists, and every set of pictures, page, and
 * recording it showed stand on rows of their own, never folded. A line that
 * reached the turn while it ran (`arrived`) stands among its parts where it
 * arrived.
 */
export function agentRows(
  message: AgentTranscriptMessage,
  moving: boolean,
  { workers = NO_WORKERS, arrived = [] }: AgentTurnPlace = {},
): readonly TurnRow<AgentPart>[] {
  const drawn = drawnParts(message, arrived);
  // Note that a turn that ended with `end_turn` reads its summary as its reply, and the words it wrote on the way as notes, which fold away with its work.
  const summary = moving ? undefined : endTurnSummary(drawn);

  const reply: AgentPart | undefined =
    summary === undefined ? undefined : { kind: AGENT_PART.TEXT, text: summary };

  const parts = reply === undefined ? drawn : [...drawn, reply];

  const reading: RowReading<AgentPart> = {
    ...AGENT_READING,
    part: (part) =>
      reply !== undefined && part.kind === AGENT_PART.TEXT && part !== reply
        ? ROW_PART.NOTE
        : AGENT_READING.part(part),
    running: (part) =>
      AGENT_READING.running(part) ||
      (part.kind === AGENT_PART.TOOL && workers.get(part.callId) === TOOL_STATE.INPUT_AVAILABLE),
  };

  return turnRows(parts, reading, { moving });
}

/** One of a transcript's rows as the tab draws it, with the developer's lines that reached it while its turn ran. */
export interface PlacedMessage {
  readonly message: AgentTranscriptMessage;
  /** The lines its turn took in under way (`arrivedIn`), oldest first; none on any row but a turn's journal. */
  readonly arrived: readonly AgentTranscriptMessage[];
}

/**
 * The rows with each line that follows the newest turn while it is still
 * open placed in that turn after the steps it has begun, as a line it takes
 * in is placed once the service says where it arrived. Note that such a
 * line steers the turn, and drawn below it, it would stand the turn as
 * done, offering a finished turn's actions, then move into it as the
 * service takes it. A line that did not go (`unsent`) reached no turn, so
 * it stands where the order puts it.
 */
function steeringPlaced(
  messages: readonly AgentTranscriptMessage[],
  unsent: (id: string) => boolean,
): readonly AgentTranscriptMessage[] {
  const at = messages.findLastIndex((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const journal = messages[at];

  if (journal === undefined || journal.finishedAt !== undefined) return messages;
  const begun = agentParts(journal).filter((part) => part.kind === AGENT_PART.STEP_START).length;
  const arrivedIn = { journalId: journal.id, afterStep: begun };

  return messages.map((message, index) =>
    index > at &&
    message.role === MESSAGE_ROLE.USER &&
    message.arrivedIn === undefined &&
    !unsent(message.id)
      ? { ...message, arrivedIn }
      : message,
  );
}

/**
 * A transcript's rows with each line that reached a turn under way moved
 * into that turn's journal, which draws it where it arrived, out of the
 * order the service keeps, where the journal closed behind it. A line whose
 * journal is not among the rows, as when its page is still to land, stands
 * where the order puts it, as every line does from a service older than it.
 */
export function placedMessages(
  messages: readonly AgentTranscriptMessage[],
  unsent: (id: string) => boolean = () => false,
): readonly PlacedMessage[] {
  const shown = steeringPlaced(messages, unsent);

  const journals = new Set(
    shown.filter((message) => message.role === MESSAGE_ROLE.ASSISTANT).map((each) => each.id),
  );

  const arrived = new Map<string, AgentTranscriptMessage[]>();

  for (const message of shown) {
    const journal = message.arrivedIn?.journalId;

    if (journal === undefined || !journals.has(journal)) continue;
    arrived.set(journal, [...(arrived.get(journal) ?? []), message]);
  }

  return shown.flatMap((message) => {
    const journal = message.arrivedIn?.journalId;

    if (journal !== undefined && journals.has(journal)) return [];

    return [{ message, arrived: arrived.get(message.id) ?? [] }];
  });
}

/** A stretch of a turn's rows as the tab draws it: the turn's own rows, or a line that reached it while it ran, which stands between them as the developer's own message. */
export type TurnStretch =
  | { readonly line: AgentTranscriptMessage; readonly rows?: undefined }
  | { readonly line?: undefined; readonly rows: readonly TurnRow<AgentPart>[] };

/** A turn's rows cut at every line that reached it while it ran, so the tab draws each line as a message of its own between the turn's work before and after it. */
export function turnStretches(rows: readonly TurnRow<AgentPart>[]): readonly TurnStretch[] {
  const stretches: TurnStretch[] = [];
  let run: TurnRow<AgentPart>[] = [];

  for (const row of rows) {
    if (row.kind !== TURN_ROW.BLOCK || row.block.kind !== AGENT_PART.ARRIVED) {
      run.push(row);
      continue;
    }

    if (run.length > 0) stretches.push({ rows: run });
    run = [];
    stretches.push({ line: row.block.line });
  }

  if (run.length > 0 || stretches.length === 0) stretches.push({ rows: run });

  return stretches;
}

/** A message's words: the summary of the turn's `end_turn` where it ended with one, which is its reply, or else its text parts, one paragraph each; what a copy of a turn carries and what the developer's line reads as. */
export function messageWords(message: AgentTranscriptMessage): string {
  const parts = agentParts(message);

  return (
    endTurnSummary(parts) ??
    parts.flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : [])).join("\n\n")
  );
}
