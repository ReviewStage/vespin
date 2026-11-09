/**
 * native-history.ts -- a continued or forked agent's history carried to the other harness as native turns: a Claude Code session translated into the Responses items a new Codex thread is injected with, and a Codex rollout into the Claude Code session entries a Claude Code agent forks, fitted to the new agent's window.
 *
 * A Start from an agent on the other harness hands the new agent its
 * source's conversation as that harness's own turns rather than as text in
 * its first message (`takeover.ts`). Each direction reads the source as its
 * CLI keeps it at the service (`claude-session-entries.ts`), cut where the
 * Start cuts it, and writes what the other harness reads:
 *
 * - A Claude Code session's main chain, walked back from its leaf, or from
 *   just before the line a fork cuts at, becomes Responses items. Its tools
 *   map to Codex's own: Bash to `exec_command`; Read, Grep, and Glob to
 *   `exec_command` with the equivalent command and the verbatim output; an
 *   image's Read to `view_image`; Edit, MultiEdit, and Write to an
 *   `apply_patch` call; TodoWrite to `update_plan`; and an MCP tool to a
 *   `function_call` under its server's namespace, which both harnesses name
 *   alike. Note that a tool Codex has no counterpart for (Agent, Task,
 *   WebFetch, WebSearch, Skill, and the rest) is carried as a note in the
 *   assistant's words, because no live call has yet shown that OpenAI's API
 *   takes a call to a function its request does not list.
 * - A Codex rollout's `response_item` lines, its segments joined where a
 *   revert started one and its `compacted` lines honored, become Claude
 *   Code messages, each call paired with its result in the next message and
 *   its id rewritten to the pattern Anthropic's API holds a `tool_use` id
 *   to; `exec_command` maps back to Bash, `update_plan` to TodoWrite,
 *   `view_image` to Read, a namespaced call to `mcp__<server>__<tool>`, and
 *   an `apply_patch` of one file to Edit, MultiEdit, or Write, any other
 *   keeping its name, which Anthropic's API takes in history.
 *
 * Reasoning carries as visible text alone, never as either provider's
 * sealed form, which the other refuses: Claude's thinking text, and Codex's
 * reasoning summaries, each as the assistant's words. The history is fitted
 * to `NATIVE_HISTORY.WINDOW_SHARE` of the new agent's window, newest turns
 * first, the thinking dropped before any turn is, and the turns that do not
 * fit summarized by the replay's own summarizer (`replay-summary.ts`) into
 * a message placed first. Note that Codex does not compact before the first
 * turn after an injection, so the fit is the only bound that turn has.
 */

import { RUNNER_TRANSCRIPTS } from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  readSessionRows,
  type SessionEntryKey,
  type SessionRow,
} from "@repo/database/models/claude-session-entries";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import type { ReplayStep, ReplaySummary } from "@repo/features/agent-replay";
import { REPLAY_STEP_KIND } from "@repo/features/agent-replay";
import { Effect, Option, Schema } from "effect";
import type { NativeRuntime } from "./native-runtime.js";
import { REPLAY_FIT, tokensBytes } from "./replay-summary.js";

/** One line of a CLI's transcript as the store keeps it, opaque but for what we read of it. */
export type HistoryEntry = Readonly<Record<string, unknown>>;

const NATIVE_HISTORY = {
  /** The share of the new agent's window its carried history may fill, leaving the rest to its instructions and first turns. */
  WINDOW_SHARE: 0.75,
  /** The most characters of one thinking block or reasoning summary carried as text. */
  THINKING_CHARS: 4_000,
  /** The tokens of one tool output Codex shows its model, past which it cuts the middle out, so the fit counts no more of one. */
  CODEX_OUTPUT_TOKENS: 10_000,
} as const;

/** The Responses API's roles and item types as a Codex thread is injected with them. */
const ITEM = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  CUSTOM_TOOL_CALL: "custom_tool_call",
  CUSTOM_TOOL_CALL_OUTPUT: "custom_tool_call_output",
  REASONING: "reasoning",
  LOCAL_SHELL_CALL: "local_shell_call",
  WEB_SEARCH_CALL: "web_search_call",
} as const;

const ROLE = { USER: "user", ASSISTANT: "assistant" } as const;
type Role = (typeof ROLE)[keyof typeof ROLE];

/** Codex's own tools a translated call names, and the Claude Code tools a translated call names. */
const CODEX_TOOL = {
  EXEC_COMMAND: "exec_command",
  SHELL: "shell",
  APPLY_PATCH: "apply_patch",
  UPDATE_PLAN: "update_plan",
  VIEW_IMAGE: "view_image",
} as const;

const CLAUDE_TOOL = {
  BASH: "Bash",
  READ: "Read",
  GREP: "Grep",
  GLOB: "Glob",
  EDIT: "Edit",
  MULTI_EDIT: "MultiEdit",
  WRITE: "Write",
  TODO_WRITE: "TodoWrite",
} as const;

/** The prefix both harnesses name an MCP server's tools under, and the separator after the server's name. */
const MCP_PREFIX = "mcp__";
const MCP_SEPARATOR = "__";

/** What a call with no result in its history is answered, as Codex answers one a turn's end cut off. */
const ABORTED = "aborted";

/** The image types a Read of which is a picture rather than text. */
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp)$/iu;

/** What Anthropic's API holds a `tool_use` id to. */
const TOOL_ID = /^[a-zA-Z0-9_-]+$/u;

/** A user message Codex writes itself into a thread's history, ahead of the developer's: its environment, AGENTS.md, skills, and an aborted turn's marker. */
const CODEX_CONTEXT_PREFIXES = [
  "<environment_context>",
  "<user_instructions>",
  "# AGENTS.md instructions",
  "<skills_instructions>",
  "<permissions instructions>",
  "<turn_aborted>",
  "<subagent_notification>",
] as const;

/** What heads the message the summary of the turns left out is carried in. */
const SUMMARY_LEAD = "Summary of the earlier part of this conversation, which is left out:";

// -- Claude Code's session, as the store keeps it ------------------------------------------------

const ClaudeTextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
const ClaudeImageBlock = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.Struct({
    type: Schema.Literal("base64"),
    media_type: Schema.String,
    data: Schema.String,
  }),
});
const ClaudeThinkingBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
});
const ClaudeToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Record(Schema.String, Schema.Unknown),
});
const ClaudeToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
  is_error: Schema.optionalKey(Schema.Boolean),
});
const ClaudeBlock = Schema.Union([
  ClaudeTextBlock,
  ClaudeImageBlock,
  ClaudeThinkingBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
]);
type ClaudeBlock = typeof ClaudeBlock.Type;
type ClaudeImage = typeof ClaudeImageBlock.Type;
type ClaudeToolUse = typeof ClaudeToolUseBlock.Type;
type ClaudeToolResult = typeof ClaudeToolResultBlock.Type;

/** Any entry of the chain: what links it to its parent. */
const ChainLink = Schema.Struct({ uuid: Schema.String, parentUuid: Schema.NullOr(Schema.String) });

const ClaudeMessageEntry = Schema.Struct({
  type: Schema.Literals([ROLE.USER, ROLE.ASSISTANT]),
  uuid: Schema.String,
  isSidechain: Schema.optionalKey(Schema.Boolean),
  isMeta: Schema.optionalKey(Schema.Boolean),
  timestamp: Schema.optionalKey(Schema.String),
  message: Schema.Struct({
    content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
  }),
});
type ClaudeMessageEntry = typeof ClaudeMessageEntry.Type;

