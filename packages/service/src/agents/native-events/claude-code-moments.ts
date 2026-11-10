import type { RunnerMessage } from "@repo/agent-runner/protocol";
import { CLAUDE_CODE_TOOL, claudeCodeWorkspaceTool } from "@repo/features/agent-tools";
import { redactCredentials } from "@repo/features/credential-redaction";
import { integrationOfRemoteTool } from "@repo/features/integration-wire";
import type { ToolCallSettlement } from "@repo/features/turn-run";
import { type UnparsedWireValue, type WireValue, WireValueSchema } from "@repo/wire";
import { USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import { Option, Predicate, Schema } from "effect";
import { storedServerCall } from "../../integrations/connection-tools.js";
import {
  NATIVE_MOMENT,
  type NativeContextUsage,
  type NativeHeld,
  type NativeMoment,
  PLAN_STATUS,
} from "./native-moments.js";
import {
  FAILURE_CHARS,
  PICTURE_STAND_IN,
  runnerMoments,
  toolAnswerSettlement,
  usageLimitSettlement,
} from "./runner-moments.js";

/**
 * claude-code-moments.ts -- Claude Code's SDK messages, as its runner posts them, read as the moments of a native run.
 *
 * Each message the pinned Agent SDK emits (`@anthropic-ai/claude-agent-sdk`'s
 * `SDKMessage`) is read here, and each of the runner's own as every
 * harness's is (`runner-moments.ts`), for what the transcript keeps: a model call's answer is a
 * step, its text and thinking blocks its words and reasoning, its
 * `tool_use` blocks its calls, the `tool_result` blocks of the next user
 * message their answers, and a `result` the end of one model turn with its
 * usage. With `includePartialMessages` the words also arrive token by token
 * as `stream_event`s, which draft the step before its whole message lands.
 * A message from inside a subagent names the `Agent` call it runs under
 * (`parent_tool_use_id`) and is folded under that call: the call and its
 * answer stand in the transcript, its inner work does not. A subagent the
 * CLI runs in the background, as it does by default, answers its call at
 * once with words that say only that it launched, so that call is kept
 * open instead and settled by the task notification its end posts. A
 * subagent that fails while the plan's limit refuses its calls (a rejected
 * `rate_limit_event`, which the CLI posts ahead of the subagent's failure)
 * failed for that limit, so its call answers with the limit's notice
 * rather than the CLI's error. A call to our
 * own MCP server is named as our tool (`mcp__workspace__read_inbox` is
 * `read_inbox`, as is the `mcp__luke__` a transcript stored before the
 * server's rename names it by) and its answer read as the JSON that tool answers; a call
 * to an integration's own server (`mcp__linear__list_issues`) is stored as
 * the retired runtime's call of that integration's tool is, so it draws with the service's
 * mark and the tool's own name; every other call keeps the CLI's own name,
 * and it and an integration's call keep as their answer the text the model
 * read. A turn also says how it found the plan that pays: a `result` that
 * is no error ran on it, an answer the CLI flags `authentication_failed`
 * (a setup-token revoked, expired, or never one) refused it, and a
 * rejected `rate_limit_event` is its limit reached, until the reset the
 * CLI names, as is an answer flagged `billing_error`, an API key out of
 * credit. Each shape is read with a schema of the fields this reads alone, so
 * a field the SDK adds changes nothing here, and a message no schema fits
 * is no moment.
 */

const TextBlockSchema = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
const ThinkingBlockSchema = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
});
const ToolUseBlockSchema = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: WireValueSchema,
});
const ToolResultBlockSchema = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(WireValueSchema)])),
  is_error: Schema.optionalKey(Schema.Boolean),
});

const readTextBlock = Schema.decodeUnknownOption(TextBlockSchema);
const readThinkingBlock = Schema.decodeUnknownOption(ThinkingBlockSchema);
const readToolUseBlock = Schema.decodeUnknownOption(ToolUseBlockSchema);
const readToolResultBlock = Schema.decodeUnknownOption(ToolResultBlockSchema);

/** The fields every message read here has: its type, its subtype where it has one, and the subagent call it runs under. */
const readEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.String,
    subtype: Schema.optionalKey(Schema.String),
    parent_tool_use_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

const readInit = Schema.decodeUnknownOption(Schema.Struct({ session_id: Schema.String }));

