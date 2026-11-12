import { Predicate } from "effect";

/**
 * tool-call-block.ts -- what a tool call's body holds and how its blocks read as words, for every surface that draws a call: its state, its blocks, and the words its cards say.
 *
 * A call's body is the call's input and its answer, each a block of a
 * kind: a command behind its prompt, a patch with its lines marked, words
 * as they are, Markdown drawn as a reply is, or JSON. JSON reads as words (`readableBlock`), an answer
 * that only acknowledges the call is left out (`shownOutput`), and an
 * empty one says "No output". What the words say is the caller's decision
 * (`tool-call-model.ts`); how a block of each kind is drawn is each
 * surface's own, the panel's `tool.tsx` and the iPhone's transcript.
 */

import type { WireValue } from "@repo/wire";

/** The states a tool part may stand in, as the AI SDK spells them. */
export const TOOL_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolState = (typeof TOOL_STATE)[keyof typeof TOOL_STATE];

/** How a block of the body is drawn: a command behind its prompt, a patch with its lines colored, words as they are, Markdown drawn as the agent's own reply is (a memory's words), or JSON. */
export const TOOL_BLOCK = {
  COMMAND: "command",
  PATCH: "patch",
  TEXT: "text",
  MARKDOWN: "markdown",
  JSON: "json",
} as const;

type ToolBlockKind = (typeof TOOL_BLOCK)[keyof typeof TOOL_BLOCK];

export interface ToolBlock {
  readonly kind: ToolBlockKind;
  readonly text: string;
}

/** The prompt a command is drawn behind. */
export const COMMAND_PROMPT = "$ ";

/** What a block's header says it is. */
export const BLOCK_TITLE = {
  INPUT: "Input",
  OUTPUT: "Output",
  TERMINAL: "Terminal",
} as const;

/** What an answer of nothing says in its card's place. */
export const NO_OUTPUT = "No output";

/** What an empty list reads as. */
const NONE = "(none)";

/** The words that only acknowledge a call, which tell a reader nothing the row does not. */
const ACKNOWLEDGMENTS: ReadonlySet<unknown> = new Set(["accepted", "Done.", "done", "ok"]);

/** The keys whose `true` only acknowledges a call, as `{ "ok": true }` does; `true` under any other key is an answer. */
const ACKNOWLEDGING_KEYS: ReadonlySet<string> = new Set(["ok", "success"]);

/** A JSON block's value, or its text where it is no JSON, as a string answer is drawn as it is. */
function blockValue(block: ToolBlock): WireValue {
  try {
    return JSON.parse(block.text);
  } catch {
    return block.text;
  }
}

function isContainer<T>(value: T): value is T & object {
  return Predicate.isObjectOrArray(value);
}

/** A value that stands on its key's line: a scalar, its later lines set in under the first, or an empty list or record as "(none)". */
function leafWords(value: unknown, indent: string): string {
  if (isContainer(value)) return NONE;

  return String(value).replaceAll("\n", `\n${indent}  `);
}

/** A JSON value as indented `key: value` lines and `- item` lines, with no braces or quotes. */
function readableLines(value: unknown, indent: string): string[] {
  if (Array.isArray(value) && value.length === 0) return [`${indent}${NONE}`];

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const [first = "", ...rest] = readableLines(item, `${indent}  `);

      return [`${indent}- ${first.trimStart()}`, ...rest];
    });
  }

  if (!isContainer(value)) return [`${indent}${leafWords(value, indent)}`];

  return Object.entries(value).flatMap(([key, item]) =>
    isContainer(item) && Object.keys(item).length > 0
      ? [`${indent}${key}:`, ...readableLines(item, `${indent}  `)]
      : [`${indent}${key}: ${leafWords(item, indent)}`],
  );
}

/**
 * Whether a block says a call's subject whole, so the row previewing it
 * gives way while the body is drawn: a block that is the subject, as a
 * read's input is its path, or JSON holding it as one of its values, as a
 * search's input holds its pattern. Note that words made from the input
 * rather than copied from it, as a page's name is made from its address,
 * are not said by it, so they stay.
 */
export function blockSays(block: ToolBlock, subject: string | undefined): boolean {
  if (subject === undefined || subject === "") return false;

  if (block.text === subject) return true;

  return block.kind === TOOL_BLOCK.JSON && block.text.includes(`: ${JSON.stringify(subject)}`);
}

/**
 * A block as a reader reads it: JSON as indented words, a record holding
 * one string as that string, and every other kind as it is. Note that it
 * knows no tool: what one tool's answer means is `tool-call-model.ts`'s.
 */
export function readableBlock(block: ToolBlock): ToolBlock {
  if (block.kind !== TOOL_BLOCK.JSON) return block;
  const value = blockValue(block);

  if (!isContainer(value)) return block;
  const [only, ...more] = Object.values(value);

  if (!Array.isArray(value) && Predicate.isString(only) && more.length === 0) {
    return { kind: TOOL_BLOCK.TEXT, text: only };
  }

  return { kind: TOOL_BLOCK.TEXT, text: readableLines(value, "").join("\n") };
}

/**
 * Whether a JSON answer only acknowledges the call, as "accepted",
 * `{ "status": "accepted" }` or `{ "ok": true }` does. Note that `true`
 * acknowledges only under `ok` or `success`, because `{ "exists": true }`
 * is the call's answer.
 */
function acknowledges(block: ToolBlock): boolean {
  if (block.kind !== TOOL_BLOCK.JSON) return false;
  const value = blockValue(block);

  if (!isContainer(value) || Array.isArray(value)) return ACKNOWLEDGMENTS.has(value);
  const entries = Object.entries(value);

  return (
    entries.length > 0 &&
    entries.every(
      ([key, item]) => ACKNOWLEDGMENTS.has(item) || (item === true && ACKNOWLEDGING_KEYS.has(key)),
    )
  );
}

/** The block an answer's card draws, read as words; nothing where the answer only acknowledges the call. */
export function shownOutput(block: ToolBlock): ToolBlock | undefined {
  return acknowledges(block) ? undefined : readableBlock(block);
}

/**
 * The words a call's body draws, as a find counts them before the body is
 * drawn: a command's line and what it printed, then its error; or the
 * input read as words, then the error or else the answer as its card or
 * its "No output" line says it. Note that it reads each block as the cards
 * do, so a find counts what a reader sees.
 */
export function bodyWords(
  input: ToolBlock | undefined,
  output: ToolBlock | undefined,
  errorText: string | undefined,
): readonly string[] {
  if (input?.kind === TOOL_BLOCK.COMMAND) {
    const printed = output === undefined ? "" : readableBlock(output).text;

    return [input.text, printed, errorText ?? ""].filter((words) => words !== "");
  }

  const shown = output === undefined ? undefined : shownOutput(output);
  const answer = shown === undefined || shown.text.trim() !== "" ? shown?.text : NO_OUTPUT;
  const inputWords = input === undefined ? "" : readableBlock(input).text;

  return [inputWords, errorText ?? answer ?? ""].filter((words) => words !== "");
}
