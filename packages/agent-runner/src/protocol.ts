/**
 * protocol.ts -- what the service and the runner say to each other: the config line, the later stdin lines, the events the runner posts, and the environment it reads its secrets from.
 *
 * This is the runner's whole contract, held apart from the Agent SDK so the
 * service that launches the runner (P08) and the route that takes its events
 * (P09) import it without the SDK behind it. Every line on stdin is one JSON
 * object: the first is the config, each later one a message, a stop, a model
 * change, a retire, a warm, or an approval. A config that names `linesUrl` has the runner read
 * the later lines from the service instead (`RUNNER_LINES`).
 *
 * The config says which harness the launch runs: Claude Code (P05), or Codex
 * through `codex app-server` (P20). Secrets never travel in argv or on
 * stdin: the runner's bearer and, in the cloud, the harness's credential are
 * in its environment; on a host the harnesses run on the machine's own
 * logins. Codex's ChatGPT access token is never handed in at all: in the
 * cloud's sandbox the runner asks the service for each over HTTPS
 * (`codex-token.ts`) as it signs app-server in, so no line carries one, on a
 * Mac's queue (`@repo/features/device-agent-wire`) or anywhere else.
 */

import type {
  BackgroundTaskSummary,
  SDKMessage,
  SessionCronSummary,
} from "@anthropic-ai/claude-agent-sdk";
import { Option, Schema } from "effect";
import type { ServerNotification } from "./codex-protocol/index.js";

/**
 * The environment the runner reads. The bearer authenticates it to the service, its
 * events and its MCP server alike; in a sandbox it is a placeholder, which the
 * sandbox's firewall swaps for the bearer on the service's host, and the runner
 * presents it as it would the bearer, handing it to neither the CLI nor a
 * command Codex runs. The plan token is never read by the runner itself: the
 * CLI it launches inherits it, as does every command the CLI runs, since no
 * command sandbox stands between them. An Anthropic API key
 * stands in its place for an agent the account's key pays for. In a sandbox
 * either is a placeholder minted for the launch, which the sandbox's firewall
 * swaps for the real one on Anthropic's API, so neither enters the sandbox;
 * on a host the runner hands its harnesses none of them, whatever it was
 * started with, since they run on the machine's own logins
 * (`launch.ts`'s `harnessEnvOf`). Codex's token is never in it: the runner
 * asks the service for it in the cloud's sandbox as it signs app-server in
 * (`codex-token.ts`). An OpenAI API key in the sandbox is a placeholder,
 * swapped for the real one at the sandbox's firewall, as Anthropic's are.
 */
export const RUNNER_ENV = {
  BEARER: "APP_RUNNER_TOKEN",
  CLAUDE_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
  /**
   * The account's Anthropic API key, in the plan token's place for an agent
   * its key pays for: the CLI's documented variable
   * (https://code.claude.com/docs/en/agent-sdk/quickstart), on the same terms.
   */
  API_KEY: "ANTHROPIC_API_KEY",
  /**
   * The account's OpenAI API key, for a Codex launch its key pays for: the
   * variable app-server's provider names as its `env_key`
   * (https://developers.openai.com/codex/config-advanced/), which no command
   * Codex runs inherits.
   */
  OPENAI_API_KEY: "OPENAI_API_KEY",
  /**
   * Where the runner runs, where its starter says (`RUNNER_PLACE`): set by a
   * host's daemon alone, on a Linux box and a Mac alike, This Mac's among
   * them, and unset in the cloud's sandbox.
   */
  PLACE: "APP_RUNNER_PLACE",
} as const;

/** The places a runner's starter names in `RUNNER_ENV.PLACE`. */
export const RUNNER_PLACE = {
  /**
   * A machine its member runs our host on, a Linux box or a Mac, with
   * nobody signed in at it, where each launch runs straight on the box as
   * the host's own user, with full access to what that user reaches, beside
   * the box's other processes. No harness runs a sandbox of its own there,
   * as in the cloud's sandbox, and none asks an approval but where its
   * agent's mode does (`PERMISSION_MODE`): Claude Code under
   * `bypassPermissions` by default, and Codex in `danger-full-access` with
   * approval `never` by default.
   */
  HOST: "host",
} as const;

/**
 * How the folder of the skills a member installed into the app is laid out,
 * which the service writes into the sandbox as it opens and a config line names
 * (`installedSkills`): a Claude Code local plugin, its manifest naming it,
 * whose `skills/` holds one folder per skill, `SKILL.md` and its files, and
 * which is Codex's extra skills root as it stands. Claude Code lists a
 * plugin's skill as `<plugin>:<name>`.
 */
export const INSTALLED_SKILLS = {
  /** The folder of skill folders, under the installed folder. */
  SKILLS: "skills",
  /** The plugin's manifest, under the installed folder. */
  MANIFEST: ".claude-plugin/plugin.json",
  /** The plugin's name, which leads each of its skills' names in Claude Code. */
  PLUGIN: "workspace",
} as const;

/**
 * Claude Code's built-in tools a launch adds to and takes from the CLI's
 * default set, by the names the CLI gives them, which our prompt names in
 * turn. Note that CLI 2.1.304's default set holds neither Glob, Grep, nor a
 * to-do tool (TaskCreate and its siblings replaced TodoWrite), so each is
 * listed to be offered; and that a tool beside one of our own, or one no
 * headless agent can use, is denied, so the agent has one way to do each
 * thing: `ScheduleWakeup` among them, because our `schedule_wakeup` ends
 * the turn and lets the sandbox stop while the agent waits, where the CLI's
 * holds the CLI, and so its sandbox, up for the whole wait. SendMessage
 * stays, because the Agent tool continues a subagent with it.
 */
