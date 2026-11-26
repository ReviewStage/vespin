/**
 * cursor-moments.ts -- Cursor's SDK messages, as its runner posts them, read as the moments of a native run.
 *
 * The runner posts each message Cursor's SDK streams of a run as it streamed
 * it (`@repo/agent-runner`'s `CursorMessage`), beside its own events
 * (`runner-moments.ts`). Cursor streams its words and its reasoning a token
 * a message, so each assistant token is a piece of the step's words and each
 * thinking token a piece of its reasoning, which the projection joins and
 * tells whole as the step goes on. A tool call is said running, often more
 * than once, and then completed: it starts as it is first said and settles
 * as it completes, closing its step, so the words after it open another.
 * Cursor's own tools are stored under `CURSOR_TOOL`'s names; a call to our
 * own MCP server, which the runner hands Cursor as a custom tool named as
 * Claude Code names it (`mcp__team__read_inbox`), is stored under our tool's
 * name and its answer read as the JSON that tool answers; one to an
 * integration's server as that integration's call (`storedServerCall`); and
 * one to any other MCP server as `cursorMcp`. A subagent's task keeps its
 * answer short: the steps its subagent took, which Cursor nests in a shape
 * of its own, are left out. Each run's usage, the sum of its model calls,
 * meters the turn, and each model call the runner posts says the context
 * that call read, so the ring reads the last call's prompt rather than
 * that sum; a summary written stamps the agent compacted; and the
 * agent's id, on every message, is the session a relaunch resumes. A call
 * Cursor gave up on can be left running with no answer, as one its review
 * refused is while the model tries again under a new id, so every call
 * still running as the turn ends is settled as unanswered. Each shape is
 * read with a schema of the fields this reads alone, so a field Cursor adds
 * changes nothing here, and a message no schema fits is no moment.
 */

import { CURSOR_MODEL_CALL } from "@repo/agent-runner/protocol";
import {
  CURSOR_TOOL,
  claudeCodeWorkspaceTool,
  storedToolName,
  WORKSPACE_MCP_SERVER_NAMES,
} from "@repo/features/agent-tools";
import type { ToolCallSettlement } from "@repo/features/turn-run";
import { isRecord, type UnparsedWireValue, type WireValue, WireValueSchema } from "@repo/wire";
import { Option, Schema } from "effect";
import { storedServerCall } from "../../integrations/connection-tools.js";
import { NATIVE_MOMENT, type NativeHeld, type NativeMoment } from "./native-moments.js";
import {
  FAILURE_CHARS,
  PICTURE_STAND_IN,
  runnerMoments,
  toolAnswerSettlement,
} from "./runner-moments.js";

/** The message types read here, as the SDK spells them. */
const MESSAGE = {
  STATUS: "status",
  THINKING: "thinking",
  ASSISTANT: "assistant",
  TOOL_CALL: "tool_call",
  USAGE: "usage",
  SUMMARY: "summary",
  MODEL_CALL: CURSOR_MODEL_CALL,
} as const;

/**
 * A run's statuses that end it, as `SDKStatusMessage` spells them but in
 * lower case, which the status is read in, and whether each failed it.
 */
const RUN_ENDED: ReadonlyMap<string, boolean> = new Map([
  ["finished", false],
  ["cancelled", false],
  ["error", true],
  ["expired", true],
]);

/** A run's status that says it is at work. */
const RUN_RUNNING = "RUNNING";

/** A tool call's status that says it has not answered yet. */
const CALL_RUNNING = "running";

/** A summary's status that says it was written. */
const SUMMARY_COMPLETED = "completed";

/** A summary's status that says it could not be written, the conversation left as it was. */
const SUMMARY_FAILED = "error";

/** A call's result status that says it failed, as the SDK's tool results spell it. */
const RESULT_ERROR = "error";

/** The name Cursor calls every MCP tool by, its server and tool in its args. */
const MCP_CALL = "mcp";

/** The MCP server the SDK puts its custom tools under, which our tools are. */
const CUSTOM_TOOLS_SERVER = "custom-user-tools";

/** What Claude Code puts before any MCP server's tool, which a custom tool's name carries (`mcp__linear__list_issues`). */
const MCP_TOOL_PREFIX = "mcp__";
const MCP_SERVER_SEPARATOR = "__";

/** The keys of a subagent's answer a call keeps: what it did and said last, not the steps it took. */
const TASK_ANSWER_KEYS = [
  "agentId",
  "isBackground",
  "durationMs",
  "resultSuffix",
  "backgroundReason",
] as const;