const decodeLink = Schema.decodeUnknownOption(ChainLink);
const decodeMessageEntry = Schema.decodeUnknownOption(ClaudeMessageEntry);
const decodeBlock = Schema.decodeUnknownOption(ClaudeBlock);
const decodeText = Schema.decodeUnknownOption(ClaudeTextBlock);
const decodeImage = Schema.decodeUnknownOption(ClaudeImageBlock);

// -- Codex's rollout, as the store keeps it ------------------------------------------------------

const RolloutLine = Schema.Struct({
  timestamp: Schema.optionalKey(Schema.String),
  type: Schema.String,
  payload: Schema.optionalKey(Schema.Unknown),
});
type RolloutLine = typeof RolloutLine.Type;

/** Where a line names the turn it belongs to: on its payload, or in the metadata Codex passes through on an item. */
const TurnMark = Schema.Struct({
  turn_id: Schema.optionalKey(Schema.String),
  internal_chat_message_metadata_passthrough: Schema.optionalKey(
    Schema.Struct({ turn_id: Schema.optionalKey(Schema.String) }),
  ),
});
const SessionMeta = Schema.Struct({
  history_base: Schema.optionalKey(Schema.Struct({ end_ordinal_exclusive: Schema.Number })),
});
const Compacted = Schema.Struct({
  message: Schema.String,
  replacement_history: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
});
const UserMessageTaken = Schema.Struct({
  type: Schema.Literal("item_completed"),
  turn_id: Schema.String,
  item: Schema.Struct({
    type: Schema.Literal("UserMessage"),
    client_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
const RolledBack = Schema.Struct({
  type: Schema.Literal("thread_rolled_back"),
  num_turns: Schema.Number,
});

const CodexContent = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["input_text", "output_text"]), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("input_image"), image_url: Schema.String }),
]);
const CodexOutput = Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]);
type CodexOutput = typeof CodexOutput.Type;

const CodexItem = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(ITEM.MESSAGE),
    role: Schema.String,
    content: Schema.Array(Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literal(ITEM.REASONING),
    summary: Schema.Array(Schema.Struct({ text: Schema.String })),
  }),
  Schema.Struct({
    type: Schema.Literal(ITEM.FUNCTION_CALL),
    name: Schema.String,
    namespace: Schema.optionalKey(Schema.String),
    arguments: Schema.String,
    call_id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(ITEM.CUSTOM_TOOL_CALL),
    name: Schema.String,
    input: Schema.String,
    call_id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literals([ITEM.FUNCTION_CALL_OUTPUT, ITEM.CUSTOM_TOOL_CALL_OUTPUT]),
    call_id: Schema.String,
    output: CodexOutput,
  }),
  Schema.Struct({
    type: Schema.Literal(ITEM.LOCAL_SHELL_CALL),
    call_id: Schema.NullOr(Schema.String),
    action: Schema.Struct({
      command: Schema.Array(Schema.String),
      working_directory: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal(ITEM.WEB_SEARCH_CALL),
    action: Schema.optionalKey(Schema.Struct({ query: Schema.optionalKey(Schema.String) })),
  }),
]);
type CodexItem = typeof CodexItem.Type;

/** A Codex item and when its line was written, where the line says. */
interface TimedItem {
  readonly item: CodexItem;
  readonly at: string | undefined;
}

const decodeRolloutLine = Schema.decodeUnknownOption(RolloutLine);
const decodeTurnMark = Schema.decodeUnknownOption(TurnMark);
const decodeSessionMeta = Schema.decodeUnknownOption(SessionMeta);
const decodeCompacted = Schema.decodeUnknownOption(Compacted);
const decodeUserMessageTaken = Schema.decodeUnknownOption(UserMessageTaken);
const decodeRolledBack = Schema.decodeUnknownOption(RolledBack);
const decodeCodexItem = Schema.decodeUnknownOption(CodexItem);
const decodeCodexContent = Schema.decodeUnknownOption(CodexContent);
const decodeArguments = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

// -- What each direction writes ------------------------------------------------------------------

/** A Responses item as a Codex thread is injected with it. */
export type ResponsesItem = Readonly<Record<string, unknown>>;

/** A message of a Claude Code conversation, as an entry's `message` holds it, and when it was written where the source says. */
export interface ClaudeMessage {
  readonly role: Role;
  readonly content: readonly Readonly<Record<string, unknown>>[];
  readonly at?: string | undefined;
}

/** A history as turns, each opened by a prompt of the developer's, its items in order. */
export type HistoryTurns<Item> = readonly (readonly Item[])[];

/** A translated history fitted to its window: the turns kept, and the summary of those left out where one was written, or how many were left out where none was. */
export interface FittedHistory<Item> {
  readonly kept: HistoryTurns<Item>;
  readonly dropped: HistoryTurns<Item>;
}

/** How one side's items are measured, told apart, and read for a summary. */
export interface HistorySide<Item> {
  /** The bytes the item takes of the window, in the replay's two to a token. */
  readonly bytes: (item: Item) => number;
  /** The item with its thinking carried as text taken out, which is dropped before any turn is; none where it held thinking alone. */
  readonly withoutThought: (item: Item) => Item | undefined;
  /** Whether the item is a call's result alone, which may never open what is kept, since its call would be gone. */
  readonly result: (item: Item) => boolean;
  /** The item as a replay step, for the summary of the turns left out. */
  readonly step: (item: Item) => ReplayStep;
}

// -- Shared helpers ------------------------------------------------------------------------------