/** The transcript a dropped mirror batch was of, as `SDKMirrorErrorMessage` keys it. */
const readMirrorError = Schema.decodeUnknownOption(
  Schema.Struct({ key: Schema.Struct({ sessionId: Schema.String }) }),
);

/** Why the model refused a model turn, as `SDKModelRefusalNoFallbackMessage` says it: its category and its explanation, where it named them. */
const readRefusal = Schema.decodeUnknownOption(
  Schema.Struct({
    api_refusal_category: Schema.optionalKey(Schema.NullOr(Schema.String)),
    api_refusal_explanation: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

/** The model a refused model turn was retried on, as `SDKModelRefusalFallbackMessage` names both. */
const readRefusalFallback = Schema.decodeUnknownOption(
  Schema.Struct({
    original_model: Schema.String,
    fallback_model: Schema.String,
    scope: Schema.optionalKey(Schema.String),
  }),
);

/** How a compaction ended, as `SDKStatusMessage` says it beside the CLI's status. */
const readCompactResult = Schema.decodeUnknownOption(
  Schema.Struct({
    compact_result: Schema.optionalKey(Schema.String),
    compact_error: Schema.optionalKey(Schema.String),
  }),
);

/** The outcome a plugin's install or a hook's run says it ended with. */
const readOutcome = Schema.decodeUnknownOption(
  Schema.Struct({
    status: Schema.optionalKey(Schema.String),
    outcome: Schema.optionalKey(Schema.String),
  }),
);

/** A notice's level, and whether it stopped the model from going on. */
const readInformational = Schema.decodeUnknownOption(
  Schema.Struct({
    level: Schema.optionalKey(Schema.String),
    prevent_continuation: Schema.optionalKey(Schema.Boolean),
  }),
);

/** The files `SDKFilesPersistedEvent` says it could not persist. */
const readFilesPersisted = Schema.decodeUnknownOption(
  Schema.Struct({ failed: Schema.Array(Schema.Unknown) }),
);

const COUNT = Schema.optionalKey(Schema.NullOr(Schema.Number));

/** A model call's usage as the Messages API counts it: the input apart from what the prefix cache read and wrote. */
const MessageUsageSchema = Schema.Struct({
  input_tokens: COUNT,
  output_tokens: COUNT,
  cache_read_input_tokens: COUNT,
  cache_creation_input_tokens: COUNT,
});

const readAssistant = Schema.decodeUnknownOption(
  Schema.Struct({
    error: Schema.optionalKey(Schema.String),
    message: Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      content: Schema.Array(WireValueSchema),
      usage: Schema.optionalKey(Schema.NullOr(MessageUsageSchema)),
    }),
  }),
);

const readUser = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.Struct({
      content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
    }),
    tool_use_result: Schema.optionalKey(Schema.Unknown),
  }),
);

/** The status a subagent call's structured answer (`AgentOutput`) says its subagent went on in the background with. */
const AGENT_ASYNC_LAUNCHED = "async_launched";

const readAgentOutputStatus = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

/**
 * The words a backgrounded subagent call's answer opens with, the text the
 * model reads in place of an answer: read where the structured answer is
 * missing, so Claude Code's internal metadata never stands as the answer.
 */
const AGENT_LAUNCHED_WORDS = "Async agent launched";

const readTaskNotification = Schema.decodeUnknownOption(
  Schema.Struct({
    tool_use_id: Schema.optionalKey(Schema.String),
    status: Schema.String,
    summary: Schema.optionalKey(Schema.String),
  }),
);

/** The status a task's notification says it ran to its end with, as `SDKTaskNotificationMessage` spells it; `failed` and `stopped` did not. */
const TASK_COMPLETED = "completed";

/**
 * What Claude Code says where the session its launch was told to resume is
 * nowhere it looks: in a `result`'s errors (`error_during_execution`), and in
 * the SDK's error for that result, which ends the launch.
 */
const SESSION_NOT_FOUND = "No conversation found with session ID";

const readStreamEvent = Schema.decodeUnknownOption(
  Schema.Struct({
    event: Schema.Struct({
      type: Schema.String,
      message: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
      delta: Schema.optionalKey(
        Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
      ),
    }),
  }),
);

const ResultSchema = Schema.Struct({
  subtype: Schema.String,
  is_error: Schema.optionalKey(Schema.Boolean),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
  api_error_status: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  result: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(MessageUsageSchema),
});

const readResult = Schema.decodeUnknownOption(ResultSchema);