/** Cursor's own tools by the SDK's names, as the transcript stores their calls. */
const CURSOR_TOOL_OF: ReadonlyMap<string, string> = new Map([
  ["shell", CURSOR_TOOL.SHELL],
  ["read", CURSOR_TOOL.READ],
  ["write", CURSOR_TOOL.WRITE],
  ["edit", CURSOR_TOOL.EDIT],
  ["delete", CURSOR_TOOL.DELETE],
  ["ls", CURSOR_TOOL.LS],
  ["glob", CURSOR_TOOL.GLOB],
  ["grep", CURSOR_TOOL.GREP],
  ["semSearch", CURSOR_TOOL.SEM_SEARCH],
  ["readLints", CURSOR_TOOL.READ_LINTS],
  ["webSearch", CURSOR_TOOL.WEB_SEARCH],
  ["webFetch", CURSOR_TOOL.WEB_FETCH],
  ["updateTodos", CURSOR_TOOL.UPDATE_TODOS],
  ["createPlan", CURSOR_TOOL.CREATE_PLAN],
  ["task", CURSOR_TOOL.TASK],
]);

/** What a call still running as its turn ends is answered with. */
const UNANSWERED = "Cursor ended the turn before this call answered.";

const readMessage = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.String, agent_id: Schema.String }),
);

const readStatus = Schema.decodeUnknownOption(
  Schema.Struct({ status: Schema.String, message: Schema.optionalKey(Schema.String) }),
);

const readText = Schema.decodeUnknownOption(Schema.Struct({ text: Schema.String }));

const readAssistant = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.Struct({
      content: Schema.Array(
        Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
      ),
    }),
  }),
);

const readToolCall = Schema.decodeUnknownOption(
  Schema.Struct({
    call_id: Schema.String,
    name: Schema.String,
    status: Schema.String,
    args: Schema.optionalKey(WireValueSchema),
    result: Schema.optionalKey(WireValueSchema),
  }),
);

const readResult = Schema.decodeUnknownOption(
  Schema.Struct({
    status: Schema.String,
    value: Schema.optionalKey(WireValueSchema),
    error: Schema.optionalKey(WireValueSchema),
  }),
);

const readErrorMessage = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

const readMcpArgs = Schema.decodeUnknownOption(
  Schema.Struct({
    providerIdentifier: Schema.String,
    toolName: Schema.String,
    args: Schema.optionalKey(WireValueSchema),
  }),
);

const readMcpAnswer = Schema.decodeUnknownOption(
  Schema.Struct({
    content: Schema.Array(
      Schema.Struct({ text: Schema.optionalKey(Schema.Struct({ text: Schema.String })) }),
    ),
    isError: Schema.optionalKey(Schema.Boolean),
  }),
);

const readUsage = Schema.decodeUnknownOption(
  Schema.Struct({
    usage: Schema.Struct({
      inputTokens: Schema.Number,
      outputTokens: Schema.Number,
      cacheReadTokens: Schema.Number,
      cacheWriteTokens: Schema.Number,
      reasoningTokens: Schema.optionalKey(Schema.Number),
    }),
  }),
);

/** A call as the transcript stores it: the name, the input, and whether its answer is our own tool's JSON. */
interface StoredCall {
  readonly name: string;
  readonly input: UnparsedWireValue;
  /** Our own tool's name, where the call is to our MCP server. */
  readonly workspaceTool?: string;
}

/**
 * A call to an MCP server as it is stored: our tool's stored name
 * (`storedToolName`) for our own server, reached as a custom tool or as a
 * server of ours; an integration's call for an integration's server;
 * `cursorMcp` naming the server and tool otherwise.
 */
function storedMcpCall(callId: string, args: WireValue | undefined): StoredCall {
  const mcp = readMcpArgs(args);

  if (Option.isNone(mcp)) return { name: CURSOR_TOOL.MCP, input: args };
  const { providerIdentifier, toolName } = mcp.value;
  const input = mcp.value.args ?? {};
  const named = providerIdentifier === CUSTOM_TOOLS_SERVER ? toolName : undefined;

  const workspaceTool =
    named === undefined
      ? WORKSPACE_MCP_SERVER_NAMES.has(providerIdentifier)
        ? toolName
        : undefined
      : claudeCodeWorkspaceTool(named);

  if (workspaceTool !== undefined) {
    return { name: storedToolName(workspaceTool), input, workspaceTool };
  }

  const server = named === undefined ? providerIdentifier : serverOf(named);
  const tool = named === undefined ? toolName : toolOf(named);

  const integration =
    server === undefined || tool === undefined
      ? undefined
      : storedServerCall(server, tool, input, callId);

  return integration ?? { name: CURSOR_TOOL.MCP, input: args };
}

