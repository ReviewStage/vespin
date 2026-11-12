/**
 * recorded-stream.ts -- P00's recorded stream, as the runner's tests replay it: the SDK messages of the probe's workflow turn and its stopped turn, cut into the steps the CLI took between the service's lines.
 *
 * P00 merged with a placeholder live recording, so this is its hermetic
 * stream (`tools/claude-code-probe/tests/verdict.test.ts`'s `firstLaunch`),
 * in the pinned SDK's (0.3.304) message shapes. What that stream does not
 * show is built from the SDK's own types and marked as such: the partial
 * messages `includePartialMessages` adds (`SDKPartialAssistantMessage`), and
 * the Stop hook's input before each `result` (`StopHookInput`'s
 * `background_tasks` and `session_crons`).
 */

import type {
  BackgroundTaskSummary,
  PermissionUpdate,
  SessionCronSummary,
} from "@anthropic-ai/claude-agent-sdk";

/** One JSON value, as a message crosses the CLI's stdout. */
type Recorded =
  | string
  | number
  | boolean
  | null
  | readonly Recorded[]
  | { readonly [key: string]: Recorded };

const SESSION = "00000000-0000-4000-8000-000000000001";
const NONCE = "a1b2c3d4e5f6";

/** The words the probe's turns end on (`tools/claude-code-probe/src/verdict.ts`'s `TURN_DONE`). */
export const TURN_DONE = { FIRST: "AGENT-PROBE-TURN-1-DONE" } as const;

/** The marker of the probe's stopped command (`tools/claude-code-probe/src/turns.ts`'s `STOPPED_COMMAND`). */
export const STOPPED_COMMAND = "sleep 600";

let uuid = 0;

function nextUuid(): string {
  uuid += 1;

  return `00000000-0000-4000-8000-${String(uuid).padStart(12, "0")}`;
}

const INIT: Recorded = {
  type: "system",
  subtype: "init",
  session_id: SESSION,
  apiKeySource: "none",
  claude_code_version: "2.1.304",
  cwd: "/workspace/repository",
  tools: ["Bash", "Edit", "Write", "ScheduleWakeup", "mcp__workspace__read_inbox"],
  mcp_servers: [{ name: "workspace", status: "connected" }],
  model: "claude-sonnet",
  permissionMode: "bypassPermissions",
  uuid: nextUuid(),
};