const readRateLimit = Schema.decodeUnknownOption(
  Schema.Struct({
    rate_limit_info: Schema.Struct({
      status: Schema.String,
      rateLimitType: Schema.optionalKey(Schema.String),
      resetsAt: Schema.optionalKey(Schema.Number),
      utilization: Schema.optionalKey(Schema.Number),
    }),
  }),
);

/** The SDK's message types read here, as it spells them. */
const SDK_MESSAGE = {
  SYSTEM: "system",
  ASSISTANT: "assistant",
  USER: "user",
  STREAM_EVENT: "stream_event",
  RESULT: "result",
  RATE_LIMIT: "rate_limit_event",
} as const;

/** Every `system` subtype of the pinned SDK, as its message union spells them. */
type SdkSystemSubtype = Extract<RunnerMessage, { type: "system" }>["subtype"];

/** The `system` subtypes read here. */
const SYSTEM_SUBTYPE = {
  INIT: "init",
  COMPACT_BOUNDARY: "compact_boundary",
  TASK_NOTIFICATION: "task_notification",
  MIRROR_ERROR: "mirror_error",
  MODEL_REFUSAL_NO_FALLBACK: "model_refusal_no_fallback",
  MODEL_REFUSAL_FALLBACK: "model_refusal_fallback",
  STATUS: "status",
  PLUGIN_INSTALL: "plugin_install",
  HOOK_RESPONSE: "hook_response",
  INFORMATIONAL: "informational",
  FILES_PERSISTED: "files_persisted",
} as const satisfies Record<string, SdkSystemSubtype>;

/**
 * The pinned SDK's other `system` subtypes, which carry nothing the record
 * keeps: progress, state, and notices. Note that this names every one of
 * them, so a subtype a newer SDK adds fails to compile here until it is read
 * above or named here, rather than passing over a failure it may carry; one
 * the runner posts that this build does not know is still said in the log.
 */
const SYSTEM_PASSED_OVER = {
  // A retry of a call that failed for now; a call that fails for good fails its answer or its result.
  api_retry: true,
  // Advisory: the result's `permission_denials` is the record of what was denied.
  permission_denied: true,
  // A task's end is read from its notification, which carries the same status.
  task_updated: true,
  task_started: true,
  task_progress: true,
  background_tasks_changed: true,
  hook_started: true,
  hook_progress: true,
  control_request_progress: true,
  local_command_output: true,
  elicitation_complete: true,
  commands_changed: true,
  notification: true,
  session_state_changed: true,
  thinking_tokens: true,
  memory_recall: true,
  worker_shutting_down: true,
} as const satisfies Record<
  Exclude<SdkSystemSubtype, (typeof SYSTEM_SUBTYPE)[keyof typeof SYSTEM_SUBTYPE]>,
  true
>;

const PASSED_OVER: ReadonlySet<string> = new Set(Object.keys(SYSTEM_PASSED_OVER));

/** How a compaction that did not succeed is reported (`SDKStatusMessage`'s `compact_result`). */
const COMPACT_FAILED = "failed";

/** The outcome words a plugin's install or a hook's run fails with, as the SDK spells them. */
const OUTCOME_FAILED: ReadonlySet<string> = new Set(["failed", "error"]);

/** The notice level that is a warning rather than information. */
const INFORMATIONAL_WARNING = "warning";

/** The limit status that refuses the plan's calls, as `SDKRateLimitInfo` spells it. */
const RATE_LIMIT_REFUSED = "rejected";

/** Minutes in a week, the length of the plan's weekly limits. */
const WEEK_MINS = 7 * 24 * 60;

/**
 * Each of the plan's usage windows by the `rateLimitType` the SDK names it:
 * how long it runs, in minutes, and the model it alone counts where it
 * counts one (`seven_day_opus`), as its own window beside the week on every
 * model. A limit the SDK names that is no window (`overage`) has none.
 */
const RATE_LIMIT_WINDOWS: Readonly<
  Record<string, { readonly windowMins: number; readonly model?: string }>
> = {
  five_hour: { windowMins: 5 * 60 },
  seven_day: { windowMins: WEEK_MINS },
  seven_day_opus: { windowMins: WEEK_MINS, model: "Opus" },
  seven_day_sonnet: { windowMins: WEEK_MINS, model: "Sonnet" },
};

/**
 * The errors an answer carries that say the provider refused the plan's
 * credential, as `SDKAssistantMessageError` spells them: the token was
 * refused, or its organization may not use Claude Code. Either is mended
 * only by a new setup-token.
 */