export const CLAUDE_CODE_TOOLS = {
  ADDED: ["Glob", "Grep", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"],
  DENIED: [
    "ListAgents",
    "CronCreate",
    "CronDelete",
    "CronList",
    "RemoteTrigger",
    "PushNotification",
    "AskUserQuestion",
    "ScheduleWakeup",
  ],
} as const;

/** The read-only subagent a Claude Code launch defines, by the `subagent_type` the Agent tool takes. */
export const CLAUDE_CODE_WORKER = "worker";

/**
 * How a Claude Code launch answers its agent's tool calls (its config's
 * `permissionMode`): every call run unasked, as every launch ran before
 * modes, under the CLI's `bypassPermissions` (`FULL_ACCESS`, the default);
 * a file edit or a shell command asked of the member first, in the CLI's
 * `default` mode (`ASK`); or each call left to the CLI's `auto` classifier,
 * which asks the member where it cannot decide (`AUTO`). An ask reaches the
 * service as an APPROVAL_REQUESTED event and is answered by an `approval`
 * line. A Codex launch reads the same modes with the Codex app's own
 * meanings (`codex.ts`'s Sandbox): no sandbox and nothing asked
 * (`FULL_ACCESS`); its workspace sandbox, asking the member before a
 * command runs outside it (`ASK`); or that sandbox, each such command left to
 * Codex's automatic review (`AUTO`).
 */
export const PERMISSION_MODE = {
  FULL_ACCESS: "full_access",
  ASK: "ask",
  AUTO: "auto",
} as const;
export type PermissionMode = (typeof PERMISSION_MODE)[keyof typeof PERMISSION_MODE];
const PermissionModeSchema = Schema.Literals(Object.values(PERMISSION_MODE));

/**
 * The built-in tools a launch whose mode asks runs unasked, by the names the
 * CLI gives them: those that only read, the checkout or the web, load a
 * skill's instructions or a deferred tool, or keep the agent's own to-do
 * list. Every MCP server the launch hands the CLI, ours and each
 * integration's, runs unasked beside them by its `mcp__<server>` rule, so
 * what asks is a file edit, a shell command, and a server the checkout adds.
 */
export const CLAUDE_CODE_UNASKED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Skill",
  "ToolSearch",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
] as const;

/**
 * The shell commands a launch whose mode asks runs unasked, each by its
 * first words (`@repo/wire`'s `CommandPrefixSchema`, `["pnpm","test"]`):
 * the commands the agent's starter always allows, as their list stood as
 * the service wrote the config. Claude Code takes each as its allow rule
 * for the launch alone. A Codex launch is handed none for now: Codex takes
 * rules only from its own files, which the runner never writes, so its
 * Always allow lasts for the session alone. Read as the service wrote them,
 * which checked each, and ignored by a runner from before them.
 */
const AllowedCommandsSchema = Schema.Array(Schema.Array(Schema.String));

/** The harness a launch runs, spelled as `conversations.runtime` spells it. */
export const RUNNER_HARNESS = {
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;
export type RunnerHarness = (typeof RUNNER_HARNESS)[keyof typeof RUNNER_HARNESS];

/**
 * How a message reached its runner, as the launch's trace names it: a place
 * created from its source agent's snapshot, with a fork of its repository's
 * base drive, or from the agents' image alone; one resumed from its own snapshot; the runner
 * launched again in a place still up; a place made anew where the one found
 * was gone; or a runner already up. The last four are spelled as the
 * service's hand-off event spells them (`SERVER_HANDOFF_PATH`).
 */
export const LAUNCH_PATH = {
  SOURCE_SNAPSHOT: "source_snapshot",
  BASE_DRIVE: "base_drive",
  IMAGE: "image",
  RESUMED: "resumed",
  RELAUNCHED: "relaunched",
  FRESH: "fresh",
  WARM: "warm",
} as const;
export type LaunchPath = (typeof LAUNCH_PATH)[keyof typeof LAUNCH_PATH];

/** The reasoning efforts the pinned SDK takes, as its `EffortLevel` spells them. */
export const EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const;
export type Effort = (typeof EFFORT)[keyof typeof EFFORT];
const EffortSchema = Schema.Literals(Object.values(EFFORT));

/**
 * The reasoning efforts Codex takes (its `model_reasoning_effort`); the pinned
 * protocol types them as any string, so the runner holds the service to these.
 */
export const CODEX_EFFORT = {
  NONE: "none",
  MINIMAL: "minimal",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
} as const;
export type CodexEffort = (typeof CODEX_EFFORT)[keyof typeof CODEX_EFFORT];
const CodexEffortSchema = Schema.Literals(Object.values(CODEX_EFFORT));

/** The line types a stdin line after the config may carry. */
export const INPUT_LINE = {
  MESSAGE: "message",
  STOP: "stop",
  MODEL: "model",
  RETIRE: "retire",
  WARM: "warm",
  APPROVAL: "approval",
} as const;

/**
 * The member's answers to a tool call's ask: allow the call; allow it and,
 * for as long as the launch's CLI runs, every call its rule covers, as the
 * CLI suggested it, kept in the session alone so nothing is written to the
 * checkout (`ALLOW_FOR_AGENT`); or deny it. Where the ask carried a
 * `commandPrefix`, the service also keeps it on the answering member's
 * list, which their later Claude Code launches are handed (`allowedCommands`).
 */
export const APPROVAL_DECISION = {
  ALLOW: "allow",
  ALLOW_FOR_AGENT: "allow_for_agent",
  DENY: "deny",
} as const;
export type ApprovalDecision = (typeof APPROVAL_DECISION)[keyof typeof APPROVAL_DECISION];
const ApprovalDecisionSchema = Schema.Literals(Object.values(APPROVAL_DECISION));

/** What settled a tool call's ask, as APPROVAL_RESOLVED names it. */
export const APPROVAL_BY = {
  /** The member's answer, an `approval` line. */
  MEMBER: "member",
  /** A message the member sent while it waited, which denied it with the message's words. */
  MESSAGE: "message",
  /** The harness withdrew it, as Claude Code does on a stop's interrupt and Codex as it settles the ask itself: denied. */
  ABORTED: "aborted",
  /** The launch ended while it waited: denied. */
  ENDED: "ended",
} as const;
export type ApprovalBy = (typeof APPROVAL_BY)[keyof typeof APPROVAL_BY];
const ApprovalBySchema = Schema.Literals(Object.values(APPROVAL_BY));

/**
 * How much of a call's input its APPROVAL_REQUESTED event carries: each
 * string cut to `TEXT_MAX` characters and each list to `ITEMS_MAX` items, an
 * ellipsis ending a cut string, since a write's whole file can be its input,
 * and the call stands whole in the transcript beside the ask.
 */
export const APPROVAL_INPUT = {
  TEXT_MAX: 2_000,
  ITEMS_MAX: 50,
} as const;

/**
 * What the service's token route answers a runner: the plan's access token,
 * good for at least the route's margin, and the ChatGPT workspace it pays
 * from, which the route names for every runner in the cloud's sandbox, as
 * Codex's sign-in on host-supplied tokens takes it, and for one on a host
 * where the plan named one.
 */
export const RunnerTokenAnswerSchema = Schema.Struct({
  accessToken: Schema.String,
  chatgptAccountId: Schema.optionalKey(Schema.String),
});
export type RunnerTokenAnswer = typeof RunnerTokenAnswerSchema.Type;

/**
 * How a runner reads the service's lines past its config where its config names
 * `linesUrl`, rather than taking them on its stdin, so a line stands at
 * the service until the runner says it took it: a GET under the runner's bearer
 * naming the launch by its first event number and the place of the last
 * line it read, which the service holds open until a line past it is queued or the
 * hold ends, answering the lines past it in order, none at the hold's end.
 * A message line the runner takes it says it took by its ACCEPTED event, as
 * ever; any other line is read once the next read names a place past it.
 * The launch is handed, beside its own, the message lines an earlier launch
 * never took, so a launch that ended before taking one hands it on.
 */
export const RUNNER_LINES = {
  /** The query's names: the launch's first event number, and the place of the last line read. */
  QUERY: { LAUNCH: "launch", AFTER: "after" },
  /** How long the service holds a read with nothing past its place, as it holds a device's. */
  HOLD_MS: 20 * 1_000,
} as const;

const LinePlaceSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

/** What the service answers a read of the runner's lines: the lines past its place, in order, each with its own place. */
export const RunnerLinesAnswerSchema = Schema.Struct({
  lines: Schema.Array(Schema.Struct({ seq: LinePlaceSchema, text: Schema.String })),
});
export type RunnerLinesAnswer = typeof RunnerLinesAnswerSchema.Type;

/**
 * How a runner keeps its CLI's transcript at the service where its config
 * names `transcriptsUrl`: Anthropic's reference `SessionStore`'s five calls
 * (the Agent SDK's `append`, `load`, `listSessions`, `delete`,
 * `listSubkeys`), each one POST under the runner's bearer, run against the
 * agent's own rows. A runner loads a transcript a page at a time
 * (`LOAD_PAGE`), so no one answer must hold a large session whole under the
 * platform's bound on a function's response; `LOAD` is still answered for a
 * runner from before pages, which a Mac may bundle.
 */
export const RUNNER_TRANSCRIPTS = {
  CALL: {
    APPEND: "append",
    LOAD: "load",
    LOAD_PAGE: "loadPage",
    LIST_SESSIONS: "listSessions",
    DELETE: "delete",
    LIST_SUBKEYS: "listSubkeys",
  },
  /** The project Codex's threads are kept under (`codex-rollout.ts`), which names no checkout. */
  CODEX_PROJECT: "codex",
} as const;

/**
 * Whether a Codex rollout's subpath, as the store keeps it, names a file
 * inside `CODEX_HOME`: a relative path of plain segments, none of them `.`
 * or `..`, ending in `.jsonl`, as the mirror keys every rollout Codex
 * writes. Note that a transcript is copied from agent to agent, a sandbox's
 * onto a Mac among them, so a subpath its runner appended is never trusted
 * as a place to write.
 */
export function rolloutSubpathContained(subpath: string): boolean {
  if (!subpath.endsWith(".jsonl") || subpath.includes("\\") || subpath.includes("\0")) {
    return false;
  }
  return subpath
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** How long a Claude Code project key runs before the SDK cuts it and adds the path's hash. */
const CLAUDE_PROJECT_KEY_CHARS = 200;

/**
 * The project the Agent SDK keys a Claude Code session's transcript under
 * for the checkout given, as it keys it from the session's resolved working
 * folder: each character but an ASCII letter or digit as `-`, and past 200
 * characters cut there with the path's 32-bit string hash after it in base
 * 36. Note that a path is read as the SDK reads it on a Mac, composed (NFC),
 * which changes no ASCII path.
 */
export function claudeProjectKey(checkoutPath: string): string {
  const path = checkoutPath.normalize("NFC");
  const key = path.replace(/[^a-zA-Z0-9]/g, "-");
  if (key.length <= CLAUDE_PROJECT_KEY_CHARS) return key;
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash << 5) - hash + path.charCodeAt(index);
    hash |= 0;
  }
  return `${key.slice(0, CLAUDE_PROJECT_KEY_CHARS)}-${Math.abs(hash).toString(36)}`;
}