function toolUse(name: string, input: Recorded): Recorded {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: `toolu_${name}`, name, input }] },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function toolResult(id: string, text: string): Recorded {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function said(text: string): Recorded {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

/** A token of what `said` then delivers whole. Built from the SDK's `SDKPartialAssistantMessage`. */
function partial(text: string): Recorded {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function result(subtype: string) {
  return {
    type: "result",
    subtype,
    is_error: subtype !== "success",
    session_id: SESSION,
    uuid: nextUuid(),
  } satisfies Recorded;
}

/**
 * The `result` the CLI put out resuming a session a Stop interrupted, ahead
 * of the turn on the service's message, as a hand test on a host saw it: its step
 * names no prompt.
 */
export const STRAY_RESULT = result("success");

/** What a Stop hook reports in flight. Built from the SDK's `StopHookInput`. */
export interface StopReport {
  readonly background_tasks: BackgroundTaskSummary[];
  readonly session_crons: SessionCronSummary[];
}

const NOTHING_IN_FLIGHT: StopReport = { background_tasks: [], session_crons: [] };

const BACKGROUND_SLEEP: BackgroundTaskSummary = {
  id: "bash_1",
  type: "shell",
  status: "running",
  description: "sleep 45",
  command: `sleep 45 && echo agent-probe-background-${NONCE}`,
};

export const WAKEUP: SessionCronSummary = {
  id: "cron_1",
  schedule: "17 12 21 10 *",
  recurring: false,
  prompt: "Continue Vespin's probe from step 4.",
};

/**
 * A tool call the CLI asks its host about, as the SDK hands `canUseTool` one.
 * Built from the SDK's `CanUseTool` options, since P00 ran with every call unasked.
 */
export interface PermissionAsk {
  readonly toolName: string;
  readonly input: Record<string, string>;
  readonly toolUseID: string;
  readonly requestId: string;
  readonly title?: string;
  readonly suggestions?: PermissionUpdate[];
}

/**
 * What the fake CLI does next: emit a message, a `result` naming the prompts
 * its turn took unless it names none, run the Stop hook, ask its host about a
 * tool call, take the service's next message into the turn, or hold until it
 * is interrupted or the test releases it.
 */
export type Step =
  | { readonly emit: Recorded; readonly namesNoPrompt?: true }
  | { readonly stopHook: StopReport }
  | { readonly askPermission: PermissionAsk }
  | { readonly awaitPrompt: true }
  | { readonly untilInterrupted: true }
  | { readonly untilReleased: true };

/**
 * P00's workflow turn, from its prompt: an edit, the leak check, a background
 * command, and a `ScheduleWakeup`, after which the model turn ends while both
 * are pending; then the wakeup's own model turn, which finishes the work and
 * ends with nothing pending.
 */
export const WORKFLOW_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Write", { file_path: `agent-probe/${NONCE}.txt`, content: NONCE }) },
  { emit: toolResult("toolu_Write", "File created") },
  { emit: toolUse("Bash", { command: "bash /opt/agent-probe/leak-check.sh" }) },
  { emit: toolResult("toolu_Bash", 'APP_PROBE_LEAK_CHECK {"user":"agent","sudo":false}\n') },
  {
    emit: toolUse("Bash", {
      command: `sleep 45 && echo agent-probe-background-${NONCE}`,
      run_in_background: true,
    }),
  },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 60,
      reason: "wait",
      prompt: "Continue Vespin's probe from step 4.",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [BACKGROUND_SLEEP], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { emit: partial("AGENT-PROBE-") },
  { emit: partial("TURN-1-DONE") },
  { emit: said(TURN_DONE.FIRST) },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** P00's stopped turn: a long foreground command, held until the service's stop interrupts it. */
export const STOPPED_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", { command: STOPPED_COMMAND }) },
  { untilInterrupted: true },
  { emit: result("error_during_execution") },
];

/**
 * A turn held at work until the test releases it, so the service's second message
 * arrives while it runs and is left for the next turn, which the CLI starts
 * on that message as soon as the first ends.
 */
export const FOLLOW_UP_TURNS: readonly Step[] = [
  { emit: INIT },
  { emit: said("Working on the first message.") },
  { untilReleased: true },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
  { awaitPrompt: true },
  { emit: said("Done with the second.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/**
 * P00's workflow turn up to its wakeup, then a wakeup's turn that starts a
 * long foreground command, held until the service's stop interrupts it.
 */
export const WAKEUP_STOPPED_TURN: readonly Step[] = [
  { emit: INIT },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 60,
      reason: "wait",
      prompt: "go",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { emit: toolUse("Bash", { command: STOPPED_COMMAND }) },
  { untilInterrupted: true },
  { emit: result("error_during_execution") },
];

/** A turn that ends at its first `result`, with nothing pending. */
export const SHORT_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: said("Done.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** A resumed session's stray `result` (`STRAY_RESULT`), then the turn that answers the service's message. */
export const STRAY_RESULT_THEN_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: STRAY_RESULT, namesNoPrompt: true },
  { emit: said("Done.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** A resumed session's stray `result`, the CLI then silent until the launch ends. */
export const STRAY_RESULT_THEN_SILENCE: readonly Step[] = [
  { emit: INIT },
  { emit: STRAY_RESULT, namesNoPrompt: true },
  { untilReleased: true },
];

/** Two turns that each end at their `result` with nothing pending, the second on the service's next message, as a warm launch takes it. */
export const WARM_TURNS: readonly Step[] = [
  ...SHORT_TURN,
  { awaitPrompt: true },
  { emit: said("Done with the second.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/**
 * The `result` the CLI puts out once its own retries of a model call it
 * could not deliver run out, as the Agent SDK words it: a success by
 * subtype, an error by flag, the connection error as its text, and no API
 * status, since nothing answered.
 */
const CONNECTION_LOST_RESULT = {
  ...result("success"),
  is_error: true,
  result: "API Error: Connection error.",
} as const;

/** The `result` of a model call the API refused for its credential: the same shape, with the API's status. */
const CREDENTIAL_REFUSED_RESULT = {
  ...result("success"),
  is_error: true,
  result: "API Error: 401 Invalid API key · Please run /login",
  api_error_status: 401,
} as const;

/**
 * A turn the CLI gave up on for want of the API, then the carry-on the
 * service sends once the host answers, which the CLI runs as a turn that
 * finishes with nothing pending.
 */
export const CONNECTION_LOST_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: said("Working on it.") },
  { emit: CONNECTION_LOST_RESULT },
  { awaitPrompt: true },
  { emit: said("Done.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** A turn the CLI gave up on for want of the API, and the carry-on's turn lost the same way before the model said anything. */
export const CONNECTION_LOST_TWICE: readonly Step[] = [
  { emit: INIT },
  { emit: said("Working on it.") },
  { emit: CONNECTION_LOST_RESULT },
  { awaitPrompt: true },
  { emit: CONNECTION_LOST_RESULT },
];

/** A turn the API refused for its credential, which no probe mends. */
export const CREDENTIAL_REFUSED_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: CREDENTIAL_REFUSED_RESULT },
];

/** A turn that schedules a wakeup and ends its model turn waiting on it alone, the CLI then held up until the launch ends. */
export const WAKEUP_WAIT: readonly Step[] = [
  { emit: INIT },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 600,
      reason: "wait",
      prompt: "go",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { untilReleased: true },
];

/** A shell command an agent whose mode asks must have allowed: a write long past what its ask carries whole. */
export const ASKED_COMMAND = `cat > notes.md <<'EOF'\n${"A line the agent wrote.\n".repeat(400)}EOF`;

/** The CLI's ask for `ASKED_COMMAND`, with the rule it suggests for allowing the like of it. */
export const BASH_ASK: PermissionAsk = {
  toolName: "Bash",
  input: { command: ASKED_COMMAND, description: "Write the notes" },
  toolUseID: "toolu_Bash",
  requestId: "can-use-tool-1",
  title: "Claude wants to run cat > notes.md",
  suggestions: [
    {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "cat:*" }],
      behavior: "allow",
      destination: "localSettings",
    },
  ],
};

/** A turn whose shell command the CLI asks its host about, going on once the host answers. */
export const ASKED_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", BASH_ASK.input) },
  { askPermission: BASH_ASK },
  { emit: toolResult("toolu_Bash", "") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** A turn whose ask a stop withdraws, as the CLI cancels its request on an interrupt. */
export const ASKED_STOPPED_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", BASH_ASK.input) },
  { askPermission: BASH_ASK },
  { emit: result("error_during_execution") },
];

/** A turn whose ask a message the service sent meanwhile answers, then the turn that takes the message. */
export const ASKED_THEN_MESSAGE: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", BASH_ASK.input) },
  { askPermission: BASH_ASK },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
  { awaitPrompt: true },
  { emit: said("Done with the second.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];
