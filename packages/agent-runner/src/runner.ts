/**
 * runner.ts -- one launch of an agent: the bearer and the config line read, the harness the config names run (Claude Code here, Codex in `codex.ts`), and the launch's last event posted; for Claude Code, the CLI spawned and initialized by `startup()` and then run in streaming input mode, the service's lines fed to it, its messages posted out, and the launch ended when the agent's turn is.
 *
 * Two loops run side by side. The input loop reads the service's lines, from stdin
 * or, where the config names the read, from the service (`lines.ts`), and acts on
 * each at once: a message joins the prompt stream, a stop calls
 * `interrupt()`, a model change calls `setModel()` or `applyFlagSettings()`,
 * an approval answers the tool call it names (`approvals.ts`).
 * It never waits on the session's output, so a stop reaches the CLI even
 * while a long foreground command holds the turn (P00 found exactly this).
 * The output loop posts every SDK message, in order, and decides when the
 * launch is over.
 *
 * When the turn ends. A `result` closes one model turn, but the agent's turn,
 * its whole run, can outlive it: Claude Code ends a model turn while a
 * background command runs or a `ScheduleWakeup` is set, and starts another
 * when either comes back (P00's first turn does both). The Stop hook, which
 * runs before each `result`, reports that work (`background_tasks`,
 * `session_crons`), so the agent's turn is over at a `result` only when
 * the last Stop hook reported none, and otherwise the runner posts a WAITING
 * event and keeps the CLI up, however long the wait, since the CLI fires a
 * session's scheduled tasks only while it runs. Nor is it over while a message the service sent during
 * a turn is still unanswered: the CLI runs it as its next turn, and where a
 * `result` that named no prompt left the message, the launch fails once the
 * CLI has said nothing for `RUNNER_UNANSWERED`. A turn that
 * is over ends the launch, or, where the config asks it to stay `warm`,
 * posts IDLE and keeps the CLI up (`RUNNER_WARM`) for the service's next message,
 * until the service or its host retires it or its warm window ends it; a
 * `warm` line re-arms that window, and such a launch is warm from its start
 * too, so one the service launched with no message waits for its first as
 * one past an IDLE does. A `result` after a stop
 * ends the launch whatever is pending, and so does one no Stop hook came
 * before, such as an error's. A stop interrupts whichever turn is running, a
 * wakeup's included, and ends a launch with none at once.
 *
 * One error's `result` ends nothing: the one the CLI puts out when it could
 * not reach the API after its own retries (`reconnect.ts`). The launch then
 * posts CONNECTION_LOST, holds every message the service sends meanwhile, and
 * probes the API's host until it answers, when the held messages go to the
 * CLI, or, where none came, CONNECTION_RESTORED asks the service to send
 * the agent a carry-on line, since the model turn the loss cut off left its
 * work where it stood. A host that never answers within the bound ends the
 * launch failed with why, and so does a connection lost again before the
 * CLI put out any turn output since the last carry-on, where probing again
 * would only loop.
 */

import { randomUUID, type UUID } from "node:crypto";
import type {
  AgentDefinition,
  HookCallback,
  McpSdkServerConfigWithInstance,
  Options,
  SDKMessage,
  SDKUserMessage,
  SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import { CommandPrefixSchema } from "@repo/wire";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  MutableRef,
  Option,
  Queue,
  Redacted,
  Ref,
  Result,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import {
  type Approvals,
  BASH_TOOL,
  canUseToolOf,
  denyForMessage,
  denyWaiting,
  openApprovals,
  settleAsk,
} from "./approvals.js";
import { CheckoutSnapshots } from "./checkout-snapshot.js";
import { ClaudeCode, type ClaudeCodeService, type ClaudeCodeSession } from "./claude-code.js";
import { runCodex } from "./codex.js";
import { type EventSink, openEventSink } from "./events.js";
import {
  harnessEnvOf,
  installedSkillsPath,
  type LaunchContext,
  type LaunchOutcome,
  RunnerFailed,
  RunnerUnconfigured,
  toolEnvOf,
} from "./launch.js";
import { readLines } from "./lines.js";
import { openMcpRelay } from "./mcp-relay.js";
import { type ClaudeCodeMemoryWatch, claudeCodeMemoryWatch } from "./out-of-memory.js";
import {
  APPROVAL_BY,
  type CheckoutSnapshot,
  CLAUDE_CODE_TOOLS,
  CLAUDE_CODE_UNASKED_TOOLS,
  CLAUDE_CODE_WORKER,
  type ClaudeCodeConfig,
  CONNECTION_LOST_DETAIL,
  connectionLostFailure,
  EFFORT,
  type Effort,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  InputLineSchema,
  PERMISSION_MODE,
  type PermissionMode,
  RUNNER_CONFIG,
  RUNNER_CONTROL,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_UNANSWERED,
  RUNNER_WARM,
  type RunnerConfig,
  RunnerConfigSchema,
  type RunnerEnd,
  type RunnerEndEvent,
  type RunnerWaiting,
} from "./protocol.js";
import {
  awaitProvider,
  claudeCodeConnectionLost,
  type ProbeTarget,
  probeTargetOf,
  providerTargetOf,
} from "./reconnect.js";
import { type LaunchTrace, launchTrace, RUNNER_SPAN } from "./trace.js";
import { transcriptStore } from "./transcripts.js";

/** The variable that bounds how long the CLI's first turn waits on a pending MCP server, in milliseconds (Claude Code 2.1.274 on). */
const CLAUDE_CODE_MCP_STARTUP_WAIT = "CLAUDE_CODE_MCP_STARTUP_WAIT_MS";

/**
 * The variables that set how long the CLI keeps its prompt cache: the main
 * conversation's alone, "5m" or "1h", which leaves workers and other
 * subagents on the CLI's default (`MAIN`); every request's an hour, set to
 * "1" (`ALL`); and every request's five minutes, over both (`FORCE_SHORT`)
 * (CLI 2.1.304, as its binary reads them).
 */
const PROMPT_CACHE_TTL = {
  MAIN: "CLAUDE_CODE_PROMPT_CACHE_TTL",
  ALL: "ENABLE_PROMPT_CACHING_1H",
  FORCE_SHORT: "FORCE_PROMPT_CACHING_5M",
} as const;

/** The variable the CLI reads its API's base URL from, where a gateway stands in for the API. */
const ANTHROPIC_BASE_URL = "ANTHROPIC_BASE_URL";

/** The API's host where no base URL is set. */
const ANTHROPIC_API_HOST = "api.anthropic.com";

/** The name our MCP server is registered under, so its tools reach the model as `mcp__workspace__<tool>` (`@repo/features/agent-tools`'s `WORKSPACE_MCP_SERVER`). */
const MCP_SERVER = "workspace";

/** Claude Code's built-ins the worker goes without: those that write a file or start another worker. */
const WORKER_DENIED_BUILT_INS = ["Edit", "Write", "NotebookEdit", "Agent"] as const;

/**
 * The worker the agent hands a scoped job to (`CLAUDE_CODE_WORKER`): its
 * own model's, without the tools that write a file, start another worker,
 * or act through the service, and told to read only, which Bash and the
 * integration servers it keeps could still contradict. It keeps our
 * server's reads, such as a task or another agent's transcript, and is
 * denied the rest by name (`workerDenied`); a config that names none
 * denies it the whole server.
 */
function workerOf(config: ClaudeCodeConfig): AgentDefinition {
  const ours =
    config.workerDenied === undefined
      ? [`mcp__${MCP_SERVER}`]
      : config.workerDenied.map((tool) => `mcp__${MCP_SERVER}__${tool}`);

  return {
    description:
      "A read-only worker for one scoped job, such as a broad search, a comparison of approaches, or an investigation: it reads the checkout and the web and answers, and never edits, commits, or pushes.",
    prompt:
      "You are a read-only worker for an agent. Do the one job you were handed and answer with what it asks for. You are read-only in the checkout: never write, edit, move, or delete a file, never commit or push; run only commands that read, and use the connected services only to read from them.",
    model: "inherit",
    disallowedTools: [...WORKER_DENIED_BUILT_INS, ...ours],
  };
}

const CLAUDE_EFFORTS: ReadonlySet<string> = new Set(Object.values(EFFORT));

/** Whether a model line's effort is one the CLI takes. */
function isClaudeEffort(effort: string): effort is Effort {
  return CLAUDE_EFFORTS.has(effort);
}

/** What the last Stop hook reported still in flight. */
type InFlight = Omit<RunnerWaiting, "type">;

/** What a launch reads from its process: its stdin as lines, and its environment. */
export interface RunnerInput {
  readonly lines: Stream.Stream<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(RunnerConfigSchema));
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));