/** The server a custom tool's name names (`linear` of `mcp__linear__list_issues`); none where it names none. */
function serverOf(name: string): string | undefined {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const separator = rest.indexOf(MCP_SERVER_SEPARATOR);

  return separator < 0 ? undefined : rest.slice(0, separator);
}

/** The tool a custom tool's name names (`list_issues` of `mcp__linear__list_issues`); none where it names none. */
function toolOf(name: string): string | undefined {
  const server = serverOf(name);

  return server === undefined
    ? undefined
    : name.slice(MCP_TOOL_PREFIX.length + server.length + MCP_SERVER_SEPARATOR.length);
}

/** A call as it is stored: Cursor's own tool under `CURSOR_TOOL`'s name, an MCP call as `storedMcpCall` names it, and any other under the name Cursor called it by. */
function storedCall(callId: string, name: string, args: WireValue | undefined): StoredCall {
  if (name === MCP_CALL) return storedMcpCall(callId, args);

  return { name: CURSOR_TOOL_OF.get(name) ?? name, input: args };
}

/** An MCP answer's words: our own tool's first text alone, which holds its whole JSON; any other's texts joined, a stand-in taking a picture's place. */
function mcpAnswerText(value: WireValue | undefined, workspaceTool: boolean): string {
  const answer = readMcpAnswer(value);

  if (Option.isNone(answer)) return "";
  const texts = answer.value.content.map((block) => block.text?.text);

  if (workspaceTool) return texts.find((text) => text !== undefined) ?? "";

  return texts.map((text) => text ?? PICTURE_STAND_IN).join("\n");
}

/** A subagent's answer with the steps it took left out. */
function taskAnswer(value: WireValue | undefined): WireValue | undefined {
  if (value === undefined || !isRecord(value)) return value;

  return Object.fromEntries(
    TASK_ANSWER_KEYS.flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])),
  );
}

/** A completed call's answer as the transcript settles it: failed with Cursor's words where its result says so, else as it answered. */
function settlementOf(stored: StoredCall, result: WireValue | undefined): ToolCallSettlement {
  const read = readResult(result);
  const status = Option.getOrUndefined(read)?.status;
  const value = Option.getOrUndefined(read)?.value;

  if (status === RESULT_ERROR || Option.isNone(read)) {
    const error = Option.getOrUndefined(read)?.error;

    const words = Option.match(readErrorMessage(error), {
      onSome: ({ message }) => message,
      onNone: () => "The call failed.",
    });

    return toolAnswerSettlement({ workspaceTool: false, text: words, output: words }, true);
  }

  if (stored.workspaceTool !== undefined) {
    const failed = Option.getOrUndefined(readMcpAnswer(value))?.isError === true;

    return toolAnswerSettlement(
      { workspaceTool: true, name: stored.workspaceTool, text: mcpAnswerText(value, true) },
      failed,
    );
  }

  if (stored.name === CURSOR_TOOL.TASK) {
    return toolAnswerSettlement(
      { workspaceTool: false, text: "", output: taskAnswer(value) },
      false,
    );
  }

  const mcpAnswer = readMcpAnswer(value);

  // Note that an MCP server's answer, an integration's among them, is kept as the words the model read.
  if (Option.isSome(mcpAnswer)) {
    const text = mcpAnswerText(value, false);

    return toolAnswerSettlement(
      { workspaceTool: false, text, output: text },
      mcpAnswer.value.isError === true,
    );
  }

  return toolAnswerSettlement({ workspaceTool: false, text: "", output: value }, false);
}

/** A tool call said: started where it is first said, and settled, its step closed, as it completes. */
function toolCallMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const read = readToolCall(message);

  if (Option.isNone(read)) return [];
  const { call_id: callId, name, status, args, result } = read.value;
  const stored = storedCall(callId, name, args);

  // A call said running again is already held.
  if (status === CALL_RUNNING) {
    return held.callName(callId) === undefined
      ? [{ kind: NATIVE_MOMENT.TOOL_STARTED, callId, name: stored.name, input: stored.input }]
      : [];
  }

  return [
    { kind: NATIVE_MOMENT.TOOL_STARTED, callId, name: stored.name, input: stored.input },
    {
      kind: NATIVE_MOMENT.TOOL_SETTLED,
      callId,
      settlement: settlementOf(stored, result),
      input: stored.input,
    },
    { kind: NATIVE_MOMENT.STEP_CLOSED },
  ];
}