const CREDENTIAL_REFUSED: ReadonlySet<string> = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
]);

/**
 * The error an answer carries where the provider refused the work for the
 * credential's billing, as `SDKAssistantMessageError` spells it: an API
 * key's organization out of credit, which reads as the credential's limit,
 * so the turn goes on with the next payer.
 */
const BILLING_REFUSED = "billing_error";

/**
 * The error the CLI's own answer carries where the plan's usage limit
 * refused a model call, as `SDKAssistantMessageError` spells it: its words
 * are the CLI's, never the model's.
 */
const RATE_LIMITED = "rate_limit" satisfies NonNullable<
  Extract<RunnerMessage, { type: "assistant" }>["error"]
>;

/** What Claude Code puts before any MCP server's tool, the server's name and `__` following it (`mcp__linear__list_issues`). */
const MCP_TOOL_PREFIX = "mcp__";
const MCP_SERVER_SEPARATOR = "__";

/**
 * The name and input a call is stored under: our tool's own for a call
 * to our MCP server; for a call to an integration's own server, its
 * integration's fixed name and envelope, as the retired runtime's nested call of the tool is
 * stored (`storedServerCall`); the CLI's otherwise.
 */
function storedClaudeCodeCall(
  callId: string,
  name: string,
  input: WireValue,
): { readonly name: string; readonly input: UnparsedWireValue } {
  const workspaceTool = claudeCodeWorkspaceTool(name);
  if (workspaceTool !== undefined) return { name: workspaceTool, input };
  if (!name.startsWith(MCP_TOOL_PREFIX)) return { name, input };
  const named = name.slice(MCP_TOOL_PREFIX.length);
  const separator = named.indexOf(MCP_SERVER_SEPARATOR);
  const integration =
    separator < 0
      ? undefined
      : storedServerCall(
          named.slice(0, separator),
          named.slice(separator + MCP_SERVER_SEPARATOR.length),
          input,
          callId,
        );
  return integration ?? { name, input };
}

const CLI_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(CLAUDE_CODE_TOOL));

/** A tool's answer as the text the model read: its text blocks joined, a picture standing in for its bytes where `pictures` asks, and left out otherwise. */
function answerText(content: string | readonly WireValue[] | undefined, pictures: boolean): string {
  if (content === undefined) return "";
  if (Predicate.isString(content)) return content;
  return content
    .flatMap((block) =>
      Option.match(readTextBlock(block), {
        onSome: ({ text }) => [text],
        onNone: () => (pictures ? [PICTURE_STAND_IN] : []),
      }),
    )
    .join("\n");
}

/**
 * A tool's answer as the transcript settles its call: an error the CLI
 * flagged is a refusal carrying the text, and any other answer is available,
 * kept as the text a CLI tool answered, or read as the JSON a tool of our
 * MCP server answers, so its status word counts as the retired runtime's relay counted it.
 * A CLI tool's pictures stand in as `[image]`; our tools' pictures are left
 * out, as the retired runtime's relay left out a look's picture, so its JSON still reads.
 */
function settlementOf(
  storedName: string,
  content: string | readonly WireValue[] | undefined,
  isError: boolean,
): ToolCallSettlement {
  const workspaceTool =
    !CLI_TOOL_NAMES.has(storedName) && integrationOfRemoteTool(storedName) === undefined;
  const text = answerText(content, !workspaceTool);
  return workspaceTool
    ? toolAnswerSettlement({ workspaceTool: true, text }, isError)
    : toolAnswerSettlement({ workspaceTool: false, text, output: text }, isError);
}

/**
 * What one model call read and wrote, as the context ring reads it. Note
 * that the input the provider counts excludes what the prefix cache read and
 * what was written to it, while the ring's input counts both.
 */
function contextOf(usage: typeof MessageUsageSchema.Type): NativeContextUsage {
  const cachedInputTokens = counted(usage.cache_read_input_tokens);
  const cacheWriteTokens = counted(usage.cache_creation_input_tokens);
  return {
    inputTokens: counted(usage.input_tokens) + cachedInputTokens + cacheWriteTokens,
    outputTokens: counted(usage.output_tokens),
    cachedInputTokens,
    cacheWriteTokens,
  };
}