/** Where a launch resumes the CLI's session: the session, and the chain entry it is cut after, where a rewind cut it; none for a fresh session. */
interface ResumePoint {
  readonly resume?: string;
  readonly at?: string;
}

/** How long a launch waits on its session's chain before it gives the read up. */
const CHAIN_READ = Duration.seconds(60);

/** What a launch whose session's chain the service's store did not answer ends with. */
const CHAIN_UNREAD = "the session to cut could not be read from the service";

/**
 * Where the launch resumes: the config's session as it stands, or, where a
 * rewind or a fork at a message dropped one of its prompts, cut at the entry
 * just before that prompt, and a fresh session where the prompt was its
 * first. A session holding no such prompt is resumed whole, as a cut the CLI
 * never heard of leaves nothing of its own to cut, and so is one on the disk
 * that cannot be read. Note that one the store does not answer within
 * `CHAIN_READ` fails the launch instead, because the CLI resumes from the
 * store alone, which would hand it the session whole, past the cut.
 */
const resumePointOf = Effect.fn("agent-runner/resumePointOf")(function* (
  claudeCode: ClaudeCodeService,
  config: ClaudeCodeConfig,
  store: SessionStore | undefined,
) {
  const { resume, rewindBefore } = config;

  if (resume === undefined) return {} satisfies ResumePoint;

  if (rewindBefore === undefined) return { resume } satisfies ResumePoint;

  const read = Effect.tryPromise(() => claudeCode.sessionChain(resume, config.cwd, store)).pipe(
    Effect.timeout(CHAIN_READ),
  );

  const unread: readonly string[] = [];

  const chain =
    store === undefined
      ? yield* read.pipe(
          Effect.catch(() =>
            Effect.as(
              Effect.logWarning("agent-runner: the session to rewind could not be read"),
              unread,
            ),
          ),
        )
      : yield* read.pipe(Effect.mapError(() => CHAIN_UNREAD));

  const cut = chain.indexOf(rewindBefore);

  if (cut === 0) return {} satisfies ResumePoint;
  const at = cut > 0 ? chain[cut - 1] : undefined;

  return at === undefined ? ({ resume } satisfies ResumePoint) : { resume, at };
});

/** The options that say how the CLI answers its tool calls. */
type Permissions = Pick<
  Options,
  "permissionMode" | "allowDangerouslySkipPermissions" | "allowedTools" | "canUseTool"
>;

const readPrefix = Schema.decodeUnknownOption(CommandPrefixSchema);

/** Each always-allowed command as the CLI's Bash rule for it; one that is no plain prefix, which could widen the rule, is passed over. */
function allowedCommandRules(allowedCommands: readonly (readonly string[])[]): string[] {
  return allowedCommands.flatMap((prefix) =>
    Option.isSome(readPrefix(prefix)) ? [`${BASH_TOOL}(${prefix.join(" ")} *)`] : [],
  );
}

/**
 * How the CLI answers its tool calls in the launch's mode. Under full access
 * every call runs, as every launch ran before modes, and no callback is
 * handed, since `bypassPermissions` would never call it. A mode that asks
 * runs the reads and every MCP server the launch hands the CLI unasked
 * (`CLAUDE_CODE_UNASKED_TOOLS`), and every command its starter always
 * allows, as a Bash rule for this launch alone (`Bash(pnpm test *)`, which
 * matches the bare command too), so the CLI's own reading of a compound
 * command decides each part and nothing is written to a settings file; it
 * asks the member the rest through `canUseTool`, which `auto` calls only
 * where its classifier cannot decide.
 */
function permissionsOf(
  mode: PermissionMode,
  servers: Readonly<Record<string, McpSdkServerConfigWithInstance>>,
  approvals: Approvals,
  allowedCommands: readonly (readonly string[])[],
): Permissions {
  if (mode === PERMISSION_MODE.FULL_ACCESS) {
    return {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: [...CLAUDE_CODE_TOOLS.ADDED],
    };
  }

  return {
    permissionMode: mode === PERMISSION_MODE.AUTO ? "auto" : "default",
    allowedTools: [
      ...CLAUDE_CODE_TOOLS.ADDED,
      ...CLAUDE_CODE_UNASKED_TOOLS,
      ...Object.keys(servers).map((server) => `mcp__${server}`),
      ...allowedCommandRules(allowedCommands),
    ],
    canUseTool: canUseToolOf(approvals),
  };
}