/** The SDK's `SessionKey`: a project, a session, and a subpath, absent for the main transcript. */
const TranscriptKeySchema = Schema.Struct({
  projectKey: Schema.String,
  sessionId: Schema.String,
  subpath: Schema.optionalKey(Schema.String),
});

/** One transcript line, opaque but for its `type`, as the SDK's `SessionStoreEntry` is. */
const TranscriptEntrySchema = Schema.Record(Schema.String, Schema.Unknown);

/** Where a transcript's next page starts: after the entry the last page ended on. */
const TranscriptCursorSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);

/** One call of a runner's transcript store. */
export const RunnerTranscriptCallSchema = Schema.Union([
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.APPEND),
    key: TranscriptKeySchema,
    entries: Schema.Array(TranscriptEntrySchema),
  }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LOAD),
    key: TranscriptKeySchema,
  }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LOAD_PAGE),
    key: TranscriptKeySchema,
    after: Schema.NullOr(TranscriptCursorSchema),
  }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LIST_SESSIONS),
    projectKey: Schema.String,
  }),
  Schema.Struct({ call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.DELETE), key: TranscriptKeySchema }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LIST_SUBKEYS),
    key: Schema.Struct({ projectKey: Schema.String, sessionId: Schema.String }),
  }),
]);
export type RunnerTranscriptCall = typeof RunnerTranscriptCallSchema.Type;

/** What a load is answered: the whole transcript, none where it was never written. */
export const RunnerTranscriptLoadSchema = Schema.Struct({
  entries: Schema.NullOr(Schema.Array(TranscriptEntrySchema)),
});
export type RunnerTranscriptLoad = typeof RunnerTranscriptLoadSchema.Type;

/** What a page's load is answered: its entries in order, and the cursor the next is read after, none past the last. */
export const RunnerTranscriptPageSchema = Schema.Struct({
  entries: Schema.Array(TranscriptEntrySchema),
  next: Schema.NullOr(TranscriptCursorSchema),
});
export type RunnerTranscriptPage = typeof RunnerTranscriptPageSchema.Type;

/** What a listing of a project's sessions is answered: each with its last append, in epoch milliseconds. */
export const RunnerTranscriptSessionsSchema = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String, mtime: Schema.Number })),
});
export type RunnerTranscriptSessions = typeof RunnerTranscriptSessionsSchema.Type;