/** A model call's answer, or the one block of it the SDK streams as a message: a step, and its words, reasoning, and calls. */
function assistantMoments(message: WireValue): readonly NativeMoment[] {
  const read = readAssistant(message);
  if (Option.isNone(read)) return [];
  // Note that the CLI's synthetic limit answer is no model message; the launch's end leaves the native notice only if every payer is spent.
  if (read.value.error === RATE_LIMITED) return [];
  const { id, content, usage } = read.value.message;
  const moments: NativeMoment[] = [
    id === undefined ? { kind: NATIVE_MOMENT.STEP } : { kind: NATIVE_MOMENT.STEP, key: id },
  ];
  if (usage !== undefined && usage !== null) {
    moments.push({ kind: NATIVE_MOMENT.CONTEXT, usage: contextOf(usage) });
  }
  const { error } = read.value;
  if (error !== undefined && CREDENTIAL_REFUSED.has(error)) {
    moments.push({ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.INVALID });
  }
  if (error === BILLING_REFUSED) {
    moments.push({ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED });
  }
  for (const block of content) {
    const text = readTextBlock(block);
    if (Option.isSome(text)) {
      moments.push({ kind: NATIVE_MOMENT.TEXT, text: text.value.text });
      continue;
    }
    const thinking = readThinkingBlock(block);
    if (Option.isSome(thinking)) {
      if (thinking.value.thinking.trim().length > 0) {
        moments.push({ kind: NATIVE_MOMENT.REASONING, text: thinking.value.thinking });
      }
      continue;
    }
    const call = readToolUseBlock(block);
    if (Option.isSome(call)) {
      const { id, name, input } = call.value;
      moments.push({
        kind: NATIVE_MOMENT.TOOL_STARTED,
        callId: id,
        ...storedClaudeCodeCall(id, name, input),
      });
    }
  }
  return moments;
}

/**
 * Whether a subagent call's answer says its subagent went on in the
 * background: the structured answer's status where the message carries it,
 * or the words the model reads in its place.
 */
function backgrounded(
  toolUseResult: unknown,
  content: string | readonly WireValue[] | undefined,
): boolean {
  const status = Option.map(readAgentOutputStatus(toolUseResult), (output) => output.status);
  if (Option.isSome(status)) return status.value === AGENT_ASYNC_LAUNCHED;
  return answerText(content, false).trimStart().startsWith(AGENT_LAUNCHED_WORDS);
}

/**
 * The tools' answers a user message carries, each settling the call the
 * projection holds; the step that asked for them is over. A subagent call
 * whose subagent went on in the background is not settled by its answer,
 * which says only that it launched: it stays open until the subagent's
 * task notification (`taskNotificationMoments`), as a delegation's row runs
 * until its worker answers.
 */
function userMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const read = readUser(message);
  if (Option.isNone(read)) return [];
  const { content } = read.value.message;
  if (Predicate.isString(content)) return [];
  const moments: NativeMoment[] = [];
  for (const block of content) {
    const answer = readToolResultBlock(block);
    if (Option.isNone(answer)) continue;
    const name = held.callName(answer.value.tool_use_id);
    if (name === undefined) continue;
    if (
      name === CLAUDE_CODE_TOOL.AGENT &&
      answer.value.is_error !== true &&
      backgrounded(read.value.tool_use_result, answer.value.content)
    ) {
      const callId = answer.value.tool_use_id;
      moments.push({ kind: NATIVE_MOMENT.SUBAGENT_RUNNING, callId, key: callId });
      continue;
    }
    const failed = answer.value.is_error === true;
    moments.push({
      kind: NATIVE_MOMENT.TOOL_SETTLED,
      callId: answer.value.tool_use_id,
      settlement:
        failed && name === CLAUDE_CODE_TOOL.AGENT && held.planLimited
          ? usageLimitSettlement(USAGE_LIMIT_AGENT.CLAUDE)
          : settlementOf(name, answer.value.content, failed),
    });
  }
  return moments.length === 0 ? [] : [...moments, { kind: NATIVE_MOMENT.STEP_CLOSED }];
}

/** A token of the words while they stream: the step a model call opens, and the piece of its words. */
function streamMoments(message: WireValue): readonly NativeMoment[] {
  const read = readStreamEvent(message);
  if (Option.isNone(read)) return [];
  const { type, message: started, delta } = read.value.event;
  if (type === "message_start" && started !== undefined) {
    return [{ kind: NATIVE_MOMENT.STEP, key: started.id }];
  }
  if (type === "content_block_delta" && delta?.type === "text_delta" && delta.text !== undefined) {
    return [{ kind: NATIVE_MOMENT.STEP }, { kind: NATIVE_MOMENT.TEXT_DELTA, text: delta.text }];
  }
  return [];
}