/** A run's status: at work, or ended, failed with Cursor's words where it failed. */
function statusMoments(message: WireValue): readonly NativeMoment[] {
  const read = readStatus(message);

  if (Option.isNone(read)) return [];
  const { status } = read.value;

  if (status === RUN_RUNNING) return [{ kind: NATIVE_MOMENT.ACTIVE }];
  const failed = RUN_ENDED.get(status.toLowerCase());

  if (failed === undefined) return [];

  if (!failed) return [{ kind: NATIVE_MOMENT.RESULT }];

  return [
    {
      kind: NATIVE_MOMENT.RESULT,
      failure: (read.value.message ?? status).slice(0, FAILURE_CHARS),
    },
  ];
}

/** A run's usage, the sum of its model calls, as the meter reads it. Note that Cursor counts the cache's reads and writes within the input, as the record counts them. */
function usageMoments(message: WireValue): readonly NativeMoment[] {
  return Option.match(readUsage(message), {
    onSome: ({ usage }): readonly NativeMoment[] => [
      {
        kind: NATIVE_MOMENT.USAGE,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cacheReadTokens,
          reasoningTokens: usage.reasoningTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens,
        },
      },
    ],
    onNone: () => [],
  });
}

/** One model call's usage, as the context ring reads it: the whole prompt the call read, the cache's reads and writes within it. */
function modelCallMoments(message: WireValue): readonly NativeMoment[] {
  return Option.match(readUsage(message), {
    onSome: ({ usage }): readonly NativeMoment[] => [
      {
        kind: NATIVE_MOMENT.CONTEXT,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
        },
      },
    ],
    onNone: () => [],
  });
}

/** A summary of the conversation: at work, written, or not written. */
function summaryMoments(message: WireValue): readonly NativeMoment[] {
  const read = readStatus(message);

  if (Option.isNone(read)) return [];

  switch (read.value.status) {
    case SUMMARY_COMPLETED:
      return [{ kind: NATIVE_MOMENT.COMPACTED, notice: { tokensBefore: null } }];
    case SUMMARY_FAILED:
      return [
        {
          kind: NATIVE_MOMENT.COMPACTION_FAILED,
          detail: "Cursor could not summarize the conversation",
        },
      ];
    default:
      return [{ kind: NATIVE_MOMENT.ACTIVE }];
  }
}

/** One of Cursor's messages as the moments of the run, by its type; nothing for a type the transcript keeps nothing of, a steered message's echo among them, since the member's words stand in the record already. */
function messageMoments(
  type: string,
  message: WireValue,
  held: NativeHeld,
): readonly NativeMoment[] {
  switch (type) {
    case MESSAGE.STATUS:
      return statusMoments(message);
    case MESSAGE.THINKING:
      return Option.match(readText(message), {
        onSome: ({ text }): readonly NativeMoment[] =>
          text.length === 0 ? [] : [{ kind: NATIVE_MOMENT.REASONING_DELTA, text }],
        onNone: () => [],
      });
    case MESSAGE.ASSISTANT:
      return Option.match(readAssistant(message), {
        onSome: ({ message: said }): readonly NativeMoment[] =>
          said.content.flatMap((block) =>
            block.type === "text" && block.text !== undefined && block.text.length > 0
              ? [{ kind: NATIVE_MOMENT.TEXT_DELTA, text: block.text } as const]
              : [],
          ),
        onNone: () => [],
      });
    case MESSAGE.TOOL_CALL:
      return toolCallMoments(message, held);
    case MESSAGE.USAGE:
      return usageMoments(message);
    case MESSAGE.MODEL_CALL:
      return modelCallMoments(message);
    case MESSAGE.SUMMARY:
      return summaryMoments(message);
    default:
      return [];
  }
}

/** The calls still running as a turn ends, settled as unanswered, ahead of the end. */
function withOpenCallsSettled(moments: readonly NativeMoment[]): readonly NativeMoment[] {
  if (!moments.some((moment) => moment.kind === NATIVE_MOMENT.ENDED)) return moments;

  const settlement = toolAnswerSettlement(
    { workspaceTool: false, text: UNANSWERED, output: UNANSWERED },
    true,
  );

  return [{ kind: NATIVE_MOMENT.OPEN_CALLS_SETTLED, settlement }, ...moments];
}

/**
 * One message the runner posted, as the moments of the run: its own events
 * as every harness's are, the calls still running settled as a turn ends;
 * Cursor's by their type, after the session where the message names
 * another than the one held.
 */
export function cursorMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const own = runnerMoments(message);

  if (Option.isSome(own)) return withOpenCallsSettled(own.value);
  const read = readMessage(message);

  if (Option.isNone(read)) return [];
  const { type, agent_id: session } = read.value;
  const moments = messageMoments(type, message, held);

  return session === held.session
    ? moments
    : [{ kind: NATIVE_MOMENT.SESSION, sessionId: session }, ...moments];
}