/**
 * The documented options a launch runs `query()` with (the plan's P05), the
 * same wherever the runner runs: no command sandbox of the CLI's own, since
 * the machine is the boundary, a host's box or the cloud's sandbox, whose
 * firewall holds every credential and leaves only placeholders inside.
 * Note that nothing may follow the place, because the CLI decides its
 * permission mode from more than `permissionMode`: 2.1.304 forces `default`
 * under `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, which a host launch once set and
 * which left every write, `gh`, and MCP tool waiting on an approval nobody gives.
 */
function queryOptions(
  config: ClaudeCodeConfig,
  env: RunnerInput["env"],
  servers: Readonly<Record<string, McpSdkServerConfigWithInstance>>,
  onStop: HookCallback,
  memoryWatch: ClaudeCodeMemoryWatch,
  from: ResumePoint,
  store: SessionStore | undefined,
  approvals: Approvals,
): Options {
  const mode = config.permissionMode ?? PERMISSION_MODE.FULL_ACCESS;

  const options: Options = {
    cwd: config.cwd,
    pathToClaudeCodeExecutable: config.executable,
    model: config.model,
    systemPrompt: { type: "preset", preset: "claude_code", append: config.append },
    settingSources: ["project"],
    ...permissionsOf(mode, servers, approvals, config.allowedCommands ?? []),
    includePartialMessages: true,
    disallowedTools: [...CLAUDE_CODE_TOOLS.DENIED],
    agents: { [CLAUDE_CODE_WORKER]: workerOf(config) },
    // The CLI's environment is the runner's own and, in the cloud's sandbox, the image's tools'
    // (`toolEnvOf`), less the bearer, which only the runner uses; Node
    // leaves an undefined one unset. Every command the agent runs inherits it,
    // the CLI's credential among it, which in the cloud's sandbox is a placeholder; on a host the CLI
    // is handed none and runs on the machine's own login (`harnessEnvOf`).
    // The first turn waits on no server of the checkout's own (`.mcp.json`), which keeps connecting in the
    // background (`CLAUDE_CODE_MCP_STARTUP_WAIT_MS`). Note that ours and each integration's are SDK servers,
    // which the CLI waits on whatever the wait is set to (https://code.claude.com/docs/en/agent-sdk/mcp#connection-timing).
    env: {
      ...env,
      ...toolEnvOf(env),
      [RUNNER_ENV.BEARER]: undefined,
      [CLAUDE_CODE_MCP_STARTUP_WAIT]: "0",
      // Note that the main conversation alone keeps its cache for an hour, and only where the config asks for it,
      // whatever the runner's own environment holds, so the other half keeps the CLI's default.
      [PROMPT_CACHE_TTL.MAIN]: config.promptCacheHour === true ? "1h" : undefined,
      [PROMPT_CACHE_TTL.ALL]: undefined,
      ...(config.promptCacheHour === true
        ? { [PROMPT_CACHE_TTL.FORCE_SHORT]: undefined }
        : undefined),
    },
    // Note that the SDK puts an HTTP server's config, headers and all, in the
    // CLI's argv, which any process in the sandbox can read, so ours is an
    // SDK server the runner relays over the CLI's own stdio (`mcp-relay.ts`), as is each integration's.
    mcpServers: { ...servers },
    sandbox: { enabled: false },
    hooks: { Stop: [{ hooks: [onStop] }], ...memoryWatch.hooks },
  };

  if (config.effort !== undefined) options.effort = config.effort;

  // Note that the CLI's own file memory is off, because the workspace's memory keeps what an agent
  // learns, and a cloud sandbox made again from the image keeps nothing of its home folder; and that
  // a headless CLI runs fast mode only where its flag settings opt in.
  options.settings = {
    autoMemoryEnabled: false,
    ...(config.fast === true ? { fastMode: true } : undefined),
  };

  if (from.resume !== undefined) options.resume = from.resume;

  if (from.at !== undefined) options.resumeSessionAt = from.at;

  if (config.fork === true) options.forkSession = true;

  // The SDK mirrors the transcript to the service as the CLI writes it, and loads it from there to resume.
  if (store !== undefined) options.sessionStore = store;
  // The member's installed skills load as a local plugin, which leaves the checkout and the
  // settings Claude Code reads (`project` alone) as they stand; we hold its MCP servers.
  const manifest = installedSkillsPath(config.installedSkills, INSTALLED_SKILLS.MANIFEST);

  if (manifest !== undefined && config.installedSkills !== undefined) {
    options.plugins = [{ type: "local", path: config.installedSkills, skipMcpDiscovery: true }];
  }

  return options;
}

/** A message line as the SDK takes it: from the human, and queued behind the running turn where one runs. */
function userMessage(
  uuid: UUID,
  content: Extract<InputLine, { type: "message" }>["content"],
  turnRunning: boolean,
): SDKUserMessage {
  const message: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: [...content] },
    parent_tool_use_id: null,
    origin: { kind: "human" },
    uuid,
    // Note that the CLI keeps its own session id, so a prompt names none.
    session_id: "",
  };

  if (turnRunning) message.priority = "next";

  return message;
}