/** What a listing of a session's subkeys is answered. */
export const RunnerTranscriptSubkeysSchema = Schema.Struct({
  subkeys: Schema.Array(Schema.String),
});
export type RunnerTranscriptSubkeys = typeof RunnerTranscriptSubkeysSchema.Type;

/** The image types the Messages API takes in a base64 image block. */
export const IMAGE_MEDIA_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
} as const;

/**
 * The largest first number a launch takes: a safe integer with room above it
 * for every event a launch could post, so each next number is exact.
 */
const SEQUENCE_MAX = 2 ** 52;

/**
 * One integration the agent is handed, as an MCP server of its own at the service,
 * reached under the runner's bearer as our own MCP server is: the
 * connection's name (`linear`, `notion-2`), which the server is registered
 * under and its tools are named by, and its endpoint. The name is a bare
 * word, so it stands as a TOML key in Codex's config and in Claude Code's
 * `mcp__<server>__<tool>` as written.
 */
const IntegrationServerSchema = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  url: Schema.String,
});
export type IntegrationServer = typeof IntegrationServerSchema.Type;

const SequenceSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(SEQUENCE_MAX),
);

/**
 * What a launch in the cloud's sandbox is handed to trace its startup in the
 * launch's own Sentry trace (`trace.ts`): the service's DSN, environment and
 * release, the launch span's `sentry-trace` and `baggage`, and the launch's
 * path as `LAUNCH_PATH` spells it. A host's launch is handed none, and its
 * runner sends Sentry nothing. A DSN is the project's public address for
 * sending to it, no secret. The path is read as any word, so a path the
 * service names later never fails an older runner's config.
 */
const RunnerTraceSchema = Schema.Struct({
  dsn: Schema.String,
  environment: Schema.String,
  release: Schema.optionalKey(Schema.String),
  sentryTrace: Schema.String,
  baggage: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
});
export type RunnerTrace = typeof RunnerTraceSchema.Type;

/**
 * The first stdin line of a Claude Code launch: everything one launch of the CLI is started with.
 * `executable` is the `claude` binary the image carries, because the bundled
 * SDK cannot find its own platform package. `firstSequence` is where this
 * launch's events are numbered from, one past the last event the service applied, so
 * a relaunch with `resume` goes on numbering where the last launch stopped.
 */
export const ClaudeCodeConfigSchema = Schema.Struct({
  /** Absent in a config written before Codex mode, which is Claude Code's. */
  harness: Schema.optionalKey(Schema.Literal(RUNNER_HARNESS.CLAUDE_CODE)),
  cwd: Schema.String,
  /** The agent the launch runs, whose id names the refs its checkout's snapshots stand under (`checkout-snapshot.ts`); none in a config written before it, whose turns take no snapshot. */
  agentId: Schema.optionalKey(Schema.String),
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(EffortSchema),
  /** Whether Claude Code's own fast mode is on, for an agent on a model's fast version. */
  fast: Schema.optionalKey(Schema.Boolean),
  /**
   * Whether the CLI keeps the main conversation's prompt cache for an hour
   * rather than five minutes (`CLAUDE_CODE_PROMPT_CACHE_TTL`), for an agent
   * of the half the service runs it on; a runner from before this key ignores it.
   */
  promptCacheHour: Schema.optionalKey(Schema.Boolean),
  /** Our coder instructions, appended to Claude Code's own system prompt. */
  append: Schema.String,
  /** The CLI's session id to resume, where this launch continues one. */
  resume: Schema.optionalKey(Schema.String),
  /** The service's id of a prompt a rewind dropped: the resumed session is cut just before it, and resumed whole where it holds no such prompt. */
  rewindBefore: Schema.optionalKey(Schema.String),
  /** Whether the session resumed is another agent's, which a continued or forked agent forks as its own (the SDK's `forkSession`). */
  fork: Schema.optionalKey(Schema.Boolean),
  firstSequence: SequenceSchema,
  /** Where the runner posts its events. */
  eventsUrl: Schema.String,
  /** Where the runner reads the service's lines past its config, in place of its stdin (`RUNNER_LINES`); none where the service writes them to its stdin. */
  linesUrl: Schema.optionalKey(Schema.String),
  /** Our MCP server's streamable-HTTP endpoint. */
  mcpUrl: Schema.String,
  /**
   * Our MCP server's tools the worker subagent (`CLAUDE_CODE_WORKER`) may not
   * call, by name: every one that does more than read. Absent in a config
   * written before it, where the worker is denied the whole server.
   */
  workerDenied: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Where the CLI's transcript is kept at the service (`RUNNER_TRANSCRIPTS`), handed to the SDK as its `sessionStore`; none where the CLI's own files are all it keeps. */
  transcriptsUrl: Schema.optionalKey(Schema.String),
  /** The integrations the agent is handed, one MCP server each; none in a config written before them. */
  integrations: Schema.optionalKey(Schema.Array(IntegrationServerSchema)),
  /**
   * Read by no runner since Claude Code's command sandbox went: written empty
   * for a host whose release bundles a runner from before, which refuses a
   * config without it, and dropped once the service's host version floor
   * (`HOST_VERSION.FLOOR`) passes that release.
   */
  allowedDomains: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Where the member's installed skills are (`INSTALLED_SKILLS`), loaded as a local plugin where the folder holds one. */
  installedSkills: Schema.optionalKey(Schema.String),
  /** Whether the launch stays warm while no turn of it runs (`RUNNER_WARM`): from its start until a message comes, and once the agent's turn is over, posting IDLE rather than ending; it ends there where absent. */
  warm: Schema.optionalKey(Schema.Boolean),
  /** Where the launch's startup is traced in Sentry (`RunnerTrace`); none where it is not, as on a host, and in a config written before it. */
  trace: Schema.optionalKey(RunnerTraceSchema),
  /** How long a warm launch stays warm before it ends itself (`RUNNER_WARM`); `RUNNER_WARM.IDLE_CAP_MS` where absent. */
  warmForMs: Schema.optionalKey(Schema.Number),
  /** How the launch answers its agent's tool calls (`PERMISSION_MODE`); full access where absent, as in a config written before modes. */
  permissionMode: Schema.optionalKey(PermissionModeSchema),
  /** The commands the launch runs unasked in a mode that asks (`AllowedCommandsSchema`); none where absent, as with full access. */
  allowedCommands: Schema.optionalKey(AllowedCommandsSchema),
});
export type ClaudeCodeConfig = typeof ClaudeCodeConfigSchema.Type;