/** UTF-8 bytes of a string. */
function utf8(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** A word quoted for a POSIX shell. */
function quoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Thinking text held to its cap. */
function cappedThought(text: string): string {
  return text.length <= NATIVE_HISTORY.THINKING_CHARS
    ? text
    : `${text.slice(0, NATIVE_HISTORY.THINKING_CHARS)}…`;
}

/** An object's string field, where it has one. */
function stringField(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** An object's number field, where it has one. */
function numberField(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

/** A path made absolute against the checkout where it is relative. */
function absoluteIn(cwd: string, path: string): string {
  return path.startsWith("/") ? path : `${cwd.replace(/\/$/u, "")}/${path}`;
}

/** The turns, each opened by an item `opens` says opens one; items before the first open a turn of their own. */
function turnsOf<Item>(items: readonly Item[], opens: (item: Item) => boolean): Item[][] {
  const turns: Item[][] = [];
  for (const item of items) {
    const last = turns.at(-1);
    if (last === undefined || opens(item)) turns.push([item]);
    else last.push(item);
  }
  return turns;
}

// -- Claude Code → Codex -------------------------------------------------------------------------

/** The user's or the assistant's text as a Responses message. */
function codexMessage(
  role: Role,
  content: readonly Readonly<Record<string, unknown>>[],
): ResponsesItem {
  return { type: ITEM.MESSAGE, role, content };
}

function codexText(role: Role, text: string): ResponsesItem {
  return codexMessage(role, [{ type: role === ROLE.USER ? "input_text" : "output_text", text }]);
}

/** A Claude image as a data URL, which Codex takes in a message or a call's output. */
function imageUrl(image: ClaudeImage): string {
  return `data:${image.source.media_type};base64,${image.source.data}`;
}

/** A tool result's content as text, its images left out. */
function resultText(result: ClaudeToolResult | undefined): string {
  if (result?.content === undefined) return result === undefined ? ABORTED : "";
  if (typeof result.content === "string") return result.content;
  return result.content
    .flatMap((block) => Option.toArray(decodeText(block)))
    .map((block) => block.text)
    .join("\n");
}

/** A tool result's content as Codex takes a call's output: text where it is text alone, its blocks with images as data URLs otherwise. */
function codexOutputOf(result: ClaudeToolResult | undefined): CodexOutput {
  if (result === undefined || typeof result.content === "string" || result.content === undefined) {
    return resultText(result);
  }
  const parts = result.content.flatMap((block): Readonly<Record<string, unknown>>[] => {
    const text = decodeText(block);
    if (Option.isSome(text)) return [{ type: "input_text", text: text.value.text }];
    const image = decodeImage(block);
    return Option.isSome(image) ? [{ type: "input_image", image_url: imageUrl(image.value) }] : [];
  });
  return parts.some((part) => part.type === "input_image") ? parts : resultText(result);
}

/** A `function_call` and its output, the call's arguments written as Codex reads them. */
function codexCall(
  id: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  output: CodexOutput,
  namespace?: string,
): ResponsesItem[] {
  return [
    {
      type: ITEM.FUNCTION_CALL,
      name,
      ...(namespace === undefined ? undefined : { namespace }),
      arguments: JSON.stringify(args),
      call_id: id,
    },
    { type: ITEM.FUNCTION_CALL_OUTPUT, call_id: id, output },
  ];
}

/** The shell command a Read, a Grep, or a Glob stands for, whose output the call's own was. */
function commandOf(use: ClaudeToolUse): string | undefined {
  const { input } = use;
  if (use.name === CLAUDE_TOOL.READ) {
    const path = stringField(input, "file_path");
    if (path === undefined) return undefined;
    const offset = numberField(input, "offset");
    const limit = numberField(input, "limit");
    const read = `cat -n -- ${quoted(path)}`;
    if (offset === undefined && limit === undefined) return read;
    const first = offset ?? 1;
    const last = limit === undefined ? "$" : String(first + limit - 1);
    return `${read} | sed -n '${first},${last}p'`;
  }
  if (use.name === CLAUDE_TOOL.GLOB) {
    const pattern = stringField(input, "pattern");
    if (pattern === undefined) return undefined;
    const path = stringField(input, "path");
    return `rg --files --glob ${quoted(pattern)}${path === undefined ? "" : ` ${quoted(path)}`}`;
  }
  if (use.name === CLAUDE_TOOL.GREP) {
    const pattern = stringField(input, "pattern");
    if (pattern === undefined) return undefined;
    const mode = stringField(input, "output_mode") ?? "files_with_matches";
    const flags = [
      mode === "files_with_matches" ? "-l" : mode === "count" ? "-c" : "-n",
      input["-i"] === true ? "-i" : undefined,
      input.multiline === true ? "-U --multiline-dotall" : undefined,
      ...(["-A", "-B", "-C"] as const).map((flag) => {
        const lines = numberField(input, flag);
        return lines === undefined ? undefined : `${flag} ${lines}`;
      }),
      stringField(input, "glob") === undefined
        ? undefined
        : `--glob ${quoted(stringField(input, "glob") ?? "")}`,
      stringField(input, "type") === undefined
        ? undefined
        : `--type ${quoted(stringField(input, "type") ?? "")}`,
    ].filter((flag) => flag !== undefined);
    const path = stringField(input, "path");
    const head = numberField(input, "head_limit");
    return [
      "rg",
      ...flags,
      "-e",
      quoted(pattern),
      ...(path === undefined ? [] : [quoted(path)]),
      ...(head === undefined ? [] : ["|", "head", "-n", String(head)]),
    ].join(" ");
  }
  return undefined;
}

/** The lines of a text as a patch adds or removes them. */
function patchLines(mark: "+" | "-", text: string): string[] {
  return text === "" ? [] : text.split("\n").map((line) => `${mark}${line}`);
}

/** An Edit's or a MultiEdit's replacements, or a Write's content, as the `apply_patch` envelope Codex writes. */
function patchOf(use: ClaudeToolUse): string | undefined {
  const path = stringField(use.input, "file_path");
  if (path === undefined) return undefined;
  if (use.name === CLAUDE_TOOL.WRITE) {
    const content = stringField(use.input, "content") ?? "";
    return [
      "*** Begin Patch",
      `*** Add File: ${path}`,
      ...patchLines("+", content.replace(/\n$/u, "")),
      "*** End Patch",
    ].join("\n");
  }
  const edits =
    use.name === CLAUDE_TOOL.MULTI_EDIT && Array.isArray(use.input.edits)
      ? use.input.edits.filter(
          (edit): edit is Readonly<Record<string, unknown>> =>
            typeof edit === "object" && edit !== null,
        )
      : [use.input];
  const hunks = edits.flatMap((edit) => [
    "@@",
    ...patchLines("-", stringField(edit, "old_string") ?? ""),
    ...patchLines("+", stringField(edit, "new_string") ?? ""),
  ]);
  return ["*** Begin Patch", `*** Update File: ${path}`, ...hunks, "*** End Patch"].join("\n");
}

/** A TodoWrite's list as `update_plan`'s plan, whose statuses are the same three. */
function planOf(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const todos = Array.isArray(input.todos) ? input.todos : [];
  const plan = todos.flatMap((todo) => {
    if (typeof todo !== "object" || todo === null) return [];
    const each = todo as Readonly<Record<string, unknown>>;
    const step = stringField(each, "content");
    return step === undefined ? [] : [{ step, status: stringField(each, "status") ?? "pending" }];
  });
  return { plan };
}

/** A call no Codex tool stands for, as a note in the assistant's words: its tool, its input, and its result. */
function codexNote(use: ClaudeToolUse, result: ClaudeToolResult | undefined): ResponsesItem {
  const failed = result?.is_error === true ? " It failed:" : " Its result:";
  return codexText(
    ROLE.ASSISTANT,
    `[I called the tool ${use.name}, which this harness does not have, with ${JSON.stringify(use.input)}.${failed}]\n${resultText(result)}`,
  );
}

/** One Claude Code call and its result as Codex's own call and output, or as a note where Codex has no counterpart. */
function codexItemsOfCall(
  use: ClaudeToolUse,
  result: ClaudeToolResult | undefined,
): ResponsesItem[] {
  const output = codexOutputOf(result);
  const id = use.id;
  if (use.name.startsWith(MCP_PREFIX)) {
    const rest = use.name.slice(MCP_PREFIX.length);
    const at = rest.indexOf(MCP_SEPARATOR);
    if (at > 0) {
      const namespace = `${MCP_PREFIX}${rest.slice(0, at)}${MCP_SEPARATOR}`;
      return codexCall(id, rest.slice(at + MCP_SEPARATOR.length), use.input, output, namespace);
    }
  }
  switch (use.name) {
    case CLAUDE_TOOL.BASH: {
      const cmd = stringField(use.input, "command");
      if (cmd !== undefined) return codexCall(id, CODEX_TOOL.EXEC_COMMAND, { cmd }, output);
      break;
    }
    case CLAUDE_TOOL.READ: {
      const path = stringField(use.input, "file_path");
      if (path !== undefined && (IMAGE_FILE.test(path) || typeof output !== "string")) {
        return codexCall(id, CODEX_TOOL.VIEW_IMAGE, { path }, output);
      }
      const cmd = commandOf(use);
      if (cmd !== undefined) return codexCall(id, CODEX_TOOL.EXEC_COMMAND, { cmd }, output);
      break;
    }
    case CLAUDE_TOOL.GREP:
    case CLAUDE_TOOL.GLOB: {
      const cmd = commandOf(use);
      if (cmd !== undefined) return codexCall(id, CODEX_TOOL.EXEC_COMMAND, { cmd }, output);
      break;
    }
    case CLAUDE_TOOL.EDIT:
    case CLAUDE_TOOL.MULTI_EDIT:
    case CLAUDE_TOOL.WRITE: {
      const patch = patchOf(use);
      if (patch === undefined) break;
      return [
        { type: ITEM.CUSTOM_TOOL_CALL, name: CODEX_TOOL.APPLY_PATCH, input: patch, call_id: id },
        { type: ITEM.CUSTOM_TOOL_CALL_OUTPUT, call_id: id, output },
      ];
    }
    case CLAUDE_TOOL.TODO_WRITE:
      return codexCall(id, CODEX_TOOL.UPDATE_PLAN, planOf(use.input), output);
  }
  return [codexNote(use, result)];
}

/** The blocks of an entry's message: its words as one text block where it holds a string. */
function blocksOf(entry: ClaudeMessageEntry): ClaudeBlock[] {
  const { content } = entry.message;
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
  return content.flatMap((block) => Option.toArray(decodeBlock(block)));
}

/**
 * The main chain of a Claude Code session, oldest first: walked back by
 * `parentUuid` from its leaf, the last message of the main transcript that
 * no side chain holds, or, where `cutBefore` names one of its entries, from
 * the entry before it, so the chain ends just before the line the fork cuts
 * at; whole where it names none of them, as the runner leaves a session it
 * finds no such line in. A compaction's boundary has no parent, so the chain
 * starts at its summary.
 */
function mainChainOf(
  entries: readonly HistoryEntry[],
  cutBefore: string | undefined,
): ClaudeMessageEntry[] {
  const parents = new Map<string, string | null>();
  const messages = new Map<string, ClaudeMessageEntry>();
  let leaf: string | null = null;
  for (const entry of entries) {
    const link = decodeLink(entry);
    if (Option.isNone(link)) continue;
    parents.set(link.value.uuid, link.value.parentUuid);
    const message = decodeMessageEntry(entry);
    if (Option.isSome(message) && message.value.isSidechain !== true) {
      messages.set(link.value.uuid, message.value);
      leaf = link.value.uuid;
    }
  }
  if (cutBefore !== undefined && parents.has(cutBefore)) leaf = parents.get(cutBefore) ?? null;
  const chain: ClaudeMessageEntry[] = [];
  const seen = new Set<string>();
  for (let at = leaf; at !== null && !seen.has(at); at = parents.get(at) ?? null) {
    seen.add(at);
    const message = messages.get(at);
    if (message !== undefined) chain.push(message);
  }
  return chain.reverse();
}

/**
 * A Claude Code session's main chain, cut before the line given where it
 * holds it, as the Responses items a new Codex thread is injected with,
 * grouped by turn: the user's words and images as user messages, the
 * assistant's words and its thinking text as assistant messages, and each
 * call followed by its result (`codexItemsOfCall`), or by an aborted one
 * where the session holds none. A meta entry, which Claude Code writes for
 * itself, is left out, and so is a result whose call is not on the chain.
 */
export function claudeToCodex(
  entries: readonly HistoryEntry[],
  cutBefore: string | undefined,
): HistoryTurns<ResponsesItem> {
  const chain = mainChainOf(entries, cutBefore);
  const results = new Map<string, ClaudeToolResult>();
  for (const entry of chain) {
    for (const block of blocksOf(entry)) {
      if (block.type === "tool_result") results.set(block.tool_use_id, block);
    }
  }
  const items: ResponsesItem[] = [];
  const prompts = new Set<ResponsesItem>();
  for (const entry of chain) {
    if (entry.isMeta === true) continue;
    const blocks = blocksOf(entry);
    if (entry.type === ROLE.USER) {
      const content = blocks.flatMap((block): Readonly<Record<string, unknown>>[] => {
        if (block.type === "text") return [{ type: "input_text", text: block.text }];
        if (block.type === "image") return [{ type: "input_image", image_url: imageUrl(block) }];
        return [];
      });
      if (content.length === 0) continue;
      const prompt = codexMessage(ROLE.USER, content);
      prompts.add(prompt);
      items.push(prompt);
      continue;
    }
    for (const block of blocks) {
      if (block.type === "text" && block.text !== "") {
        items.push(codexText(ROLE.ASSISTANT, block.text));
      } else if (block.type === "thinking" && block.thinking.trim() !== "") {
        items.push({
          ...codexText(ROLE.ASSISTANT, cappedThought(block.thinking)),
          [THOUGHT]: true,
        });
      } else if (block.type === "tool_use") {
        items.push(...codexItemsOfCall(block, results.get(block.id)));
      }
    }
  }
  return turnsOf(items, (item) => prompts.has(item));
}

/**
 * The mark a thinking block carried as an assistant message holds while it
 * is fitted, so the fit drops it first; it is taken off before the items are
 * written (`withoutMarks`).
 */
const THOUGHT = "vespinThought";

/** The items with the fit's marks taken off, as the thread is injected with them. */
export function withoutMarks(items: readonly ResponsesItem[]): ResponsesItem[] {
  return items.map((item) => {
    if (!(THOUGHT in item)) return item;
    const { [THOUGHT]: _mark, ...rest } = item;
    return rest;
  });
}

/** The text an item's content parts hold, for the summary and the fallback alike. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const read = decodeCodexContent(part);
      if (Option.isNone(read)) return [];
      return read.value.type === "input_image" ? ["[image]"] : [read.value.text];
    })
    .join("\n");
}

/** How Responses items are measured, told apart, and read for a summary as a Codex thread's history. */
export const CODEX_SIDE: HistorySide<ResponsesItem> = {
  bytes: (item) => {
    const images = JSON.stringify(item).match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gu) ?? [];
    const text = utf8(JSON.stringify(item)) - images.reduce((sum, image) => sum + image.length, 0);
    const imagesBytes = images.reduce(
      (sum, image) => sum + Math.max(image.length, tokensBytes(REPLAY_FIT.FILE_TOKENS)),
      0,
    );
    const output =
      item.type === ITEM.FUNCTION_CALL_OUTPUT || item.type === ITEM.CUSTOM_TOOL_CALL_OUTPUT;
    // Note that Codex shows its model no more of one output than its cut, so no more of one is counted.
    const shown = output ? Math.min(text, tokensBytes(NATIVE_HISTORY.CODEX_OUTPUT_TOKENS)) : text;
    return shown + imagesBytes;
  },
  withoutThought: (item) => (THOUGHT in item ? undefined : item),
  result: (item) =>
    item.type === ITEM.FUNCTION_CALL_OUTPUT || item.type === ITEM.CUSTOM_TOOL_CALL_OUTPUT,
  step: (item) => {
    if (item.type === ITEM.MESSAGE) {
      return {
        kind: item.role === ROLE.USER ? REPLAY_STEP_KIND.LINE : REPLAY_STEP_KIND.SAID,
        summary: item.role === ROLE.USER ? "The developer wrote" : "The agent said",
        words: contentText(item.content),
      };
    }
    const named = typeof item.name === "string" ? item.name : "a tool";
    const words =
      typeof item.arguments === "string"
        ? item.arguments
        : typeof item.input === "string"
          ? item.input
          : contentText(item.output);
    return { kind: REPLAY_STEP_KIND.TOOL, summary: `Called ${named}`, words };
  },
};

/** The summary of the turns left out as the user message the injected history opens with. */
export function codexSummaryItem(summary: string): ResponsesItem {
  return codexText(ROLE.USER, `${SUMMARY_LEAD}\n\n${summary}`);
}

// -- Codex → Claude Code -------------------------------------------------------------------------

/** A rollout's files in the order they were written: the thread's own first, then each segment a revert began, by its id, which is time-ordered. */
function segmentsInOrder(
  files: ReadonlyMap<string, readonly HistoryEntry[]>,
): (readonly HistoryEntry[])[] {
  const segmentOf = (subpath: string) => /_([^_/]+)\.jsonl$/u.exec(subpath)?.[1] ?? "";
  return [...files.keys()]
    .sort((a, b) => segmentOf(a).localeCompare(segmentOf(b)))
    .map((subpath) => files.get(subpath) ?? []);
}

/**
 * A thread's lines as its history reads them: each segment a revert began
 * standing on the lines before the ordinal its `history_base` names, the
 * lines past it dropped, then its own lines.
 */
function threadLines(files: ReadonlyMap<string, readonly HistoryEntry[]>): RolloutLine[] {
  let lines: RolloutLine[] = [];
  for (const segment of segmentsInOrder(files)) {
    const decoded = segment.flatMap((entry) => Option.toArray(decodeRolloutLine(entry)));
    const [first] = decoded;
    const base =
      first?.type === "session_meta"
        ? Option.getOrUndefined(decodeSessionMeta(first.payload))?.history_base
        : undefined;
    if (base !== undefined) lines = lines.slice(0, base.end_ordinal_exclusive);
    lines = [...lines, ...decoded];
  }
  return lines;
}

/** The turn a line belongs to, where it names one. */
function turnOf(line: RolloutLine): string | undefined {
  const mark = Option.getOrUndefined(decodeTurnMark(line.payload));
  return mark?.turn_id ?? mark?.internal_chat_message_metadata_passthrough?.turn_id;
}

/** Whether a user message is one Codex writes itself, its environment or instructions, rather than the developer's. */
function contextual(item: Extract<CodexItem, { type: "message" }>): boolean {
  if (item.role !== ROLE.USER) return item.role !== ROLE.ASSISTANT;
  const text = contentText(item.content).trimStart();
  return CODEX_CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** Whether an item is a prompt of the developer's, which opens a turn. */
function promptItem(item: CodexItem): boolean {
  return item.type === ITEM.MESSAGE && item.role === ROLE.USER && !contextual(item);
}

/**
 * The items a thread's model reads, oldest first, from its lines: its
 * `response_item`s, a compaction's replacement history in place of all before
 * it, or the compaction's summary alone where it kept none, and the last
 * turns a rollback names dropped. Reading stops at the turn that took the
 * line `cutBefore` names, so a fork's history ends before it.
 */
function threadItems(lines: readonly RolloutLine[], cutBefore: string | undefined): TimedItem[] {
  const cutTurn =
    cutBefore === undefined
      ? undefined
      : lines
          .flatMap((line) => Option.toArray(decodeUserMessageTaken(line.payload)))
          .find((taken) => taken.item.client_id === cutBefore)?.turn_id;
  let items: TimedItem[] = [];
  for (const line of lines) {
    if (cutTurn !== undefined && turnOf(line) === cutTurn) break;
    if (line.type === "compacted") {
      const compacted = Option.getOrUndefined(decodeCompacted(line.payload));
      if (compacted === undefined) continue;
      const replacement = compacted.replacement_history ?? undefined;
      items =
        replacement === undefined
          ? [
              {
                item: {
                  type: ITEM.MESSAGE,
                  role: ROLE.USER,
                  content: [
                    { type: "input_text", text: `${SUMMARY_LEAD}\n\n${compacted.message}` },
                  ],
                },
                at: line.timestamp,
              },
            ]
          : replacement.flatMap((each) =>
              Option.toArray(decodeCodexItem(each)).map((item) => ({ item, at: line.timestamp })),
            );
      continue;
    }
    const rolledBack = decodeRolledBack(line.payload);
    if (line.type === "event_msg" && Option.isSome(rolledBack)) {
      const prompts = items.flatMap((each, at) => (promptItem(each.item) ? [at] : []));
      const from = prompts.at(-rolledBack.value.num_turns);
      if (from !== undefined) items = items.slice(0, from);
      continue;
    }
    if (line.type !== "response_item") continue;
    const item = decodeCodexItem(line.payload);
    if (Option.isSome(item)) items.push({ item: item.value, at: line.timestamp });
  }
  return items;
}

/** A data URL as the Claude image block it holds; none for a URL that is not one, which Anthropic's API takes no other way. */
function claudeImage(url: string): Readonly<Record<string, unknown>> | undefined {
  const found = /^data:([^;]+);base64,(.*)$/su.exec(url);
  if (found === null) return undefined;
  return { type: "image", source: { type: "base64", media_type: found[1], data: found[2] } };
}

/** A message's or an output's content parts as Claude blocks: text and images. */
function claudeBlocksOf(content: readonly unknown[]): Readonly<Record<string, unknown>>[] {
  return content.flatMap((part) => {
    const read = Option.getOrUndefined(decodeCodexContent(part));
    if (read === undefined) return [];
    if (read.type === "input_image")
      return Option.toArray(Option.fromUndefinedOr(claudeImage(read.image_url)));
    return read.text === "" ? [] : [{ type: "text", text: read.text }];
  });
}

/** An output as a `tool_result`'s content: its text, or its blocks where it holds an image. */
function claudeResultContent(
  output: CodexOutput | undefined,
): string | Readonly<Record<string, unknown>>[] {
  if (output === undefined) return ABORTED;
  if (typeof output === "string") return output;
  const blocks = claudeBlocksOf(output);
  return blocks.some((block) => block.type === "image") ? blocks : contentText(output);
}

/** A call id as Anthropic's API takes a `tool_use` id: its characters outside the pattern replaced, and made unique where that made two alike. */
function toolIdOf(callId: string, taken: Set<string>): string {
  const base = TOOL_ID.test(callId) ? callId : callId.replace(/[^a-zA-Z0-9_-]/gu, "_") || "call";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

/** One file's change of an `apply_patch` envelope: an added file's content, or an updated file's hunks as replacements. */
type PatchChange =
  | { readonly kind: "add"; readonly path: string; readonly content: string }
  | {
      readonly kind: "update";
      readonly path: string;
      readonly hunks: readonly { readonly old: string; readonly new: string }[];
    }
  | { readonly kind: "other" };

/** The changes an `apply_patch` envelope makes, one per file; a delete or a move is `other`, which no Claude tool stands for. */
function patchChanges(patch: string): PatchChange[] {
  const changes: PatchChange[] = [];
  let hunk: { old: string[]; new: string[] } | undefined;
  let current:
    | { kind: "add"; path: string; lines: string[] }
    | { kind: "update"; path: string; hunks: { old: string[]; new: string[] }[] }
    | undefined;
  const close = () => {
    if (current?.kind === "add") {
      changes.push({ kind: "add", path: current.path, content: `${current.lines.join("\n")}\n` });
    } else if (current?.kind === "update") {
      changes.push({
        kind: "update",
        path: current.path,
        hunks: current.hunks.map((each) => ({
          old: each.old.join("\n"),
          new: each.new.join("\n"),
        })),
      });
    }
    current = undefined;
    hunk = undefined;
  };
  for (const line of patch.split("\n")) {
    if (line.startsWith("*** Add File: ")) {
      close();
      current = { kind: "add", path: line.slice("*** Add File: ".length), lines: [] };
    } else if (line.startsWith("*** Update File: ")) {
      close();
      current = { kind: "update", path: line.slice("*** Update File: ".length), hunks: [] };
    } else if (line.startsWith("*** Delete File: ") || line.startsWith("*** Move to: ")) {
      close();
      changes.push({ kind: "other" });
    } else if (line.startsWith("*** ")) {
      close();
    } else if (current?.kind === "add" && line.startsWith("+")) {
      current.lines.push(line.slice(1));
    } else if (current?.kind === "update") {
      if (line.startsWith("@@") || hunk === undefined) {
        hunk = { old: [], new: [] };
        current.hunks.push(hunk);
        if (line.startsWith("@@")) continue;
      }
      const body = line.slice(1);
      if (line.startsWith("-")) hunk.old.push(body);
      else if (line.startsWith("+")) hunk.new.push(body);
      else {
        hunk.old.push(body);
        hunk.new.push(body);
      }
    }
  }
  close();
  return changes;
}

/** An `apply_patch` of one file as Claude Code's own tool: Write for an added file, Edit for one hunk, MultiEdit for more; the patch kept as it is otherwise. */
function claudePatchCall(
  patch: string,
  cwd: string,
): { readonly name: string; readonly input: Readonly<Record<string, unknown>> } {
  const changes = patchChanges(patch);
  const [only] = changes;
  if (changes.length !== 1 || only === undefined || only.kind === "other") {
    return { name: CODEX_TOOL.APPLY_PATCH, input: { patch } };
  }
  const file_path = absoluteIn(cwd, only.path);
  if (only.kind === "add") {
    return { name: CLAUDE_TOOL.WRITE, input: { file_path, content: only.content } };
  }
  const [one, ...more] = only.hunks;
  if (one === undefined) return { name: CODEX_TOOL.APPLY_PATCH, input: { patch } };
  if (more.length === 0) {
    return {
      name: CLAUDE_TOOL.EDIT,
      input: { file_path, old_string: one.old, new_string: one.new },
    };
  }
  return {
    name: CLAUDE_TOOL.MULTI_EDIT,
    input: {
      file_path,
      edits: only.hunks.map((each) => ({ old_string: each.old, new_string: each.new })),
    },
  };
}

/** A command as Bash runs it: its words joined, `bash -lc`'s script alone where it is one. */
function bashOf(command: readonly string[]): string {
  const [shell, flag, script] = command;
  if (
    command.length === 3 &&
    script !== undefined &&
    /(?:^|\/)(?:ba|z)?sh$/u.test(shell ?? "") &&
    /^-l?c$/u.test(flag ?? "")
  ) {
    return script;
  }
  return command.join(" ");
}

/** A Codex function call as Claude Code's own tool where one stands for it, its name and arguments kept otherwise. */
function claudeFunctionCall(
  item: Extract<CodexItem, { type: "function_call" }>,
  cwd: string,
): { readonly name: string; readonly input: Readonly<Record<string, unknown>> } {
  const args: Readonly<Record<string, unknown>> = Option.getOrElse(
    decodeArguments(item.arguments),
    () => ({ input: item.arguments }),
  );
  if (item.namespace !== undefined) {
    const prefix = item.namespace.endsWith(MCP_SEPARATOR)
      ? item.namespace
      : `${item.namespace}${MCP_SEPARATOR}`;
    return { name: `${prefix}${item.name}`, input: args };
  }
  const workdir = stringField(args, "workdir");
  const inDirectory = (command: string) =>
    workdir === undefined || workdir === cwd ? command : `cd ${quoted(workdir)} && ${command}`;
  switch (item.name) {
    case CODEX_TOOL.EXEC_COMMAND: {
      const cmd = stringField(args, "cmd");
      if (cmd !== undefined)
        return { name: CLAUDE_TOOL.BASH, input: { command: inDirectory(cmd) } };
      break;
    }
    case CODEX_TOOL.SHELL: {
      const command = args.command;
      if (Array.isArray(command) && command.every((word) => typeof word === "string")) {
        return { name: CLAUDE_TOOL.BASH, input: { command: inDirectory(bashOf(command)) } };
      }
      break;
    }
    case CODEX_TOOL.UPDATE_PLAN: {
      const plan = Array.isArray(args.plan) ? args.plan : [];
      const todos = plan.flatMap((step) => {
        if (typeof step !== "object" || step === null) return [];
        const each = step as Readonly<Record<string, unknown>>;
        const content = stringField(each, "step");
        if (content === undefined) return [];
        return [{ content, status: stringField(each, "status") ?? "pending", activeForm: content }];
      });
      return { name: CLAUDE_TOOL.TODO_WRITE, input: { todos } };
    }
    case CODEX_TOOL.VIEW_IMAGE: {
      const path = stringField(args, "path");
      if (path !== undefined)
        return { name: CLAUDE_TOOL.READ, input: { file_path: absoluteIn(cwd, path) } };
      break;
    }
  }
  return { name: item.name, input: args };
}

/** Messages built one block at a time, a block of the role the last message holds joining it. */
class MessageList {
  readonly messages: ClaudeMessage[] = [];

  push(role: Role, block: Readonly<Record<string, unknown>>, at: string | undefined): void {
    const last = this.messages.at(-1);
    if (last?.role === role) {
      this.messages[this.messages.length - 1] = { ...last, content: [...last.content, block] };
      return;
    }
    this.messages.push({ role, content: [block], at });
  }
}

/**
 * A Codex rollout's history, cut before the turn that took the line given
 * where it holds it, as Claude Code messages grouped by turn: the developer's
 * words and images as user messages, the assistant's words and its reasoning
 * summaries as assistant text, and each call as a `tool_use` answered by its
 * `tool_result` in the next message, or by an aborted one where the rollout
 * holds none; a web search as a note in the assistant's words. Messages
 * Codex writes itself, its developer and system messages and the context it
 * puts ahead of a thread, are left out, and so is encrypted reasoning.
 * `files` is the thread's rollout files by their path under `CODEX_HOME`, and
 * `cwd` the checkout a relative path in a call is made absolute against.
 */
export function codexToClaude(
  files: ReadonlyMap<string, readonly HistoryEntry[]>,
  cutBefore: string | undefined,
  cwd: string,
): HistoryTurns<ClaudeMessage> {
  const items = threadItems(threadLines(files), cutBefore);
  const outputs = new Map<string, CodexOutput>();
  for (const { item } of items) {
    if (item.type === ITEM.FUNCTION_CALL_OUTPUT || item.type === ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      outputs.set(item.call_id, item.output);
    }
  }
  const turns: ClaudeMessage[][] = [];
  const taken = new Set<string>();
  let list = new MessageList();
  const call = (
    callId: string | null,
    name: string,
    input: Readonly<Record<string, unknown>>,
    at: string | undefined,
  ) => {
    const id = toolIdOf(callId ?? "call", taken);
    const output = callId === null ? undefined : outputs.get(callId);
    list.push(ROLE.ASSISTANT, { type: "tool_use", id, name, input }, at);
    list.push(
      ROLE.USER,
      { type: "tool_result", tool_use_id: id, content: claudeResultContent(output) },
      at,
    );
  };
  for (const { item, at } of items) {
    switch (item.type) {
      case ITEM.MESSAGE: {
        if (contextual(item)) break;
        const blocks = claudeBlocksOf(item.content);
        if (blocks.length === 0) break;
        if (item.role === ROLE.USER) {
          if (list.messages.length > 0) turns.push(list.messages);
          list = new MessageList();
        }
        const role = item.role === ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
        for (const block of blocks) list.push(role, block, at);
        break;
      }
      case ITEM.REASONING: {
        const text = item.summary
          .map((part) => part.text)
          .join("\n\n")
          .trim();
        if (text !== "")
          list.push(
            ROLE.ASSISTANT,
            { type: "text", text: cappedThought(text), [THOUGHT]: true },
            at,
          );
        break;
      }
      case ITEM.FUNCTION_CALL: {
        const mapped = claudeFunctionCall(item, cwd);
        call(item.call_id, mapped.name, mapped.input, at);
        break;
      }
      case ITEM.CUSTOM_TOOL_CALL: {
        const mapped =
          item.name === CODEX_TOOL.APPLY_PATCH
            ? claudePatchCall(item.input, cwd)
            : { name: item.name, input: { input: item.input } };
        call(item.call_id, mapped.name, mapped.input, at);
        break;
      }
      case ITEM.LOCAL_SHELL_CALL: {
        const command = bashOf(item.action.command);
        call(item.call_id, CLAUDE_TOOL.BASH, { command }, at);
        break;
      }
      case ITEM.WEB_SEARCH_CALL: {
        const query = item.action?.query;
        list.push(
          ROLE.ASSISTANT,
          {
            type: "text",
            text: `[I searched the web${query === undefined ? "" : ` for ${JSON.stringify(query)}`}.]`,
          },
          at,
        );
        break;
      }
    }
  }
  if (list.messages.length > 0) turns.push(list.messages);
  return turns;
}

/** A Claude message's blocks with the fit's marks taken off. */
function unmarkedBlocks(message: ClaudeMessage): ClaudeMessage {
  return {
    ...message,
    content: message.content.map((block) => {
      if (!(THOUGHT in block)) return block;
      const { [THOUGHT]: _mark, ...rest } = block;
      return rest;
    }),
  };
}

/** How Claude messages are measured, told apart, and read for a summary as a Claude Code session's history. */
export const CLAUDE_SIDE: HistorySide<ClaudeMessage> = {
  bytes: (message) =>
    message.content.reduce((sum, block) => {
      const json = JSON.stringify(block);
      const images = json.match(/"data":"[A-Za-z0-9+/=]+"/gu) ?? [];
      const imageBytes = images.reduce(
        (all, image) => all + Math.max(image.length, tokensBytes(REPLAY_FIT.FILE_TOKENS)),
        0,
      );
      return sum + utf8(json) - images.reduce((all, image) => all + image.length, 0) + imageBytes;
    }, 0),
  // Note that a reasoning summary joins the assistant's message beside the call or words after it, so its blocks are taken out of the message rather than the message dropped.
  withoutThought: (message) => {
    const content = message.content.filter((block) => !(THOUGHT in block));
    return content.length === 0 ? undefined : { ...message, content };
  },
  result: (message) =>
    message.content.length > 0 && message.content.every((block) => block.type === "tool_result"),
  step: (message) => {
    const words = message.content
      .map((block) => {
        if (block.type === "text") return String(block.text);
        if (block.type === "tool_use")
          return `Called ${String(block.name)} with ${JSON.stringify(block.input)}`;
        if (block.type === "tool_result")
          return `Result: ${typeof block.content === "string" ? block.content : contentText(block.content)}`;
        return "[image]";
      })
      .join("\n");
    return {
      kind: message.role === ROLE.USER ? REPLAY_STEP_KIND.LINE : REPLAY_STEP_KIND.SAID,
      summary: message.role === ROLE.USER ? "The developer wrote" : "The agent said",
      words,
    };
  },
};

/** The summary of the turns left out as the user message the session opens with. */
function claudeSummaryMessage(summary: string): ClaudeMessage {
  return { role: ROLE.USER, content: [{ type: "text", text: `${SUMMARY_LEAD}\n\n${summary}` }] };
}

/**
 * Claude messages as the entries of a Claude Code session the store keeps
 * under the id given: each linked to the one before by `parentUuid`, the
 * first with none, so the store marks it as the entry that opens the
 * session, each with the fields the Agent SDK needs to resume it (`type`,
 * `uuid`, `parentUuid`, `sessionId`, `timestamp`, `message`). A history
 * whose first message is the assistant's opens with a user line saying the
 * earlier turns are left out, since Anthropic's API takes a conversation
 * that opens with the user's alone. `newId` names each entry and assistant
 * message, and `now` stands for a message whose time the source did not say.
 */
export function claudeSessionEntries(
  messages: readonly ClaudeMessage[],
  sessionId: string,
  cwd: string,
  newId: () => string,
  now: string,
): HistoryEntry[] {
  const opened =
    messages[0]?.role === ROLE.USER
      ? messages
      : [
          {
            role: ROLE.USER,
            content: [
              { type: "text", text: "(The earlier turns of this conversation are left out.)" },
            ],
          } satisfies ClaudeMessage,
          ...messages,
        ];
  let parentUuid: string | null = null;
  return opened.map((each) => {
    const message = unmarkedBlocks(each);
    const uuid = newId();
    const entry: HistoryEntry = {
      type: message.role,
      uuid,
      parentUuid,
      isSidechain: false,
      sessionId,
      cwd,
      userType: "external",
      timestamp: message.at ?? now,
      message:
        message.role === ROLE.USER
          ? { role: message.role, content: message.content }
          : {
              id: `msg_${uuid.replaceAll("-", "")}`,
              type: "message",
              role: message.role,
              content: message.content,
            },
    };
    parentUuid = uuid;
    return entry;
  });
}

// -- Fitting -------------------------------------------------------------------------------------

/** The bytes of a history in the side's measure. */
function historyBytes<Item>(side: HistorySide<Item>, turns: HistoryTurns<Item>): number {
  return turns.reduce(
    (sum, turn) => sum + turn.reduce((all, item) => all + side.bytes(item), 0),
    0,
  );
}

/** The bytes a history may take of a window of these tokens: `NATIVE_HISTORY.WINDOW_SHARE` of it, in the replay's two bytes a token. */
function historyBudgetBytes(windowTokens: number): number {
  return tokensBytes(Math.floor(windowTokens * NATIVE_HISTORY.WINDOW_SHARE));
}

/**
 * A history held to the bytes given: whole where it fits; else with its
 * thinking dropped; else its newest turns that fit beside room for a
 * summary, the rest left out for the summary, and of a newest turn larger
 * than the room alone, its newest items that fit, never opening on a call's
 * result whose call is cut away.
 */
export function fitHistory<Item>(
  side: HistorySide<Item>,
  turns: HistoryTurns<Item>,
  budgetBytes: number,
): FittedHistory<Item> {
  if (historyBytes(side, turns) <= budgetBytes) return { kept: turns, dropped: [] };
  const thoughtless = turns
    .map((turn) =>
      turn.flatMap((item) => Option.toArray(Option.fromUndefinedOr(side.withoutThought(item)))),
    )
    .filter((turn) => turn.length > 0);
  if (historyBytes(side, thoughtless) <= budgetBytes) return { kept: thoughtless, dropped: [] };
  // A summary is held to its output bound, so that is the room it is counted for before it is written.
  const room = Math.max(0, budgetBytes - tokensBytes(REPLAY_FIT.SUMMARY_OUTPUT_TOKENS));
  const kept: (readonly Item[])[] = [];
  let used = 0;
  let at = thoughtless.length - 1;
  for (; at >= 0; at -= 1) {
    const turn = thoughtless[at] ?? [];
    const size = historyBytes(side, [turn]);
    if (used + size > room) break;
    kept.unshift(turn);
    used += size;
  }
  const newest = thoughtless[at];
  if (kept.length === 0 && newest !== undefined) {
    // A newest turn larger than the room alone keeps its newest items that fit.
    const tail: Item[] = [];
    for (let item = newest.length - 1; item >= 0; item -= 1) {
      const each = newest[item];
      if (each === undefined || used + side.bytes(each) > room) break;
      tail.unshift(each);
      used += side.bytes(each);
    }
    while (tail[0] !== undefined && side.result(tail[0])) tail.shift();
    return { kept: tail.length === 0 ? [] : [tail], dropped: thoughtless };
  }
  return { kept, dropped: thoughtless.slice(0, at + 1) };
}

/**
 * The fitted history, with the summary of the turns left out placed first
 * where one was written (`summarize`, the replay's own summarizer), or a line
 * saying how many were left out where none was; the summary is read as the
 * replay's steps (`HistorySide`'s `step`).
 */
export function summarizedHistory<Item>(
  side: HistorySide<Item>,
  fitted: FittedHistory<Item>,
  summarize: (steps: readonly ReplayStep[]) => Effect.Effect<Option.Option<ReplaySummary>>,
  summaryItem: (summary: string) => Item,
): Effect.Effect<Item[]> {
  return Effect.gen(function* () {
    const kept = fitted.kept.flat();
    if (fitted.dropped.length === 0) return kept;
    const summary = yield* summarize(fitted.dropped.flat().map(side.step));
    const words = Option.isSome(summary)
      ? summary.value.text
      : `(The ${fitted.dropped.length} earliest turns of this conversation did not fit and are left out.)`;
    return [summaryItem(words), ...kept];
  });
}

// -- The Start's door ----------------------------------------------------------------------------

/** The project Claude Code keeps a checkout's sessions under: its path with every character but a letter or a digit made a hyphen, as the Agent SDK names it for a path this short. */
function claudeProjectKeyOf(checkoutPath: string): string {
  return checkoutPath.replace(/[^a-zA-Z0-9]/gu, "-");
}

/** A session translated for the new agent: where it is written in the new agent's conversation, and its entries. */
export interface TranslatedSession {
  readonly key: SessionEntryKey;
  readonly entries: readonly HistoryEntry[];
}

/** What a translation reads its source by and writes for its target. */
export interface TranslationAsk {
  /** The source's account and conversation, whose rows are read as that account's. */
  readonly source: { readonly userId: string; readonly conversationId: string };
  readonly from: NativeRuntime;
  readonly to: NativeRuntime;
  /** The source's session: a Claude Code session's id, or a Codex thread's. */
  readonly session: string;
  /** The client id of the line the history ends just before; none for the whole. */
  readonly cutBefore: string | undefined;
  /** The new agent's checkout, which a Claude Code session is kept under and a call's relative path is made absolute against. */
  readonly checkoutPath: string;
  /** The new agent's window, in tokens. */
  readonly windowTokens: number;
  /** The replay's summarizer over the steps the history leaves out (`replay-summary.ts`'s `summarizeSteps`). */
  readonly summarize: (steps: readonly ReplayStep[]) => Effect.Effect<Option.Option<ReplaySummary>>;
  readonly newId: () => string;
  readonly now: string;
}

/** A Codex thread's rollout files from its rows, by their path under `CODEX_HOME`. */
function rolloutFilesOf(rows: readonly SessionRow[]): Map<string, HistoryEntry[]> {
  const files = new Map<string, HistoryEntry[]>();
  for (const row of rows) {
    if (row.subpath === null) continue;
    const file = files.get(row.subpath) ?? [];
    file.push(row.entry);
    files.set(row.subpath, file);
  }
  return files;
}

/**
 * The source's session translated for an agent on the other harness, read
 * from its rows as its own account, cut before the line given, and fitted
 * to `NATIVE_HISTORY.WINDOW_SHARE` of the new agent's window with the turns
 * left out summarized first: for a Codex agent, Responses items kept under
 * the session's id in `RUNNER_TRANSCRIPTS.CODEX_HISTORY_PROJECT`; for a
 * Claude Code agent, a session's entries under the session's id in the new
 * checkout's project, which its first open forks as the source's own. None
 * where the two run the same harness or the history holds nothing, so the
 * Start replays the source's steps instead.
 */
export const translatedSessionOf = Effect.fnUntraced(function* (
  ask: TranslationAsk,
): Effect.fn.Return<TranslatedSession | undefined, StoreFailure, DatabaseServices> {
  if (ask.from === ask.to) return undefined;
  const rows = yield* readSessionRows(ask.source, ask.session);
  if (ask.to === CONVERSATION_RUNTIME.CODEX) {
    const turns = claudeToCodex(
      rows.filter((row) => row.subpath === null).map((row) => row.entry),
      ask.cutBefore,
    );
    const fitted = fitHistory(CODEX_SIDE, turns, historyBudgetBytes(ask.windowTokens));
    const items = yield* summarizedHistory(CODEX_SIDE, fitted, ask.summarize, codexSummaryItem);
    if (items.length === 0) return undefined;
    return {
      key: { projectKey: RUNNER_TRANSCRIPTS.CODEX_HISTORY_PROJECT, sessionId: ask.session },
      entries: withoutMarks(items),
    };
  }
  const turns = codexToClaude(rolloutFilesOf(rows), ask.cutBefore, ask.checkoutPath);
  const fitted = fitHistory(CLAUDE_SIDE, turns, historyBudgetBytes(ask.windowTokens));
  const messages = yield* summarizedHistory(
    CLAUDE_SIDE,
    fitted,
    ask.summarize,
    claudeSummaryMessage,
  );
  if (messages.length === 0) return undefined;
  return {
    key: { projectKey: claudeProjectKeyOf(ask.checkoutPath), sessionId: ask.session },
    entries: claudeSessionEntries(messages, ask.session, ask.checkoutPath, ask.newId, ask.now),
  };
});