/** The launch's state, shared by its two loops. */
interface Launch {
  readonly session: ClaudeCodeSession;
  /** A command's answer as posted, with the line saying it was killed out of memory where it was (`out-of-memory.ts`). */
  readonly annotate: (message: SDKMessage) => SDKMessage;
  readonly prompts: Queue.Queue<SDKUserMessage, Cause.Done>;
  readonly sink: EventSink;
  /** The tool calls held for the member's answer, in a launch whose mode asks. */
  readonly approvals: Approvals;
  readonly trace: LaunchTrace;
  readonly inFlight: MutableRef.MutableRef<InFlight | undefined>;
  /** Whether the CLI is in a turn: from a message the service sent, or from the CLI's own output, a wakeup's turn included. */
  readonly turnRunning: Ref.Ref<boolean>;
  /** The messages the service sent that no `result` has answered yet, by their uuid. */
  readonly unanswered: Ref.Ref<ReadonlySet<string>>;
  /** How many messages of turn output the CLI has put out, so a held message's bound sees whether the CLI has said anything since. */
  readonly heard: Ref.Ref<number>;
  readonly stopping: Ref.Ref<boolean>;
  /** How many IDLEs the launch has posted, so a warm launch's cap is dropped once a newer one began. */
  readonly waits: Ref.Ref<number>;
  /** Whether the config asked the launch to stay warm once the agent's turn is over. */
  readonly warmable: boolean;
  /** How long the launch stays warm before it ends itself (`RUNNER_WARM`). */
  readonly warmFor: Duration.Duration;
  /** Whether the launch is warm: started warm, or its turn over at an IDLE, and nothing taken or begun since. */
  readonly warm: Ref.Ref<boolean>;
  /** Held while a message is taken into the launch and while a turn's end is decided, so no message lands in a launch that end ends. */
  readonly admission: Semaphore.Semaphore;
  readonly ended: Deferred.Deferred<RunnerEnd>;
  /** Why the launch failed, where it did, for its END to say: the CLI's error, or the runner's own reason for ending it. */
  readonly failure: Ref.Ref<string>;
  /** The launch's first event number, which a turn-scoped stop names. */
  readonly firstSequence: number;
  /** The checkout recorded before a turn the line named opens (`checkout-snapshot.ts`); none where it could not be. */
  readonly snapshot: (lineId: string) => Effect.Effect<CheckoutSnapshot | undefined>;
  /** The API's host, as the CLI reaches it, which a lost connection is probed for. */
  readonly providerHost: string;
  /** Where that host is probed: the proxy the CLI goes through, or the host itself. */
  readonly probeTarget: ProbeTarget;
  /** The wait for the API's host to answer again, while one stands; the messages the service sent meanwhile wait with it. */
  readonly reconnecting: Ref.Ref<Reconnecting | undefined>;
  /** How much turn output the CLI had put out when the last carry-on was asked for, so a connection lost before any more fails the launch rather than probing again. */
  readonly carriedOnAt: Ref.Ref<number | undefined>;
}

/** A wait for the API's host, and the service's messages held until it answers, in order. */
interface Reconnecting {
  readonly probe: Fiber.Fiber<void>;
  readonly held: { readonly uuid: UUID; readonly prompt: UUID; readonly content: MessageContent }[];
}

type MessageContent = Extract<InputLine, { type: "message" }>["content"];

/**
 * Calls one of the session's control requests, reporting a failure rather
 * than ending the launch on it; answers whether the CLI answered within
 * `RUNNER_CONTROL.ANSWER_MS`. Note that one it never answers is let go, so
 * it holds up none of the service's later lines.
 */
function control<Answer>(step: string, call: () => Promise<Answer>) {
  return Effect.tryPromise(call).pipe(
    Effect.timeoutOption(Duration.millis(RUNNER_CONTROL.ANSWER_MS)),
    Effect.flatMap((answer) =>
      Option.isSome(answer)
        ? Effect.succeed(true)
        : Effect.as(Effect.logWarning(`agent-runner: ${step} went unanswered`), false),
    ),
    Effect.catch(() => Effect.as(Effect.logWarning(`agent-runner: ${step} failed`), true)),
  );
}

/** Hands one of the service's messages to the CLI, marking the launch in a turn. Called under the admission. */
const handToCli = Effect.fn("agent-runner/handToCli")(function* (
  launch: Launch,
  uuid: UUID,
  prompt: UUID,
  content: MessageContent,
) {
  const running = yield* Ref.getAndSet(launch.turnRunning, true);
  yield* Ref.set(launch.warm, false);
  // The checkout is recorded before the CLI can touch it; a line a running turn takes in opens no turn to rewind to.
  const snapshot = running ? undefined : yield* launch.snapshot(uuid);
  yield* Ref.update(launch.unanswered, (sent) => new Set(sent).add(prompt));
  // Posted ahead of the hand-off, so it is numbered before anything the CLI says of the message.
  yield* launch.sink.emit({
    type: RUNNER_EVENT.ACCEPTED,
    uuid,
    ...(snapshot === undefined ? undefined : { snapshot }),
  });
  yield* Queue.offer(launch.prompts, userMessage(prompt, content, running));
});

/** One of the service's lines, acted on at once. */
const takeLine = Effect.fn("agent-runner/takeLine")(function* (launch: Launch, text: string) {
  const line = decodeLine(text);

  if (Option.isNone(line)) {
    // Note that we never echo the line, because a message carries the user's words.
    return yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");
  }

  const value = line.value;

  switch (value.type) {
    case INPUT_LINE.MESSAGE: {
      const content = value.content;
      // SAFETY: a line's uuid is checked against the UUID pattern as the line is read.
      const uuid = (value.uuid as UUID | undefined) ?? randomUUID();
      // A message resent to a session that holds it goes to the CLI under a uuid of its own, which the CLI would drop.
      const prompt = value.resent === true ? randomUUID() : uuid;

      return yield* launch.admission.withPermit(
        Effect.gen(function* () {
          yield* launch.trace.taken;
          // A message sent while a call waits on the member's answer denies the call with its words.
          yield* denyForMessage(launch.approvals, content);
          // A message sent while the API's host is probed waits for it, and goes next once it answers.
          const reconnecting = yield* Ref.get(launch.reconnecting);

          if (reconnecting !== undefined) {
            reconnecting.held.push({ uuid, prompt, content });

            return;
          }

          yield* handToCli(launch, uuid, prompt, content);
        }),
      );
    }

    case INPUT_LINE.STOP: {
      // A stop for another launch's turn is not this launch's to take.
      if (value.launch !== undefined && value.launch !== launch.firstSequence) {
        return yield* Effect.logWarning("agent-runner: skipped a stop for another launch");
      }

      // A stop with no turn running has nothing to interrupt: the launch,
      // waiting or idle, ends here; so does one waiting on the API's host,
      // whose CLI is between turns.
      const reconnecting = yield* Ref.get(launch.reconnecting);

      if (reconnecting !== undefined) {
        yield* Fiber.interrupt(reconnecting.probe);
        yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);

        return;
      }

      if (!(yield* Ref.get(launch.turnRunning))) {
        yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);

        return;
      }

      yield* Ref.set(launch.stopping, true);

      // An interrupt the CLI never answers ends the launch, whose end closes the CLI.
      if (!(yield* control("interrupt", () => launch.session.interrupt()))) {
        yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
      }

      return;
    }

    case INPUT_LINE.RETIRE: {
      // Decided under the admission, so a message taken ahead of the line keeps the launch.
      return yield* launch.admission.withPermit(
        Effect.gen(function* () {
          if (!(yield* stillWarm(launch))) {
            return yield* Effect.logWarning("agent-runner: skipped a retire for a launch at work");
          }

          yield* Deferred.succeed(launch.ended, RUNNER_END.IDLED);
        }),
      );
    }

    case INPUT_LINE.WARM:
      return yield* rearmed(launch);
    case INPUT_LINE.MODEL: {
      const { model, effort, fast } = value;

      if (model !== undefined) yield* control("setModel", () => launch.session.setModel(model));

      if (effort !== undefined && !isClaudeEffort(effort)) {
        yield* Effect.logWarning("agent-runner: skipped an effort Claude Code does not take");
      }

      const settings = {
        ...(effort !== undefined && isClaudeEffort(effort) ? { effortLevel: effort } : undefined),
        ...(fast === undefined ? undefined : { fastMode: fast }),
      };

      if (Object.keys(settings).length > 0) {
        yield* control("applyFlagSettings", () => launch.session.applyFlagSettings(settings));
      }

      return;
    }

    case INPUT_LINE.APPROVAL: {
      const { requestId, decision, message } = value;
      const by = APPROVAL_BY.MEMBER;

      if (!(yield* settleAsk(launch.approvals, requestId, decision, by, message))) {
        yield* Effect.logWarning("agent-runner: skipped an approval for no waiting call");
      }

      return;
    }
  }
});

