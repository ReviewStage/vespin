/**
 * cli-transcript.ts -- an agent's transcript as the `vespin` command prints it for a terminal: who spoke, their words, and one line for each call the agent made.
 *
 * A message's parts are the AI SDK's stored parts (`agent-wire.ts`'s
 * `storedObjectSchema`): words, reasoning, step boundaries, and tool calls.
 * A terminal reads the words and a line per call, its tool's name and what it
 * acted on; the reasoning and the boundaries are left out, and a call's output
 * is printed only where one call is asked for by its id, whole
 * (`wholeCallLines`).
 *
 * A turn under way grows its message in place, so a reader following it
 * prints a message's parts as they settle, in order, and never the same part
 * twice: `transcriptPartLines` answers the lines of the parts past those
 * already printed and how far it got, stopping at the first part still being
 * written unless the turn has ended.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import { TOOL_PART_STATE } from "@repo/wire/ui-messages";
import type { AgentTranscriptMessage } from "./agent-wire.js";

/** How the SDK spells a tool part's type: the tool's name behind this prefix. */
const TOOL_PART_PREFIX = "tool-";

/** The type of a tool part whose name it carries itself. */
const DYNAMIC_TOOL_PART = "dynamic-tool";

/** The type and state of a words part, and the state of one still being written. */
const TEXT_PART = { TYPE: "text", STREAMING: "streaming" } as const;

/** The most characters of what a call acted on its line shows. */
const MAX_SUBJECT_CHARS = 120;

/** The input keys that name what a call acted on, in the order one is looked for. */
const SUBJECT_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "description",
  "prompt",
] as const;

/** What a part is to a terminal: words, a call, or nothing it prints. */
type PrintedPart =
  | { readonly words: string; readonly settled: boolean }
  | { readonly tool: string; readonly subject: string | undefined; readonly settled: boolean }
  | undefined;

/** A stored part, or a call's input, as a terminal reads it: its fields by name, each still to be read. */
type PartFields = Readonly<Record<string, unknown>>;

/** Whether `value` is an object whose fields can be read by name, rather than a primitive or nothing. */
function isPartFields(value: unknown): value is PartFields {
  return typeof value === "object" && value !== null;
}

function stringField(part: PartFields, key: string): string | undefined {
  const value = part[key];

  return typeof value === "string" ? value : undefined;
}

/** What a call acted on, as one short line, from the first input key that names it. */
function subjectOf(input: unknown): string | undefined {
  if (!isPartFields(input)) return undefined;

  for (const key of SUBJECT_KEYS) {
    const value = stringField(input, key)?.trim().split("\n")[0];

    if (value !== undefined && value.length > 0) {
      return value.length > MAX_SUBJECT_CHARS ? `${value.slice(0, MAX_SUBJECT_CHARS)}…` : value;
    }
  }

  return undefined;
}

/** One stored part as a terminal reads it. */
function printedPart(part: PartFields): PrintedPart {
  const type = stringField(part, "type") ?? "";
  const state = stringField(part, "state");

  if (type === TEXT_PART.TYPE) {
    return { words: stringField(part, "text") ?? "", settled: state !== TEXT_PART.STREAMING };
  }

  const tool =
    type === DYNAMIC_TOOL_PART
      ? stringField(part, "toolName")
      : type.startsWith(TOOL_PART_PREFIX)
        ? type.slice(TOOL_PART_PREFIX.length)
        : undefined;

  if (tool === undefined) return undefined;

  return {
    tool,
    subject: subjectOf(part.input),
    settled: state !== TOOL_PART_STATE.INPUT_STREAMING,
  };
}

/** Who wrote a message, as the line above its words names them: the agent, or whoever sent the developer's line. */
export function transcriptSpeaker(message: AgentTranscriptMessage): string {
  if (message.role === MESSAGE_ROLE.ASSISTANT) return "Agent";

  return message.sentBy?.name ?? "You";
}

/**
 * The lines of a message's parts past the first `printed`, and how many of
 * its parts are printed after them: each settled part in order, stopping at
 * the first still being written unless `ended` says the turn will write no
 * more of it.
 */
export function transcriptPartLines(
  message: AgentTranscriptMessage,
  printed: number,
  ended: boolean,
): { readonly lines: readonly string[]; readonly printed: number } {
  const lines: string[] = [];
  let index = printed;

  for (; index < message.parts.length; index += 1) {
    const stored = message.parts[index];
    const part = isPartFields(stored) ? printedPart(stored) : undefined;

    if (part === undefined) continue;

    if (!part.settled && !ended) break;

    if ("words" in part) {
      if (part.words.trim().length > 0) lines.push(part.words.trimEnd());
    } else {
      lines.push(`  ▸ ${part.tool}${part.subject === undefined ? "" : ` ${part.subject}`}`);
    }
  }

  return { lines, printed: index };
}

/** Where a call stands in a transcript: the message it is a part of, and its index among that message's parts. */
export interface TranscriptCallPlace {
  readonly messageId: string;
  readonly index: number;
}

/** The place of the call a transcript's part names by its id; none where no part does. */
export function transcriptCallPlace(
  messages: readonly AgentTranscriptMessage[],
  callId: string,
): TranscriptCallPlace | undefined {
  for (const message of messages) {
    const index = message.parts.findIndex(
      (part) => isPartFields(part) && stringField(part, "toolCallId") === callId,
    );

    if (index >= 0) return { messageId: message.id, index };
  }

  return undefined;
}

/** A call's input or result as words: a string as it is, anything else as its JSON, indented. */
function callWords(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
}

/** One call read whole as a terminal prints it: its tool and where it stands, its input, and its output or its error, each whole. */
export function wholeCallLines(stored: unknown): readonly string[] {
  const part = isPartFields(stored) ? stored : {};
  const printed = printedPart(part);
  const tool = printed !== undefined && "tool" in printed ? printed.tool : "call";
  const state = stringField(part, "state");
  const error = stringField(part, "errorText");
  const output = part.output;

  return [
    `${tool}${state === undefined ? "" : ` (${state})`}`,
    "",
    "Input:",
    callWords(part.input),
    ...(state === TOOL_PART_STATE.OUTPUT_ERROR
      ? ["", "Error:", error ?? ""]
      : output === undefined
        ? []
        : ["", "Output:", callWords(output)]),
  ];
}