/**
 * The first stdin line of a Codex launch. `executable` is the `codex` binary
 * the image carries (P17); `CODEX_HOME`, where Codex keeps its threads, comes
 * from the launch's environment and must exist before the runner starts.
 * `threadId` is the thread to resume, where this launch continues one; a new
 * thread's id reaches the service in its `thread/started` notification.
 */
export const CodexConfigSchema = Schema.Struct({
  harness: Schema.Literal(RUNNER_HARNESS.CODEX),
  cwd: Schema.String,
  /** The agent the launch runs, whose id names the refs its checkout's snapshots stand under (`checkout-snapshot.ts`); none in a config written before it, whose turns take no snapshot. */
  agentId: Schema.optionalKey(Schema.String),
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(CodexEffortSchema),
  /**
   * Whether the agent runs its model's fast version: Codex's documented
   * `fast` service tier (the API's `priority`), which a launch on an OpenAI
   * API key alone asks for; the plan's launch runs none.
   */
  fast: Schema.optionalKey(Schema.Boolean),
  /**
   * Whether the agent runs its model's Ultrafast version: Codex's
   * `ultrafast` service tier, which a launch on an OpenAI API key alone asks
   * for, over `fast`. The service sends `fast` beside it, so a runner from
   * before this key, a Mac's or a host's among them, runs the fast tier
   * rather than the standard one.
   */
  ultrafast: Schema.optionalKey(Schema.Boolean),
  /** Our coder instructions, as the thread's `developer_instructions`. */
  developerInstructions: Schema.String,
  threadId: Schema.optionalKey(Schema.String),
  /** The service's id of a message a rewind dropped: the resumed thread is reverted to before the turn that took it, and resumed whole where none did. */
  rewindBefore: Schema.optionalKey(Schema.String),
  /** Whether the thread is another agent's, which a continued or forked agent forks as its own (`thread/fork`). */
  fork: Schema.optionalKey(Schema.Boolean),
  firstSequence: SequenceSchema,
  eventsUrl: Schema.String,
  /** Where the runner reads the service's lines past its config (`RUNNER_LINES`); none where the service writes them to its stdin. */
  linesUrl: Schema.optionalKey(Schema.String),
  mcpUrl: Schema.String,
  /** Where Codex's rollout is kept at the service (`RUNNER_TRANSCRIPTS`), mirrored as Codex writes it and written back to `CODEX_HOME` where it is missing; none where Codex's own files are all it keeps. */
  transcriptsUrl: Schema.optionalKey(Schema.String),
  /** The integrations the agent is handed, one MCP server each; none in a config written before them. */
  integrations: Schema.optionalKey(Schema.Array(IntegrationServerSchema)),
  /**
   * Where the runner asks the service for the plan's access token, under its bearer
   * (`/api/agents/runner-token`), in the cloud's sandbox, as it signs
   * app-server in and again after a 401, so a turn outlives any one token.
   * Not asked where the launch's environment holds `OPENAI_API_KEY`, the
   * account's API key paying, nor on a host, whose app-server runs on the
   * machine's own login.
   */
  tokenUrl: Schema.String,
  /** Where the member's installed skills are (`INSTALLED_SKILLS`), whose `skills/` is set as an extra skills root where it is there. */
  installedSkills: Schema.optionalKey(Schema.String),
  /** Whether the launch stays warm while no turn of it runs (`RUNNER_WARM`): from its start until a message comes, and once the agent's turn is over, posting IDLE rather than ending; it ends there where absent. */
  warm: Schema.optionalKey(Schema.Boolean),
  /** Where the launch's startup is traced in Sentry (`RunnerTrace`); none where it is not, as on a host, and in a config written before it. */
  trace: Schema.optionalKey(RunnerTraceSchema),
  /** How long a warm launch stays warm before it ends itself (`RUNNER_WARM`); `RUNNER_WARM.IDLE_CAP_MS` where absent. */
  warmForMs: Schema.optionalKey(Schema.Number),
  /** How the launch answers its agent's tool calls (`PERMISSION_MODE`), as the Codex app means each; full access where absent, as in a config written before modes. */
  permissionMode: Schema.optionalKey(PermissionModeSchema),
});
export type CodexConfig = typeof CodexConfigSchema.Type;

/** The first stdin line, for either harness. */
export const RunnerConfigSchema = Schema.Union([CodexConfigSchema, ClaudeCodeConfigSchema]);
export type RunnerConfig = typeof RunnerConfigSchema.Type;

const TextBlockSchema = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
const ImageBlockSchema = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.Struct({
    type: Schema.Literal("base64"),
    media_type: Schema.Literals(Object.values(IMAGE_MEDIA_TYPE)),
    data: Schema.String,
  }),
});
export const ContentBlockSchema = Schema.Union([TextBlockSchema, ImageBlockSchema]);
export type ContentBlock = typeof ContentBlockSchema.Type;

/** A UUID as the SDK spells one, which is what a message's `uuid` must be. */
const UuidSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

/**
 * A message for the session, in the Messages API's own block shapes. `uuid`
 * is the service's id for the message, handed to the SDK as the prompt's own, so
 * the ACCEPTED event and the `result` that answers it name it; the runner
 * mints one where a line names none. `resent` marks a message handed again
 * to a session that already holds it, as a turn its plan's limit cut short
 * is on the next payer: Claude Code drops a resumed session's prompt under
 * a uuid the session holds, answering nothing, so the runner hands the SDK
 * the prompt under a uuid of its own, and ACCEPTED still names the service's.
 * `compact` asks for the session's compaction in the message's place: Codex
 * compacts its thread (`thread/compact/start`), which takes no words, once no
 * turn of its own runs, and Claude Code, whose CLI runs the message's bare
 * `/compact` as its own command, needs no mark. A runner from before the mark
 * hands the message on as words.
 */
const MessageLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MESSAGE),
  uuid: Schema.optionalKey(UuidSchema),
  content: Schema.Array(ContentBlockSchema),
  resent: Schema.optionalKey(Schema.Boolean),
  compact: Schema.optionalKey(Schema.Boolean),
});
/**
 * Stop the running turn. `launch` names the launch the stop is for by its
 * first event number (its config's `firstSequence`): one launch runs one of
 * the service's turns, so a stop the service meant for an earlier launch's
 * turn, delayed past it, is skipped by the launch that replaced it rather than
 * interrupting its turn. A stop that names none is taken by any launch.
 */
const StopLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.STOP),
  launch: Schema.optionalKey(SequenceSchema),
});
/**
 * A model or effort change, applied from the next model call on Claude Code
 * and from the next turn on Codex. An effort the launch's harness does not
 * take is skipped. `fast` turns Claude Code's own fast mode on or off, and
 * Codex's `fast` service tier on an API key from its next turn, and
 * `ultrafast` Codex's `ultrafast` tier over it, absent where off; Codex on
 * the plan skips both, and Claude Code `ultrafast`.
 */
const ModelLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MODEL),
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Schema.Union([EffortSchema, CodexEffortSchema])),
  fast: Schema.optionalKey(Schema.Boolean),
  ultrafast: Schema.optionalKey(Schema.Boolean),
});

/**
 * End the launch if it is warm: its turn over, nothing in flight, no
 * message of the service's unanswered, and no turn of the CLI's own begun since.
 * The service writes it where a warm launch's host waits to switch release
 * (`coder-host/runner-sessions.ts`'s `retireWarmRunner`), as a host does to
 * its own warm launches while it waits (`@repo/host`'s
 * `compose-local-agents.ts`), and a launch in any other state skips it, so a
 * message written ahead of it on the same stdin always wins.
 */
const RetireLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.RETIRE),
});

/**
 * Keep the launch warm: a warm launch's window (`RUNNER_WARM`) runs again from
 * now. The service writes it while a client has the agent on screen
 * (`coder-host/runner-sessions.ts`'s `warm`), and a launch at work skips it,
 * since its next IDLE arms a window of its own.
 */
const WarmLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.WARM),
});

/**
 * The member's answer to a tool call's ask, naming the APPROVAL_REQUESTED
 * event's `requestId`; `message` tells the agent why a call was denied, "The
 * member denied this." where absent. A launch with no such ask waiting skips
 * it, as one already settled has none.
 */
const ApprovalLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.APPROVAL),
  requestId: Schema.String,
  decision: ApprovalDecisionSchema,
  message: Schema.optionalKey(Schema.String),
});

export const InputLineSchema = Schema.Union([
  MessageLineSchema,
  StopLineSchema,
  ModelLineSchema,
  RetireLineSchema,
  WarmLineSchema,
  ApprovalLineSchema,
]);
export type InputLine = typeof InputLineSchema.Type;

/**
 * The runner's own events, numbered among the SDK's messages, each a `type`
 * the SDK never uses.
 *
 * ACCEPTED is posted as a message line is handed to the SDK, naming the
 * message's `uuid`, so the service ties the message it sent to the turn that runs
 * it: the CLI never echoes a prompt back. WAITING follows a `result` the run
 * outlives, because the Stop hook before it reported background work or a
 * scheduled wakeup still to come: the agent is waiting, not done, and the
 * sandbox must stay up. CONNECTION_LOST follows a model turn the harness gave
 * up on because it could not reach its provider after its own retries: the
 * launch stays up and probes the provider's host (`reconnect.ts`), and
 * CONNECTION_RESTORED follows once the host answers, saying whether the
 * service should send the agent a carry-on line, or nothing where a line the
 * service sent meanwhile goes next instead; a launch whose host never
 * answers within `RUNNER_RECONNECT.GIVE_UP_MS` ends `FAILED` with
 * `connectionLostFailure`'s words. IDLE follows a `result`, or Codex's
 * `turn/completed`, that leaves nothing in flight or unanswered: the agent's
 * turn is over, as a `turn_ended` END says, but the launch stays warm
 * (`RUNNER_WARM`), so the service's next message is a line on its stdin rather than
 * a resumed sandbox and a relaunched CLI. END is the last event a launch
 * posts, with why it ended.
 *
 * APPROVAL_REQUESTED is posted as a launch whose mode asks
 * (`PERMISSION_MODE`) holds a tool call for the member's answer, and
 * APPROVAL_RESOLVED once the ask is settled, whatever settled it, so each
 * ask a launch posts is resolved before its END.
 */
export const RUNNER_EVENT = {
  ACCEPTED: "vespin_runner_accepted",
  WAITING: "vespin_runner_waiting",
  CONNECTION_LOST: "vespin_runner_connection_lost",
  CONNECTION_RESTORED: "vespin_runner_connection_restored",
  IDLE: "vespin_runner_idle",
  END: "vespin_runner_end",
  APPROVAL_REQUESTED: "vespin_runner_approval_requested",
  APPROVAL_RESOLVED: "vespin_runner_approval_resolved",
} as const;

/** Why a launch ended. */
export const RUNNER_END = {
  /** A `result`, or Codex's `turn/completed`, with nothing left in flight or unanswered: the agent's turn is over. */
  TURN_ENDED: "turn_ended",
  /** A `result`, or an interrupted turn, after a stop: the turn was stopped. */
  STOPPED: "stopped",
  /** The service closed stdin, or the CLI ended its stream, before a turn ended. */
  INPUT_CLOSED: "input_closed",
  /** The CLI or app-server failed, or Codex's turn did; the turn shows as failed, and the next message relaunches with `resume`. */
  FAILED: "failed",
  /** A warm launch ended with no turn under way: retired by the service or its host, or past its warm window on its own (`RUNNER_WARM`). Its turn was already over at its IDLE, or it never took a message. */
  IDLED: "idled",
} as const;
export type RunnerEnd = (typeof RUNNER_END)[keyof typeof RUNNER_END];

/**
 * How the runner's process exits: a launch that ended as the service asked or
 * as its turn did, one that failed, and one whose config line never came
 * within `RUNNER_CONFIG.WAIT_MS`, which has no route to say so but its exit,
 * since the config is what names the events route.
 */
export const RUNNER_EXIT = {
  ENDED: 0,
  FAILED: 1,
  UNCONFIGURED: 3,
} as const;

/**
 * How long a launch waits for its config line before it exits as
 * `RUNNER_EXIT.UNCONFIGURED` rather than stand up reading nothing: the
 * service writes it right after it starts the command, or hands it with the
 * launch on a Mac, so one that has not come in this long never will.
 */
export const RUNNER_CONFIG = {
  WAIT_MS: 2 * 60 * 1_000,
} as const;