/** The SDK message types the runner acts on, as the SDK spells them. */
const SDK_MESSAGE = {
  ASSISTANT: "assistant",
  STREAM_EVENT: "stream_event",
  USER: "user",
  RESULT: "result",
} as const satisfies Record<string, SDKMessage["type"]>;

/** The message types that say the CLI is in a turn, whoever started it. */
const TURN_OUTPUT: ReadonlySet<SDKMessage["type"]> = new Set([
  SDK_MESSAGE.ASSISTANT,
  SDK_MESSAGE.STREAM_EVENT,
  SDK_MESSAGE.USER,
]);

type SdkResult = Extract<SDKMessage, { type: typeof SDK_MESSAGE.RESULT }>;

/** The prompts a `result` names as its turn's, folded ones included; none where it names none. */
function promptsOf(result: SdkResult): readonly string[] | undefined {
  return (
    result.user_message_uuids ??
    (result.user_message_uuid === undefined ? undefined : [result.user_message_uuid])
  );
}

/**
 * The messages the service sent that a `result` leaves unanswered: all but those it
 * names, since a result names every prompt its turn consumed, folded ones
 * included, and the CLI runs a message left as its next turn. Note that we
 * take a result naming no prompt as answering nothing, because the CLI runs
 * turns of its own, such as a wakeup's or the one it puts out after reopening
 * a session a Stop cut off mid-command, and taking those as answers dropped
 * the user's next message unanswered (`watchUnheard` bounds the wait).
 */
function stillUnanswered(sent: ReadonlySet<string>, result: SdkResult): ReadonlySet<string> {
  const left = new Set(sent);

  for (const uuid of promptsOf(result) ?? []) left.delete(uuid);

  return left;
}

/** One SDK message, posted, and whether it ends the launch. */
const takeMessage = Effect.fn("agent-runner/takeMessage")(function* (
  launch: Launch,
  message: SDKMessage,
) {
  // Marked before the message is posted, which may yield, and under the admission a warm
  // launch's end takes, so a launch is not ended as idle once the CLI has begun a turn of its own.
  if (TURN_OUTPUT.has(message.type)) {
    yield* launch.admission.withPermit(
      Ref.set(launch.turnRunning, true).pipe(
        Effect.andThen(Ref.set(launch.warm, false)),
        Effect.andThen(Ref.update(launch.heard, (count) => count + 1)),
      ),
    );
  }

  yield* launch.sink.emit(launch.annotate(message));

  if (message.type !== SDK_MESSAGE.RESULT) return;
  const inFlight = MutableRef.getAndSet(launch.inFlight, undefined);

  if (yield* Ref.get(launch.stopping)) {
    return yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
  }

  // A message the service sent that the turn did not take runs as the CLI's next
  // turn, so the launch goes on until it is answered; bounded where the
  // `result` took none, since nothing then says the CLI will take it up.
  const left = stillUnanswered(yield* Ref.get(launch.unanswered), message);
  yield* Ref.set(launch.unanswered, left);

  // A turn the CLI gave up on for want of the API's host is carried on once the host answers, not ended.
  if (message.subtype === "success" && message.is_error && claudeCodeConnectionLost(message)) {
    return yield* connectionLost(launch);
  }

  if (left.size > 0) {
    if (promptsOf(message) === undefined) {
      yield* Effect.forkScoped(watchUnheard(launch, left, yield* Ref.get(launch.heard)));
    }

    return;
  }

  const waiting =
    inFlight !== undefined &&
    (inFlight.background_tasks.length > 0 || inFlight.session_crons.length > 0);

  // A `result` no Stop hook came before, such as an error's, ends the launch rather than trusting its CLI warm.
  if (inFlight === undefined) return yield* Deferred.succeed(launch.ended, RUNNER_END.TURN_ENDED);

  if (!waiting) {
    return launch.warmable
      ? yield* warmed(launch)
      : yield* Deferred.succeed(launch.ended, RUNNER_END.TURN_ENDED);
  }

  yield* Ref.set(launch.turnRunning, false);
  yield* launch.sink.emit({ type: RUNNER_EVENT.WAITING, ...inFlight });
});

/**
 * The CLI could not reach the API: the launch posts CONNECTION_LOST and
 * probes the API's host, unless the connection was lost again before the CLI
 * put out any turn output since the last carry-on, when the launch ends
 * failed rather than loop. Note that the turn stays marked running, because
 * the agent's turn is: its model turn ended, its work has not.
 */