/** A count the SDK left out or nulled, as nothing. */
function counted(value: number | null | undefined): number {
  return value ?? 0;
}

/**
 * Why a model turn failed, in the CLI's words: its subtype, the API's status
 * where an API error ended it, and the errors it named, then the error's text.
 * Note that an API error arrives as a `success` whose `result` is the error's
 * text, while a turn that did not fail keeps its answer there, which is the
 * model's and never read here.
 */
function failureOf(result: typeof ResultSchema.Type): string {
  const { subtype, api_error_status, errors, result: said } = result;
  const status =
    api_error_status === undefined || api_error_status === null ? [] : [String(api_error_status)];
  const words = [subtype, ...status, ...(errors ?? [])].join(" ");
  const failure = said === undefined || said.trim() === "" ? words : `${words}: ${said}`;
  return redactCredentials(failure).slice(0, FAILURE_CHARS);
}

/**
 * The moments, with the session's loss said among them where a failure
 * among them says Claude Code found no session to resume
 * (`SESSION_NOT_FOUND`): after the result that opens the turn where none is
 * open, and ahead of the launch's end, which reads it.
 */
function withSessionLost(moments: readonly NativeMoment[]): readonly NativeMoment[] {
  const lost = moments.some(
    (moment) =>
      (moment.kind === NATIVE_MOMENT.RESULT && moment.failure?.includes(SESSION_NOT_FOUND)) ||
      (moment.kind === NATIVE_MOMENT.ENDED && moment.detail?.includes(SESSION_NOT_FOUND)),
  );
  if (!lost) return moments;
  const end = moments.findIndex((moment) => moment.kind === NATIVE_MOMENT.ENDED);
  const at = end === -1 ? moments.length : end;
  return [...moments.slice(0, at), { kind: NATIVE_MOMENT.SESSION_LOST }, ...moments.slice(at)];
}

/**
 * The end of one model turn: what its main loop cost, and why it failed
 * where it did. Note that the input the provider counts excludes what the
 * prefix cache read and what was written to it, while the record's input
 * counts both, as the price reads it (`model-catalog.ts`).
 */
function resultMoments(message: WireValue): readonly NativeMoment[] {
  const read = readResult(message);
  if (Option.isNone(read)) return [{ kind: NATIVE_MOMENT.RESULT }];
  const { is_error, usage } = read.value;
  const moments: NativeMoment[] = [];
  if (usage !== undefined) {
    const cachedInputTokens = counted(usage.cache_read_input_tokens);
    const cacheWriteTokens = counted(usage.cache_creation_input_tokens);
    moments.push({
      kind: NATIVE_MOMENT.USAGE,
      usage: {
        inputTokens: counted(usage.input_tokens) + cachedInputTokens + cacheWriteTokens,
        outputTokens: counted(usage.output_tokens),
        cachedInputTokens,
        reasoningTokens: 0,
        cacheWriteTokens,
      },
    });
  }
  const failed = is_error === true;
  moments.push(
    failed
      ? { kind: NATIVE_MOMENT.RESULT, failure: failureOf(read.value) }
      : { kind: NATIVE_MOMENT.RESULT },
  );
  // Note that a turn that ran is the plan's answer that it pays, which a limit reached earlier lifts on.
  if (!failed) moments.push({ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.VERIFIED });
  moments.push({ kind: NATIVE_MOMENT.STEP_CLOSED });
  return moments;
}