/**
 * How long a warm launch waits on its own before it ends itself. The service
 * hands each warm launch its window (`warmForMs`, from `CODER.RUNNER_WARM`),
 * and a launch past it is ended here rather than by a sweep: a message the
 * service sends past the window relaunches rather than writing to it
 * (`coder-host/runner-sessions.ts`'s `sendHolding`). `IDLE_CAP_MS` is the
 * bound for a config from a service before `warmForMs`, since the heartbeat
 * keeps a sandbox alive for as long as its launch runs.
 */
export const RUNNER_WARM = {
  IDLE_CAP_MS: 60 * 60 * 1_000,
} as const;

/** The IDLE event: the agent's turn is over, and the launch stays warm for the next message. */
export interface RunnerIdle {
  readonly type: typeof RUNNER_EVENT.IDLE;
}

/** Where a checkout keeps the snapshots taken before each turn (`checkout-snapshot.ts`): under the agent's id, each under a stamp of when it was taken and the line's id, in the clone's own refs beside an archived agent's (`refs/vespin/archive/`). */
export const CHECKOUT_SNAPSHOT = {
  REF_PREFIX: "refs/vespin/turns/",
  /** How many snapshots a checkout keeps: the oldest beyond go as a new one is taken. */
  KEEP: 20,
} as const;

/** The checkout as it stood before a turn: the snapshot commit, `HEAD` where the checkout had commits, and the branch checked out where one was. */
export interface CheckoutSnapshot {
  readonly commit: string;
  /** `HEAD` at the snapshot, the snapshot's parent; none in a repository with no commits yet. */
  readonly head?: string | undefined;
  /** The branch checked out at the snapshot; none on a detached `HEAD`. */
  readonly branch?: string | undefined;
}

/**
 * The ACCEPTED event: the message line, by its `uuid`, handed to the SDK, or
 * taken by Codex's app-server, with the checkout as it stood before the turn
 * the line opens (`checkout-snapshot.ts`); no snapshot where the line joined
 * a turn under way, or where the checkout could not be snapshotted.
 */
export interface RunnerAccepted {
  readonly type: typeof RUNNER_EVENT.ACCEPTED;
  readonly uuid: string;
  readonly snapshot?: CheckoutSnapshot | undefined;
}

/** The WAITING event: what the Stop hook before the `result` reported still in flight, as the SDK spells it. */
export interface RunnerWaiting {
  readonly type: typeof RUNNER_EVENT.WAITING;
  readonly background_tasks: readonly BackgroundTaskSummary[];
  readonly session_crons: readonly SessionCronSummary[];
}

/** The CONNECTION_LOST event: the provider's host the launch could not reach and now probes. */
export interface RunnerConnectionLost {
  readonly type: typeof RUNNER_EVENT.CONNECTION_LOST;
  readonly host: string;
}

/**
 * The CONNECTION_RESTORED event: the host answers again. `carryOn` asks the
 * service to send the agent a carry-on line, since the model turn the loss
 * cut off left its work where it stood; it is false where a line the service
 * sent during the wait goes next instead.
 */
export interface RunnerConnectionRestored {
  readonly type: typeof RUNNER_EVENT.CONNECTION_RESTORED;
  readonly host: string;
  readonly carryOn: boolean;
}

/**
 * How a launch waits for its provider's host to answer again after the
 * harness gave up reaching it: a TCP connect to the host on 443, through the
 * `HTTPS_PROXY` when one is set, asked again after a wait that doubles from
 * the first to the longest, for at most `GIVE_UP_MS` in all, each connect
 * given `PROBE_TIMEOUT_MS` to answer. The bound guards two costs: a sandbox
 * kept up for a provider that stays down, and the turn's progress lease on
 * the service, which the sweep fails a silent turn at fifteen minutes past
 * its last progress (`@repo/features/turn-deadline`'s `PROGRESS_MS`): a Mac
 * cut off from the provider is cut off from the service too, so the runner's
 * own end, with why, must come before the sweep's does.
 */
export const RUNNER_RECONNECT = {
  FIRST_WAIT_MS: 5 * 1_000,
  LONGEST_WAIT_MS: 60 * 1_000,
  GIVE_UP_MS: 10 * 60 * 1_000,
  PROBE_TIMEOUT_MS: 5 * 1_000,
} as const;

/**
 * The words a launch ends `FAILED` with over its provider's connection, which
 * the service reads as the agent's connection-lost failure
 * (`coder-host/status.ts`), each after the host's name and the same in every
 * such end: the host never answered within `RUNNER_RECONNECT.GIVE_UP_MS`, or
 * it was lost again before the model answered anything since the last
 * carry-on, where probing again would only loop.
 */
export const CONNECTION_LOST_DETAIL = {
  GAVE_UP: " could not be reached, and did not answer again within the wait",
  LOST_AGAIN: " could not be reached again before the model answered",
} as const;

/** What a launch ends with where its provider's connection failed it, by which way (`CONNECTION_LOST_DETAIL`). */
export function connectionLostFailure(
  host: string,
  detail: (typeof CONNECTION_LOST_DETAIL)[keyof typeof CONNECTION_LOST_DETAIL],
): string {
  return `${host}${detail}`;
}

/**
 * How long a launch waits on the CLI's answer to one control request (a
 * model change, an interrupt). The input loop takes the service's lines one at a
 * time and every message goes behind a model line, so a request the CLI
 * never answers would hold every later message and Stop; past this, a model
 * change is let go and an interrupt ends the launch as `STOPPED`. The CLI
 * answers one within a second, and five leaves an interrupt's end inside
 * the bound the service forces a Stop at (`CODER.STOP_CONFIRM`, ten seconds).
 */
export const RUNNER_CONTROL = {
  ANSWER_MS: 5 * 1_000,
} as const;

/** How long a launch holds a message a `result` naming no prompt left unanswered, for the CLI to take it up (`runner.ts`'s `watchUnheard`): five minutes, past the CLI's own retries of a failed model call, which put out no turn output. */
export const RUNNER_UNANSWERED = {
  SILENCE_MS: 5 * 60 * 1_000,
} as const;

/** The END event; `detail` is the CLI's failure, with the launch's secrets taken out, where it failed. */
export interface RunnerEndEvent {
  readonly type: typeof RUNNER_EVENT.END;
  readonly reason: RunnerEnd;
  readonly detail?: string;
}

