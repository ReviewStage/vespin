/**
 * out-of-memory.ts -- a command the kernel killed for want of memory, told as such: the line the transcript shows on its call, and the words the model reads beside its answer.
 *
 * A command killed out of memory dies as any SIGKILL does, exit code 137
 * and the shell's bare "Killed", which says nothing of why. The kernel
 * counts each process its OOM killer kills: the sandbox's cgroup in
 * `memory.events`, and the whole machine in `/proc/vmstat`, both as an
 * `oom_kill` line (a Vercel sandbox exposes both, and `dmesg` names the
 * process, under a PID of another namespace than the command's). So a
 * command is read as killed out of memory only where it exited 137 and
 * that counter rose while it ran; 137 alone is any SIGKILL, such as a
 * timeout's or a `kill -9`. A machine with neither counter, such as a Mac,
 * never reads one so.
 */

import { readFile } from "node:fs/promises";
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CodexNotification } from "./protocol.js";

/** 128 and SIGKILL's 9: how a shell reports a command killed by the signal. */
const SIGKILL_EXIT = 137;

/** Where the kernel counts the processes its OOM killer killed: the sandbox's own cgroup first, then the whole machine. */
const OOM_KILL_COUNTS = ["/sys/fs/cgroup/memory.events", "/proc/vmstat"] as const;

/** The cgroup's memory limit, `max` where it sets none, and the machine's own memory, in kB. */
const MEMORY_MAX = "/sys/fs/cgroup/memory.max";
const MEMINFO = "/proc/meminfo";

const GIB = 1024 ** 3;
const KIB = 1024;

/** How Claude Code's Bash tool opens the answer of a command that failed. */
const CLAUDE_CODE_EXIT = /^Exit code (\d+)/;

/** The tool whose commands are watched, as Claude Code names it and its hooks match it. */
const CLAUDE_CODE_BASH = "Bash";

/** The hook events the watch runs on, as Claude Code names them. */
const HOOK_EVENT = {
  PRE_TOOL_USE: "PreToolUse",
  POST_TOOL_USE: "PostToolUse",
  POST_TOOL_USE_FAILURE: "PostToolUseFailure",
} as const satisfies Record<string, HookEvent>;

/** The app-server notifications and item type the watch reads of a Codex command. */
const CODEX_COMMAND = {
  STARTED: "item/started",
  COMPLETED: "item/completed",
  ITEM: "commandExecution",
} as const;

/** What the model is told beside the answer, after the transcript's line. */
const AGENT_ADVICE =
  "The kernel killed this command for using more memory than the sandbox has. Run it again with less parallelism (fewer workers, jobs, or threads), or on less at once, rather than unchanged.";