/** The plan's limit as the CLI reports it: refused or not, and which limit and when it resets. */
function rateLimitMoments(message: WireValue): readonly NativeMoment[] {
  const read = readRateLimit(message);
  if (Option.isNone(read)) return [];
  const { status, rateLimitType, resetsAt, utilization } = read.value.rate_limit_info;
  // Note that the SDK counts the reset in seconds since the epoch.
  const resetsAtMs = resetsAt === undefined ? undefined : resetsAt * 1000;
  const words = [`rate_limit_${status}`];
  if (rateLimitType !== undefined) words.push(rateLimitType);
  if (resetsAtMs !== undefined) words.push(`resets ${new Date(resetsAtMs).toISOString()}`);
  const refused = status === RATE_LIMIT_REFUSED;
  const window = rateLimitType === undefined ? undefined : RATE_LIMIT_WINDOWS[rateLimitType];
  return [
    // Note that the SDK reports utilization as a share of one, which the plan's row keeps in percent.
    ...(utilization === undefined || window === undefined
      ? []
      : [
          {
            kind: NATIVE_MOMENT.PLAN_USAGE,
            usedPercent: utilization * 100,
            ...window,
            ...(resetsAtMs === undefined ? {} : { resetsAt: resetsAtMs }),
          } as const,
        ]),
    {
      kind: NATIVE_MOMENT.RATE_LIMIT,
      refused,
      detail: words.join(" "),
      ...(refused && resetsAtMs !== undefined ? { resetsAt: resetsAtMs } : undefined),
    },
    // The limit held first, so the plan's word reads its reset.
    ...(refused ? [{ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED } as const] : []),
  ];
}

/**
 * A background task's end, which settles the subagent call it ran under
 * where it was one (the projection passes over any other task's): its
 * summary is the answer, and a task that failed or was stopped a refusal,
 * but one that failed while the plan's limit stands, which failed for it.
 */
function taskNotificationMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const read = readTaskNotification(message);
  if (Option.isNone(read) || read.value.tool_use_id === undefined) return [];
  const { tool_use_id, status, summary } = read.value;
  const text = summary === undefined || summary.trim() === "" ? status : summary;
  const failed = status !== TASK_COMPLETED;
  return [
    {
      kind: NATIVE_MOMENT.SUBAGENT_ENDED,
      key: tool_use_id,
      settlement:
        failed && held.planLimited
          ? usageLimitSettlement(USAGE_LIMIT_AGENT.CLAUDE)
          : toolAnswerSettlement({ workspaceTool: false, text, output: text }, failed),
    },
  ];
}

/** Words the harness said, as the record keeps them: no credential, and no longer than a failure's. */
function keptWords(words: readonly (string | null | undefined)[]): string {
  const said = words.filter((word) => word !== undefined && word !== null && word.trim() !== "");
  return redactCredentials(said.join(" ")).slice(0, FAILURE_CHARS);
}

/** A refusal no other model retried: it fails the model turn under way, with its category and explanation. */
function refusalMoments(message: WireValue): readonly NativeMoment[] {
  const read = Option.getOrUndefined(readRefusal(message));
  const words = [SYSTEM_SUBTYPE.MODEL_REFUSAL_NO_FALLBACK, read?.api_refusal_category];
  const explanation = read?.api_refusal_explanation;
  const detail = keptWords(words);
  return [
    {
      kind: NATIVE_MOMENT.REFUSED,
      detail:
        explanation === undefined || explanation === null || explanation.trim() === ""
          ? detail
          : keptWords([`${detail}:`, explanation]),
    },
  ];
}

/** A status that says a compaction failed, which is why its model turn failed where it did; any other status is nothing. */
function statusMoments(message: WireValue): readonly NativeMoment[] {
  const read = readCompactResult(message);
  if (Option.isNone(read) || read.value.compact_result !== COMPACT_FAILED) return [];
  return [
    {
      kind: NATIVE_MOMENT.COMPACTION_FAILED,
      detail: keptWords(["compaction failed:", read.value.compact_error]),
    },
  ];
}

/** A notice for the log alone. */
function noted(said: string): readonly NativeMoment[] {
  return [{ kind: NATIVE_MOMENT.NOTED, said }];
}

/**
 * A `system` message that carries a failure no turn holds: a model retried
 * on another (whose usage is still priced as the agent's model), a plugin or
 * hook that failed, a warning, or files not persisted. Each is said in the
 * log by its subtype and outcome, never its words; any other is nothing.
 */