/**
 * The APPROVAL_REQUESTED event: a tool call held for the member's answer, an
 * `approval` line naming its `requestId`, the CLI's id for the ask on
 * Claude Code and one the runner makes on Codex. `toolUseId` is the call's
 * `tool_use` block's id, or the id of the Codex item that asks, so the ask
 * stands on the call in the transcript; `agentId` the subagent's that made it, absent for
 * the agent's own; `title` the CLI's sentence for the ask, or the tool's
 * name where it gave none; `description` its subtitle, where it gave one;
 * `input` the call's input, cut as `APPROVAL_INPUT` says; `commandPrefix`
 * the command's first words where the harness proposed a rule for every
 * command starting with them (Claude Code's Bash suggestion ending in a
 * wildcard), which the member's Always allow keeps past the session, and
 * absent where it proposed none, as on every Codex ask for now. The
 * service keeps a prefix only where it is one `@repo/wire`'s
 * `CommandPrefixSchema` takes, so a runner's is read loosely here, and one
 * it does not take leaves the ask as it is.
 */
export const RunnerApprovalRequestedSchema = Schema.Struct({
  type: Schema.Literal(RUNNER_EVENT.APPROVAL_REQUESTED),
  requestId: Schema.String,
  toolUseId: Schema.String,
  agentId: Schema.optionalKey(Schema.String),
  toolName: Schema.String,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  input: Schema.Record(Schema.String, Schema.Unknown),
  commandPrefix: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type RunnerApprovalRequested = typeof RunnerApprovalRequestedSchema.Type;

/** The APPROVAL_RESOLVED event: the ask by its `requestId` settled, with what was decided and what decided it. */
export const RunnerApprovalResolvedSchema = Schema.Struct({
  type: Schema.Literal(RUNNER_EVENT.APPROVAL_RESOLVED),
  requestId: Schema.String,
  decision: ApprovalDecisionSchema,
  by: ApprovalBySchema,
});
export type RunnerApprovalResolved = typeof RunnerApprovalResolvedSchema.Type;

/**
 * One notification `codex app-server` sent, as it wrote it (the pinned
 * protocol's `ServerNotification`, generated into `codex-protocol/`). Every
 * notification is posted, the thread's subagents' included; the projection
 * (P22) picks what it shows.
 */
export type CodexNotification = ServerNotification;

/**
 * The kinds of `CodexErrorInfo` the pinned protocol names
 * (`codex-protocol/v2/CodexErrorInfo.ts`): a bare word, or the one key of an
 * object that carries its details, such as `activeTurnNotSteerable`'s
 * `turnKind`. A turn's failure and a refused request alike carry one.
 */
export const CODEX_ERROR_INFO = {
  CONTEXT_WINDOW_EXCEEDED: "contextWindowExceeded",
  SESSION_BUDGET_EXCEEDED: "sessionBudgetExceeded",
  USAGE_LIMIT_EXCEEDED: "usageLimitExceeded",
  RATE_LIMIT_EXCEEDED: "rateLimitExceeded",
  FLEX_UNAVAILABLE: "flexUnavailable",
  SERVER_OVERLOADED: "serverOverloaded",
  CYBER_POLICY: "cyberPolicy",
  MISALIGNMENT_POLICY_VIOLATION: "misalignmentPolicyViolation",
  TOO_MANY_DENIALS: "tooManyDenials",
  HTTP_CONNECTION_FAILED: "httpConnectionFailed",
  RESPONSE_STREAM_CONNECTION_FAILED: "responseStreamConnectionFailed",
  INTERNAL_SERVER_ERROR: "internalServerError",
  UNAUTHORIZED: "unauthorized",
  BAD_REQUEST: "badRequest",
  THREAD_ROLLBACK_FAILED: "threadRollbackFailed",
  SANDBOX_ERROR: "sandboxError",
  RESPONSE_STREAM_DISCONNECTED: "responseStreamDisconnected",
  RESPONSE_TOO_MANY_FAILED_ATTEMPTS: "responseTooManyFailedAttempts",
  ACTIVE_TURN_NOT_STEERABLE: "activeTurnNotSteerable",
  OTHER: "other",
} as const;

export type CodexErrorKind = (typeof CODEX_ERROR_INFO)[keyof typeof CODEX_ERROR_INFO];

const CodexErrorKindSchema = Schema.Literals(Object.values(CODEX_ERROR_INFO));
const decodeCodexErrorKind = Schema.decodeUnknownOption(CodexErrorKindSchema);

/**
 * The kind of a `codexErrorInfo` as Codex wrote it: its word, or its
 * object's one key; none for a kind this pin does not name, or no info.
 */
export function codexErrorKind(info: unknown): CodexErrorKind | undefined {
  const named =
    typeof info === "string"
      ? info
      : typeof info === "object" && info !== null && Object.keys(info).length === 1
        ? Object.keys(info)[0]
        : undefined;
  return Option.getOrUndefined(decodeCodexErrorKind(named));
}

/** What the runner posts: the SDK's message or Codex's notification as it was emitted, or one of the runner's own. */
export type RunnerMessage =
  | SDKMessage
  | CodexNotification
  | RunnerAccepted
  | RunnerWaiting
  | RunnerConnectionLost
  | RunnerConnectionRestored
  | RunnerIdle
  | RunnerEndEvent
  | RunnerApprovalRequested
  | RunnerApprovalResolved;

/** One event as posted: its number and its message. */
export interface RunnerEvent {
  readonly sequence: number;
  readonly message: RunnerMessage;
}

/**
 * One POST's body: consecutive events, in order. The service applies each sequence
 * at most once. A batch with no events is the launch's heartbeat
 * (`RUNNER_HEARTBEAT`), which applies nothing.
 */
export interface RunnerEventBatch {
  readonly events: readonly RunnerEvent[];
}

/**
 * How often a launch tells the service it still runs, as a batch with no events,
 * for as long as it runs, on its own timer whatever its harness says. A harness
 * may say nothing for an hour while a background command or a wakeup it waits
 * on runs, and the service touches the sandbox during a turn only on what the
 * runner posts, about once a minute, against a sandbox that stops five idle
 * minutes after its last touch, so a minute leaves room for heartbeats the
 * service did not take, and costs one small post each.
 */
export const RUNNER_HEARTBEAT = {
  EVERY_MS: 60 * 1_000,
  /**
   * How long one heartbeat waits on the service's answer before it is let go, well
   * inside the interval, so a post the service never answers cannot hold back the
   * next one.
   */
  TIMEOUT_MS: 30 * 1_000,
} as const;