const connectionLost = Effect.fn("agent-runner/connectionLost")(function* (launch: Launch) {
  const heard = yield* Ref.get(launch.heard);

  if ((yield* Ref.get(launch.carriedOnAt)) === heard) {
    yield* Effect.logWarning(
      "agent-runner: the connection was lost again before the model answered",
    );

    return yield* endFailed(
      launch,
      connectionLostFailure(launch.providerHost, CONNECTION_LOST_DETAIL.LOST_AGAIN),
    );
  }

  yield* Effect.logWarning(`agent-runner: lost the connection to ${launch.providerHost}`);
  // Under the admission, so no message is handed to the CLI between the loss and the hold,
  // and the probe, which decides under it too, finds the wait standing.
  yield* launch.admission.withPermit(
    Effect.gen(function* () {
      yield* launch.sink.emit({ type: RUNNER_EVENT.CONNECTION_LOST, host: launch.providerHost });
      const held: Reconnecting["held"] = [];

      const probe = yield* Effect.forkScoped(
        Effect.flatMap(awaitProvider(launch.probeTarget), (answered) =>
          connectionProbed(launch, answered),
        ),
      );

      yield* Ref.set(launch.reconnecting, { probe, held });
    }),
  );
});

/**
 * The probe settled: the host answered, so the messages held meanwhile go to
 * the CLI, or, with none held, CONNECTION_RESTORED asks the service for a
 * carry-on line; or the bound passed, and the launch ends failed with why.
 * Decided under the admission, so no message lands between the decision and
 * what it does.
 */
const connectionProbed = Effect.fn("agent-runner/connectionProbed")(function* (
  launch: Launch,
  answered: boolean,
) {
  yield* launch.admission.withPermit(
    Effect.gen(function* () {
      const reconnecting = yield* Ref.getAndSet(launch.reconnecting, undefined);

      if (reconnecting === undefined || (yield* Deferred.isDone(launch.ended))) return;

      if (!answered) {
        yield* Effect.logWarning(
          `agent-runner: ${launch.providerHost} did not answer within the wait`,
        );

        return yield* endFailed(
          launch,
          connectionLostFailure(launch.providerHost, CONNECTION_LOST_DETAIL.GAVE_UP),
        );
      }

      yield* Ref.set(launch.carriedOnAt, yield* Ref.get(launch.heard));

      for (const { uuid, prompt, content } of reconnecting.held) {
        yield* handToCli(launch, uuid, prompt, content);
      }

      yield* launch.sink.emit({
        type: RUNNER_EVENT.CONNECTION_RESTORED,
        host: launch.providerHost,
        carryOn: reconnecting.held.length === 0,
      });
    }),
  );
});

/** Whether the launch is still warm, with nothing taken, begun, stopped, or ended since its IDLE. Read under the admission. */
const stillWarm = Effect.fn("agent-runner/stillWarm")(function* (launch: Launch) {
  return (
    (yield* Ref.get(launch.warm)) &&
    !(yield* Ref.get(launch.turnRunning)) &&
    (yield* Ref.get(launch.unanswered)).size === 0 &&
    !(yield* Ref.get(launch.stopping)) &&
    !(yield* Deferred.isDone(launch.ended))
  );
});

/**
 * The agent's turn over, and the launch kept warm rather than ended: its
 * IDLE posted, so the service settles the turn, and a watch armed that ends it
 * once its warm window passes (`RUNNER_WARM`) where nothing retired it first. Decided under the
 * admission, so a message taken since the `result` starts the CLI's next
 * turn instead, and posts no IDLE for a turn that is not over.
 */
const warmed = Effect.fn("agent-runner/warmed")(function* (launch: Launch) {
  const wait = yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(launch.unanswered)).size > 0) return undefined;
      yield* Ref.set(launch.turnRunning, false);
      yield* Ref.set(launch.warm, true);
      yield* launch.sink.emit({ type: RUNNER_EVENT.IDLE });

      // Counted, so the cap an earlier IDLE armed is dropped.
      return yield* Ref.updateAndGet(launch.waits, (count) => count + 1);
    }),
  );

  if (wait === undefined) return;
  yield* Effect.forkScoped(watchWarm(launch, wait));
});

/**
 * A warm launch idle from its start: warm before it takes a line, as one
 * the service launched with no message waits for its first, so a retire
 * ends it and its window bounds it, as an IDLE's watch does. Its first
 * message takes it out of warm as any message does. It posts no IDLE,
 * since no turn of it ended.
 */
const warmAtStart = Effect.fn("agent-runner/warmAtStart")(function* (launch: Launch) {
  if (!launch.warmable) return;

  const wait = yield* launch.admission.withPermit(
    Effect.andThen(
      Ref.set(launch.warm, true),
      Ref.updateAndGet(launch.waits, (count) => count + 1),
    ),
  );

  yield* Effect.forkScoped(watchWarm(launch, wait));
});

/** A warm launch's window armed again from now, on the service's `warm` line, where it is still warm; one at work skips it, since its next IDLE arms a window of its own. */
const rearmed = Effect.fn("agent-runner/rearmed")(function* (launch: Launch) {
  const wait = yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if (!(yield* stillWarm(launch))) return undefined;

      return yield* Ref.updateAndGet(launch.waits, (count) => count + 1);
    }),
  );

  if (wait === undefined) return;
  yield* Effect.forkScoped(watchWarm(launch, wait));
});

/** A warm launch's own bound: ended once it stayed warm for its window (`RUNNER_WARM`). */
const watchWarm = Effect.fn("agent-runner/watchWarm")(function* (launch: Launch, wait: number) {
  yield* Effect.sleep(launch.warmFor);
  yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(launch.waits)) !== wait || !(yield* stillWarm(launch))) return;
      yield* Deferred.succeed(launch.ended, RUNNER_END.IDLED);
    }),
  );
});

/** What a launch ended by `watchUnheard` says it failed of. */
const UNHEARD_FAILURE = "the CLI never took up a message a result left";

/** Ends the launch as `FAILED` with why, unless something ended it first. */
function endFailed(launch: Launch, failure: string) {
  return Effect.gen(function* () {
    if (yield* Deferred.isDone(launch.ended)) return;
    yield* Ref.set(launch.failure, failure);
    yield* Deferred.succeed(launch.ended, RUNNER_END.FAILED);
  });
}