function failureNoticeMoments(
  subtype: SdkSystemSubtype,
  message: WireValue,
): readonly NativeMoment[] {
  switch (subtype) {
    case SYSTEM_SUBTYPE.MODEL_REFUSAL_FALLBACK:
      return Option.match(readRefusalFallback(message), {
        onSome: ({ original_model, fallback_model, scope }) =>
          noted(
            `${subtype}: ${original_model} refused, retried on ${fallback_model} (scope ${scope ?? "session"})`,
          ),
        onNone: () => noted(subtype),
      });
    case SYSTEM_SUBTYPE.PLUGIN_INSTALL:
    case SYSTEM_SUBTYPE.HOOK_RESPONSE: {
      const read = Option.getOrUndefined(readOutcome(message));
      const outcome = read?.status ?? read?.outcome;
      return outcome !== undefined && OUTCOME_FAILED.has(outcome)
        ? noted(`${subtype}: ${outcome}`)
        : [];
    }
    case SYSTEM_SUBTYPE.INFORMATIONAL: {
      const read = Option.getOrUndefined(readInformational(message));
      const stopped = read?.prevent_continuation === true;
      return read?.level === INFORMATIONAL_WARNING || stopped
        ? noted(`${subtype}: ${read.level ?? "notice"}${stopped ? ", prevented continuation" : ""}`)
        : [];
    }
    case SYSTEM_SUBTYPE.FILES_PERSISTED: {
      const failed = Option.getOrUndefined(readFilesPersisted(message))?.failed.length ?? 0;
      return failed > 0 ? noted(`${subtype}: ${failed} failed`) : [];
    }
    default:
      return [];
  }
}

function systemMoments(
  subtype: string | undefined,
  message: WireValue,
  held: NativeHeld,
): readonly NativeMoment[] {
  switch (subtype) {
    case SYSTEM_SUBTYPE.INIT:
      return [
        ...Option.match(readInit(message), {
          onSome: ({ session_id }): readonly NativeMoment[] => [
            { kind: NATIVE_MOMENT.SESSION, sessionId: session_id },
          ],
          onNone: () => [],
        }),
        { kind: NATIVE_MOMENT.ACTIVE },
      ];
    case SYSTEM_SUBTYPE.COMPACT_BOUNDARY:
      return [{ kind: NATIVE_MOMENT.COMPACTED }];
    case SYSTEM_SUBTYPE.TASK_NOTIFICATION:
      return taskNotificationMoments(message, held);
    case SYSTEM_SUBTYPE.MIRROR_ERROR:
      // The SDK gave up on a batch of the transcript it mirrors to the store, which then holds a gap.
      return Option.match(readMirrorError(message), {
        onSome: ({ key }): readonly NativeMoment[] => [
          { kind: NATIVE_MOMENT.TRANSCRIPT_BROKEN, sessionId: key.sessionId },
        ],
        onNone: () => [],
      });
    case SYSTEM_SUBTYPE.MODEL_REFUSAL_NO_FALLBACK:
      return refusalMoments(message);
    case SYSTEM_SUBTYPE.STATUS:
      return statusMoments(message);
    case SYSTEM_SUBTYPE.MODEL_REFUSAL_FALLBACK:
    case SYSTEM_SUBTYPE.PLUGIN_INSTALL:
    case SYSTEM_SUBTYPE.HOOK_RESPONSE:
    case SYSTEM_SUBTYPE.INFORMATIONAL:
    case SYSTEM_SUBTYPE.FILES_PERSISTED:
      return failureNoticeMoments(subtype, message);
    default:
      // Note that a subtype this build does not know is said by its name alone, so a failure it carries is never silent.
      return subtype !== undefined && PASSED_OVER.has(subtype)
        ? []
        : noted(`an unread system message: ${subtype ?? "no subtype"}`);
  }
}

/**
 * One message the runner posted, as the moments of the run: nothing for a
 * message of a subagent, which its `Agent` call stands for, or of a type the
 * transcript keeps nothing of. `held` names the calls the projection
 * holds, so an answer settles a call the transcript holds and is read as
 * that tool answers.
 */
export function claudeCodeMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const own = runnerMoments(message);
  if (Option.isSome(own)) return withSessionLost(own.value);
  const envelope = readEnvelope(message);
  if (Option.isNone(envelope)) return [];
  const { type, subtype, parent_tool_use_id } = envelope.value;
  if (parent_tool_use_id !== undefined && parent_tool_use_id !== null) return [];
  switch (type) {
    case SDK_MESSAGE.SYSTEM:
      return systemMoments(subtype, message, held);
    case SDK_MESSAGE.ASSISTANT:
      return assistantMoments(message);
    case SDK_MESSAGE.USER:
      return userMoments(message, held);
    case SDK_MESSAGE.STREAM_EVENT:
      return streamMoments(message);
    case SDK_MESSAGE.RESULT:
      return withSessionLost(resultMoments(message));
    case SDK_MESSAGE.RATE_LIMIT:
      return rateLimitMoments(message);
    default:
      return [];
  }
}