/** The number on a file's `<key> <n>` line, its unit after it left aside (`MemTotal: 8605824 kB`); none where it holds no such line. */
function countIn(text: string, key: string): number | undefined {
  const line = text.split("\n").find((entry) => entry.startsWith(`${key} `));
  const said = line
    ?.slice(key.length + 1)
    .trim()
    .split(/\s+/)[0];
  const count = said === undefined || said === "" ? Number.NaN : Number(said);
  return Number.isFinite(count) ? count : undefined;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Where a watch reads the kernel's count of OOM kills and the sandbox's memory: the machine's own files, or a test's. */
export interface MemoryReadings {
  readonly kills: () => Promise<number | undefined>;
  readonly memoryBytes: () => Promise<number | undefined>;
}

/** What a command's run said of memory: its exit code, and the kernel's count of OOM kills as it began and as it ended, none where the machine keeps none. */
interface CommandMemoryRun {
  readonly exitCode: number | undefined;
  readonly killsBefore: number | undefined;
  readonly killsAfter: number | undefined;
  /** The sandbox's memory, none where it could not be read. */
  readonly memoryBytes: number | undefined;
}

/** Claude Code's Bash calls watched for a kill out of memory: the hooks the CLI runs, and its answers as posted. */
export interface ClaudeCodeMemoryWatch {
  readonly hooks: {
    readonly PreToolUse: HookCallbackMatcher[];
    readonly PostToolUse: HookCallbackMatcher[];
    readonly PostToolUseFailure: HookCallbackMatcher[];
  };
  readonly annotate: (message: SDKMessage) => SDKMessage;
}

/** The kernel's count of OOM kills, from the first file that keeps one; none on a machine that keeps none. */
async function oomKills(): Promise<number | undefined> {
  for (const path of OOM_KILL_COUNTS) {
    const text = await readText(path);
    const count = text === undefined ? undefined : countIn(text, "oom_kill");
    if (count !== undefined) return count;
  }
  return undefined;
}

/** The sandbox's memory: its cgroup's limit where it sets one, the machine's otherwise. */
async function sandboxMemoryBytes(): Promise<number | undefined> {
  const limit = Number((await readText(MEMORY_MAX))?.trim());
  if (Number.isFinite(limit) && limit > 0) return limit;
  const total = countIn((await readText(MEMINFO)) ?? "", "MemTotal:");
  return total === undefined ? undefined : total * KIB;
}

/** The exit code a Claude Code Bash failure opens with, none where it names none. */
function claudeCodeExitCode(error: string): number | undefined {
  const match = CLAUDE_CODE_EXIT.exec(error);
  return match === null ? undefined : Number(match[1]);
}

/**
 * The transcript's line for a command killed out of memory, its size in
 * whole GB; none for any other run.
 */
function outOfMemoryLine(run: CommandMemoryRun): string | undefined {
  const { exitCode, killsBefore, killsAfter, memoryBytes } = run;
  if (exitCode !== SIGKILL_EXIT || killsBefore === undefined || killsAfter === undefined) {
    return undefined;
  }
  if (killsAfter <= killsBefore) return undefined;
  return memoryBytes === undefined
    ? "Killed: the sandbox ran out of memory"
    : `Killed: the sandbox ran out of memory (${Math.round(memoryBytes / GIB)} GB)`;
}

/** What the model reads beside a command killed out of memory: the line, and what to do next. */
function outOfMemoryContext(line: string): string {
  return `${line}. ${AGENT_ADVICE}`;
}

/** The machine's own readings: its cgroup's and kernel's files. */
const MACHINE_READINGS: MemoryReadings = { kills: oomKills, memoryBytes: sandboxMemoryBytes };

/**
 * Claude Code's commands watched for a kill out of memory, over one
 * launch: the hooks that read the kernel's count as a Bash call begins and
 * as it fails, telling the model beside the failure where it was killed out
 * of memory, and the user message carrying that call's answer, with the line
 * at the end of its words, for the transcript. Note that a call's failure
 * hook runs before its answer is put out, so the line is known by then.
 */
export function claudeCodeMemoryWatch(
  readings: MemoryReadings = MACHINE_READINGS,
): ClaudeCodeMemoryWatch {
  const began = new Map<string, number | undefined>();
  const lines = new Map<string, string>();
  const onBegin: HookCallback = async (hook) => {
    if (hook.hook_event_name === HOOK_EVENT.PRE_TOOL_USE)
      began.set(hook.tool_use_id, await readings.kills());
    return { continue: true };
  };
  const onEnd: HookCallback = async (hook) => {
    if (hook.hook_event_name === HOOK_EVENT.POST_TOOL_USE) began.delete(hook.tool_use_id);
    if (hook.hook_event_name !== HOOK_EVENT.POST_TOOL_USE_FAILURE) return { continue: true };
    const killsBefore = began.get(hook.tool_use_id);
    began.delete(hook.tool_use_id);
    const line = outOfMemoryLine({
      exitCode: claudeCodeExitCode(hook.error),
      killsBefore,
      killsAfter: killsBefore === undefined ? undefined : await readings.kills(),
      memoryBytes: await readings.memoryBytes(),
    });
    if (line === undefined) return { continue: true };
    lines.set(hook.tool_use_id, line);
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: HOOK_EVENT.POST_TOOL_USE_FAILURE,
        additionalContext: outOfMemoryContext(line),
      },
    };
  };
  const annotate = (message: SDKMessage): SDKMessage => {
    if (message.type !== "user" || lines.size === 0) return message;
    const { content } = message.message;
    if (typeof content === "string") return message;
    let changed = false;
    const blocks = content.map((block) => {
      if (block.type !== "tool_result") return block;
      const line = lines.get(block.tool_use_id);
      if (line === undefined) return block;
      lines.delete(block.tool_use_id);
      changed = true;
      const said = block.content;
      if (said === undefined || typeof said === "string") {
        return { ...block, content: said === undefined ? line : `${said}\n${line}` };
      }
      return { ...block, content: [...said, { type: "text" as const, text: line }] };
    });
    return changed ? { ...message, message: { ...message.message, content: blocks } } : message;
  };
  const matching = (hook: HookCallback): HookCallbackMatcher[] => [
    { matcher: CLAUDE_CODE_BASH, hooks: [hook] },
  ];
  return {
    hooks: {
      PreToolUse: matching(onBegin),
      PostToolUse: matching(onEnd),
      PostToolUseFailure: matching(onEnd),
    },
    annotate,
  };
}

/**
 * Codex's commands watched for a kill out of memory, over one app-server:
 * the kernel's count read as a command item starts, and the item's
 * completion as posted, with the line at the end of its output, for the
 * transcript. Note that app-server offers no way to add words to what the
 * model reads of a command, so a Codex agent sees only the exit code.
 */
export function codexMemoryWatch(
  readings: MemoryReadings = MACHINE_READINGS,
): (notification: CodexNotification) => Promise<CodexNotification> {
  const began = new Map<string, number | undefined>();
  return async (notification) => {
    if (
      notification.method === CODEX_COMMAND.STARTED &&
      notification.params.item.type === CODEX_COMMAND.ITEM
    ) {
      began.set(notification.params.item.id, await readings.kills());
      return notification;
    }
    if (notification.method !== CODEX_COMMAND.COMPLETED) return notification;
    const { item } = notification.params;
    if (item.type !== CODEX_COMMAND.ITEM || !began.has(item.id)) return notification;
    const killsBefore = began.get(item.id);
    began.delete(item.id);
    const line = outOfMemoryLine({
      exitCode: item.exitCode ?? undefined,
      killsBefore,
      killsAfter: killsBefore === undefined ? undefined : await readings.kills(),
      memoryBytes: await readings.memoryBytes(),
    });
    if (line === undefined) return notification;
    const said = item.aggregatedOutput ?? "";
    const aggregatedOutput = said === "" ? line : `${said.replace(/\n$/, "")}\n${line}`;
    return {
      ...notification,
      params: { ...notification.params, item: { ...item, aggregatedOutput } },
    };
  };
}