/**
 * The bound on the messages a `result` naming no prompt left unanswered,
 * `heardAt` being the launch's turn output when it came: once
 * `RUNNER_UNANSWERED.SILENCE_MS` has passed with the CLI putting out no turn
 * output since and one of them still unanswered, the launch ends as
 * `FAILED`, so the turn shows as failed rather than answered and the next
 * message relaunches the CLI. Decided under the admission, as a turn's
 * output is marked.
 */
const watchUnheard = Effect.fn("agent-runner/watchUnheard")(function* (
  launch: Launch,
  held: ReadonlySet<string>,
  heardAt: number,
) {
  yield* Effect.sleep(Duration.millis(RUNNER_UNANSWERED.SILENCE_MS));
  yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(launch.heard)) !== heardAt) return;
      const unanswered = yield* Ref.get(launch.unanswered);

      if (![...held].some((uuid) => unanswered.has(uuid))) return;
      yield* Effect.logWarning(`agent-runner: ${UNHEARD_FAILURE}`);
      yield* endFailed(launch, UNHEARD_FAILURE);
    }),
  );
});

/**
 * One Claude Code launch, from its config to the moment its CLI is closed.
 * Answers why it ended, and the CLI's failure where it failed.
 */
const runClaudeCode = Effect.fn("agent-runner/runClaudeCode")(function* (
  context: LaunchContext<ClaudeCodeConfig>,
) {
  const claudeCode = yield* ClaudeCode;
  const snapshots = yield* CheckoutSnapshots;
  const { config, lines, sink, bearer, trace } = context;
  const inFlight = MutableRef.make<InFlight | undefined>(undefined);

  const onStop: HookCallback = async (hook) => {
    if (hook.hook_event_name === "Stop") {
      MutableRef.set(inFlight, {
        background_tasks: hook.background_tasks ?? [],
        session_crons: hook.session_crons ?? [],
      });
    }

    return { continue: true };
  };

  const servers = yield* trace.step(
    RUNNER_SPAN.MCP_RELAY,
    Effect.gen(function* () {
      const opened: Record<string, McpSdkServerConfigWithInstance> = {};
      opened[MCP_SERVER] = yield* openMcpRelay(MCP_SERVER, config.mcpUrl, bearer);

      // Each integration the agent is handed is a server of its own, its tools named `mcp__<connection>__<tool>`.
      for (const integration of config.integrations ?? []) {
        if (integration.name === MCP_SERVER) continue;
        opened[integration.name] = yield* openMcpRelay(integration.name, integration.url, bearer);
      }

      return opened;
    }),
  );

  const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();

  const store =
    config.transcriptsUrl === undefined
      ? undefined
      : transcriptStore(config.transcriptsUrl, bearer, trace.headers);

  const resumed = yield* resumePointOf(claudeCode, config, store).pipe(Effect.result);

  if (Result.isFailure(resumed)) {
    yield* Effect.logWarning(`agent-runner: ${resumed.failure}`);

    return { end: RUNNER_END.FAILED, failure: resumed.failure } satisfies LaunchOutcome;
  }

  const from = resumed.success;
  const approvals = yield* openApprovals(sink);
  // The CLI is spawned and initialized before the service's lines are taken, which wait in
  // their queue meanwhile, so its first message goes to a CLI ready for it.
  const memoryWatch = claudeCodeMemoryWatch();

  const options = queryOptions(
    config,
    context.env,
    servers,
    onStop,
    memoryWatch,
    from,
    store,
    approvals,
  );

  const started = yield* trace
    .step(
      RUNNER_SPAN.CLI,
      Effect.tryPromise({
        try: () => claudeCode.startup(options),
        catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      }),
    )
    .pipe(Effect.result);

  if (Result.isFailure(started)) {
    yield* Effect.logWarning(`agent-runner: the CLI could not start: ${started.failure}`);

    return { end: RUNNER_END.FAILED, failure: started.failure } satisfies LaunchOutcome;
  }

  const session = started.success.query(Stream.toAsyncIterable(Stream.fromQueue(prompts)));
  const provider = providerTargetOf(context.env[ANTHROPIC_BASE_URL] ?? ANTHROPIC_API_HOST);

  const launch: Launch = {
    session,
    annotate: memoryWatch.annotate,
    prompts,
    sink,
    approvals,
    trace,
    inFlight,
    turnRunning: yield* Ref.make(false),
    unanswered: yield* Ref.make<ReadonlySet<string>>(new Set()),
    heard: yield* Ref.make(0),
    stopping: yield* Ref.make(false),
    waits: yield* Ref.make(0),
    warmable: config.warm === true,
    warmFor: Duration.millis(config.warmForMs ?? RUNNER_WARM.IDLE_CAP_MS),
    warm: yield* Ref.make(false),
    admission: yield* Semaphore.make(1),
    ended: yield* Deferred.make<RunnerEnd>(),
    failure: yield* Ref.make(""),
    firstSequence: config.firstSequence,
    snapshot: (lineId) =>
      config.agentId === undefined
        ? Effect.succeed(undefined)
        : snapshots.take(config.cwd, config.agentId, lineId),
    providerHost: provider.host,
    probeTarget: probeTargetOf(context.env, provider),
    reconnecting: yield* Ref.make<Reconnecting | undefined>(undefined),
    carriedOnAt: yield* Ref.make<number | undefined>(undefined),
  };

  // Warm before the first line is taken, so a message ahead of a retire takes it out of warm.
  yield* warmAtStart(launch);

  // The service closing stdin ends the prompt stream, and the CLI ends once it has
  // answered what it was given.
  const inputLoop = Effect.gen(function* () {
    for (;;) yield* takeLine(launch, yield* Queue.take(lines));
  }).pipe(
    Effect.catchIf(Cause.isDone, () => Queue.end(prompts)),
    Effect.asVoid,
  );

  const outputLoop = Stream.fromAsyncIterable(session, (cause) => cause).pipe(
    Stream.runForEach((message) => takeMessage(launch, message)),
    Effect.matchEffect({
      onSuccess: () => Deferred.succeed(launch.ended, RUNNER_END.INPUT_CLOSED),
      onFailure: (cause) =>
        endFailed(launch, cause instanceof Error ? cause.message : String(cause)),
    }),
  );

  const reading = [
    yield* Effect.forkScoped(inputLoop),
    yield* context.cutOff.pipe(
      Effect.flatMap((why) => endFailed(launch, why)),
      Effect.forkScoped,
    ),
  ];

  const posting = yield* Effect.forkScoped(outputLoop);

  // The loops stop before the launch's last event is posted, so nothing the
  // CLI emits on the way down is numbered after it. Note that the service's lines
  // stop first, so none is taken into a CLI being closed, and the CLI is
  // closed before the output loop is waited on, because the SDK's iterator
  // answers its return only once the read under way does, which a quiet CLI
  // (a wait on a wakeup, a warm launch) answers only when it next writes:
  // waiting on it first held an ended launch, deaf to every line, for up to
  // the hour its wakeup was set for. A call still waiting on the member is denied before the CLI
  // is closed, so its ask is resolved ahead of the launch's last event.
  const end = yield* Deferred.await(launch.ended);
  yield* Fiber.interruptAll(reading);
  yield* denyWaiting(approvals, APPROVAL_BY.ENDED);
  session.close();
  yield* Fiber.interrupt(posting);
  const failure = yield* Ref.get(launch.failure);

  return { end, failure } satisfies LaunchOutcome;
});

/**
 * One launch, from its config line to its last event. Answers why it ended;
 * fails where it never started, or where the service would not take its events.
 */
export const runAgent = Effect.fn("agent-runner/runAgent")(function* (input: RunnerInput) {
  const bearerValue = input.env[RUNNER_ENV.BEARER];

  if (bearerValue === undefined || bearerValue === "") {
    return yield* new RunnerFailed({ detail: `${RUNNER_ENV.BEARER} is not set` });
  }

  const bearer = Redacted.make(bearerValue);

  const tokens = [RUNNER_ENV.CLAUDE_TOKEN, RUNNER_ENV.API_KEY, RUNNER_ENV.OPENAI_API_KEY].flatMap(
    (name) => {
      const value = input.env[name];

      return value === undefined || value === "" ? [] : [Redacted.make(value)];
    },
  );

  const secrets = [bearer, ...tokens];

  // Stdin is read in a loop of its own from the first line on, so nothing
  // the session does can hold up a line the service wrote. Its end ends the service's lines
  // only where the config names no read of them, since a launch that reads
  // them from the service goes on past it, and at once where it ended before the
  // config, which then never comes.
  const lines = yield* Queue.unbounded<string, Cause.Done>();
  const readsLines = yield* Deferred.make<boolean>();
  const read = yield* Ref.make(0);
  yield* input.lines.pipe(
    Stream.runForEach((text) =>
      Effect.andThen(
        Ref.update(read, (count) => count + 1),
        Queue.offer(lines, text),
      ),
    ),
    Effect.andThen(Ref.get(read)),
    Effect.flatMap((count) => (count === 0 ? Effect.succeed(false) : Deferred.await(readsLines))),
    Effect.flatMap((reads) => (reads ? Effect.void : Queue.end(lines))),
    Effect.forkScoped,
  );

  // Note that a config that never comes ends the launch, because a runner waiting on it reads
  // no line and posts no event, so nothing would ever tell the service it stands deaf.
  const first = yield* Queue.take(lines).pipe(
    Effect.mapError(() => new RunnerFailed({ detail: "stdin closed before the config line" })),
    Effect.timeoutOrElse({
      duration: Duration.millis(RUNNER_CONFIG.WAIT_MS),
      orElse: () =>
        Effect.fail(
          new RunnerUnconfigured({
            detail: `no config line came within ${Duration.format(Duration.millis(RUNNER_CONFIG.WAIT_MS))}`,
          }),
        ),
    }),
  );

  const config = yield* decodeConfig(first).pipe(
    Effect.mapError(() => new RunnerFailed({ detail: "the config line is not a runner config" })),
  );

  yield* Deferred.succeed(readsLines, config.linesUrl !== undefined);
  const trace = yield* launchTrace(config.trace, config.harness ?? RUNNER_HARNESS.CLAUDE_CODE);

  return yield* runLaunch({ config, lines, bearer, secrets, trace, input }).pipe(trace.traced);
});

/** What a launch runs on once its config is read. */
interface ReadLaunch {
  readonly config: RunnerConfig;
  readonly lines: Queue.Queue<string, Cause.Done>;
  readonly bearer: Redacted.Redacted;
  readonly secrets: readonly Redacted.Redacted[];
  readonly trace: LaunchTrace;
  readonly input: RunnerInput;
}

/**
 * A launch from its config on: its events' sink, the service's lines read
 * where the config names the read, its harness run, and its last event
 * posted. Answers why it ended; fails where the service would not take its events.
 */
const runLaunch = Effect.fn("agent-runner/runLaunch")(function* (read: ReadLaunch) {
  const { config, lines, bearer, secrets, trace, input } = read;

  const posted = yield* openEventSink({
    url: config.eventsUrl,
    bearer,
    firstSequence: config.firstSequence,
    secrets,
  });

  // Each message is watched for the startup's milestones as it is posted (`trace.ts`).
  const sink: EventSink = {
    ...posted,
    emit: (message) => Effect.andThen(trace.observe(message), posted.emit(message)),
  };

  // A config that names the read has the service's later lines read from it, beside any
  // stdin still carries, into the same queue, so neither harness knows where a line came from.
  // A read the service refused for good cuts the launch off, as a post it refused does.
  const refused = yield* Deferred.make<string>();

  if (config.linesUrl !== undefined) {
    const read = { url: config.linesUrl, bearer, launch: config.firstSequence };
    yield* readLines(read, lines).pipe(
      Effect.catch((unread) =>
        Deferred.succeed(refused, `the service refused the launch's lines: ${unread.detail}`),
      ),
      Effect.forkScoped,
    );
  }

  const cutOff = Effect.race(
    Effect.map(sink.undelivered, (undelivered) => undelivered.detail),
    Deferred.await(refused),
  );

  const context = { lines, env: harnessEnvOf(input.env), bearer, sink, cutOff, trace };

  const outcome: LaunchOutcome =
    config.harness === RUNNER_HARNESS.CODEX
      ? yield* runCodex({ ...context, config })
      : yield* runClaudeCode({ ...context, config });

  const { end, failure } = outcome;

  const last: RunnerEndEvent = {
    type: RUNNER_EVENT.END,
    reason: end,
    ...(failure === "" ? undefined : { detail: failure }),
  };

  yield* sink.emit(last);
  // A stopped launch is our own doing, so it does not wait out an outage for its last events.
  yield* end === RUNNER_END.STOPPED ? sink.drainStopped : sink.drain;

  return end;
});
