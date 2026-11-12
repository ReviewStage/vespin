import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { RUNNER_UNIT } from "@repo/agent-runner/pins";
import {
  APPROVAL_DECISION,
  type ClaudeCodeConfig,
  INPUT_LINE,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import {
  claimAgentRunnerLease,
  releaseAgentRunnerLease,
} from "@repo/database/models/agent-runner-lease";
import {
  readAgentRunnerRecord,
  writeAgentRunnerRecord,
} from "@repo/database/models/agent-runner-record";
import {
  type Agent,
  createAgent,
  latestTurnsOfReached,
  readAgentRouting,
  recordAgentNativeSession,
  runnerLaunchOf,
  updateAgentChoice,
  updateAgentPermissionModeCommitted,
} from "@repo/database/models/agent-store";
import { appendSessionEntries } from "@repo/database/models/claude-session-entries";
import { readNativeRewind, rewindConversation } from "@repo/database/models/conversation-rewind";
import { deviceAgentLinesWaiting } from "@repo/database/models/device-agent-store";
import { registerDevice } from "@repo/database/models/device-store";
import { installSkill } from "@repo/database/models/installed-skill-store";
import {
  parseKeyRing,
  sealProviderKey,
  sealWorkspaceVariable,
} from "@repo/database/models/provider-key-seal";
import {
  removeProviderKey,
  reorderSubscriptions,
  saveProviderKey,
  setPlanStatus,
} from "@repo/database/models/provider-key-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { runnerLinesPast } from "@repo/database/models/runner-line-store";
import { queuedTurnOf, recordTurnSnapshot } from "@repo/database/models/turn-state";
import { setWorkspaceVariable } from "@repo/database/models/workspace-environment-store";
import { setWorkspaceExperiment } from "@repo/database/models/workspace-experiment-store";
import { listScriptRuns } from "@repo/database/models/workspace-sandbox-script-run-store";
import {
  setInstallScript,
  setRepositorySetup,
} from "@repo/database/models/workspace-sandbox-script-store";
import { storeWriter } from "@repo/database/models/writer";
import { agentTable, type StoredStartedFrom } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { messages, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PERMISSION_MODE } from "@repo/features/agent-approval-wire";
import { AGENT_FAILURE, AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_CAPABILITY,
  deviceAgentLaunchSecretsSchema,
} from "@repo/features/device-agent-wire";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import { TURN_DEADLINE } from "@repo/features/turn-deadline";
import {
  CLOUD_SETUP_SCRIPT,
  REPOSITORY_SCRIPT_KIND,
} from "@repo/features/workspace-sandbox-setup-wire";
import { sessionKey } from "@repo/runtime/vocabulary";
import { SANDBOX_IDLE, type Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { fixtureToken, vercelSandboxOver } from "@repo/sandbox/vercel/testing";
import { EXPERIMENT } from "@repo/settings";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { temporaryDirectory } from "@repo/wire/testing";
import { eq, sql } from "drizzle-orm";
import {
  Clock,
  DateTime,
  Duration,
  Effect,
  ErrorReporter,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Predicate,
  Redacted,
  Result,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { USER_ROLE } from "../../admin/admin-access.js";
import {
  MESSAGE_AUTHOR,
  RUN_EVENT,
  RUN_TURN_ORIGIN,
  TURN_FAILURE,
  TURN_ORIGIN,
  TURN_STATUS,
  TURN_TRIGGER,
} from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { recordingProductAnalytics, SERVER_EVENT } from "../../events/server-events.js";
import { keptAfterResponse } from "../../http/after-response.js";
import { sentryReportingLayer } from "../../observability/sentry.js";
import {
  connectWorkspaceGitHub,
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
  type SentToGitHub,
} from "../../testing/github-app-fake.js";
import {
  type FakeSandbox,
  launchBearer,
  launchLines,
  launchRead,
  readClaudeCodeConfig,
  readInputLine,
  runnerSandboxApi,
  runnerTook,
} from "../../testing/runner-sandbox-fake.js";
import { recordingSentry, sentOfType } from "../../testing/sentry-transport.js";
import { AGENT_TAG, agentSandboxName, SANDBOX_NAME, SESSION_TAG } from "../agent-sandbox-open.js";
import { claimedDeviceAgentLine } from "../device-agent.js";
import { AgentMachine, type AgentMachineService } from "../machine/agent-machine.js";
import { agentMachinesLayer } from "../machine/agent-machines.js";
import { type SandboxRunner, sandboxMachineLayer } from "../machine/sandbox-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import {
  KEY_REFUSAL,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
} from "../sessions/agent-sessions.js";
import { WORKSPACE_DRIVE, workspaceDriveName } from "../workspace-drive.js";
import { runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { AgentImage } from "./agent-image.js";
import { turnPayerOf } from "./agent-runtime-choice.js";
import { CODER } from "./bounds.js";
import { claudeCodeSessions } from "./claude-code-sessions.js";
import { reconcileAgent } from "./reconcile.js";
import { RUNNER_ENDED, type RunnerSessionsOptions, runnerEnded } from "./runner-sessions.js";
import { RUNNER_ANSWER, RUNNER_CHOICE, TURN_HANDOVER } from "./runtime-sessions.js";
import { agentFailureOf } from "./status.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { TURN_DELIVERY } from "./turn-delivery-bounds.js";
import { recordNativeTurnHanded } from "./turn-message.js";

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * A coding agent's sessions on Claude Code, against a fake of Vercel
 * Sandbox's REST API that keeps every sandbox, command, stdin, and upload
 * it was asked for, over a real store: the image's runner started as the
 * SDK's own `agent` user with its secrets in its environment, the CLI's
 * credential a placeholder there that its firewall swaps, its config
 * and messages written to its stdin, a stop, a relaunch on the CLI's session
 * after the sandbox stopped, a launch's end stopping the sandbox unless a
 * Terminal holds it, and a reset deleting the sandbox and retiring the
 * runner's bearer. Synthetic accounts, tokens, and snapshot ids throughout.
 */

const IMAGE = "agent-image:fixture";

/** The runner's unit the deploy ships, which each launch installs whole in its sandbox. */
const RUNNER_FILES = [
  { name: RUNNER_UNIT.BUNDLE, contents: new TextEncoder().encode("// the deploy's runner") },
  { name: RUNNER_UNIT.PROFILER, contents: new TextEncoder().encode("the deploy's profiler") },
];

const EVENTS_URL = "https://app.test/api/agents/runner/events";
const LINES_URL = "https://app.test/api/agents/runner-lines";
const TRANSCRIPTS_URL = "https://app.test/api/agents/runner-transcripts";

/** The query every URL a runner is handed names its launch by, here the agent's first. */
const FIRST_LAUNCH = "?runnerLaunch=1";
const MCP_URL = "https://app.test/api/agents/mcp";

/** The host every address above names, which the firewall swaps the runner's bearer in on. */
const SERVICE_HOST = "app.test";

/** The one integration the agent is handed, a server of its own. */
const LINEAR_SERVER = { name: "linear", url: `${MCP_URL}/integrations/linear` };
const INSTRUCTIONS = "You are a Vespin coding agent.";
const PLAN_TOKEN = "sk-ant-oat01-fixture-plan-token";
const API_KEY = "sk-ant-api03-fixture-account-key";
const RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;
const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

const RELAY_INSTALLATION: InstallationFixture = {
  id: 7,
  login: RELAY.owner,
  repositories: [RELAY],
};

const CLI_SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Where the Agent SDK keeps the CLI's session in the store: the checkout's project, the main transcript. */
const CLI_TRANSCRIPT = { projectKey: "-workspace-repository", sessionId: CLI_SESSION };

/** The CLI session's root, its first entry, which every later one descends from. */
const CLI_ROOT = { type: "user", uuid: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e01", parentUuid: null };

const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** This test's own edge runner: each effect run as a root of its own, with none of its caller's context. */
const rootRunner: SandboxRunner = (effect) => Effect.runPromise(effect);

/** The agent's machine over the fake Vercel the client given answers as, its checkout run on the runner given, this test's own by default. */
function machineOver<E, R>(
  http: Layer.Layer<HttpClient.HttpClient | Sandbox, E, R>,
  run = rootRunner,
) {
  return sandboxMachineLayer({ run }).pipe(Layer.provide(http));
}

/** The script root readied the sandbox with before the runner started, as `sudo -n bash -c` ran it. */
function readyingScript(api: ReturnType<typeof runnerSandboxApi>): string {
  return api.runs.find((run) => run.args[0] === "-n" && run.args[2] === "-c")?.args[3] ?? "";
}

/** The agents' image as a deploy names it, the fixture's. */
const FIXTURE_IMAGE = Layer.succeed(AgentImage, {
  reference: Effect.succeed(IMAGE),
  runner: Effect.succeed(RUNNER_FILES),
});

/** Everything but the store, around the fake Vercel given. */
function services(
  api: ReturnType<typeof runnerSandboxApi>,
  http = api.layer,
  environment = NO_KEYS,
) {
  return Layer.mergeAll(
    http,
    machineOver(http),
    GITHUB_APP_WITH_TOKENS,
    Layer.succeed(HostedEnvironment, environment),
    FIXTURE_IMAGE,
  );
}

/** An account with one agent on a task with no repository, and no Claude plan. */
const openAgentWithoutPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Teammate invitations" });

  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  assert.ok(Option.isSome(started));

  return { userId, agent: started.value.agent };
});

/** The account's Claude plan: its setup-token, sealed as Settings saves it. */
const savePlan = (userId: string) =>
  Effect.gen(function* () {
    const ring = parseKeyRing(Redacted.make(RING));
    assert.ok(Result.isSuccess(ring));

    const owner = {
      userId,
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    };

    yield* saveProviderKey(
      userId,
      owner.provider,
      owner.kind,
      sealProviderKey(ring.success, owner, Redacted.make(PLAN_TOKEN)),
      "sk-ant-oat…oken",
      null,
      new Date(0),
    );
  });

/** An account with one agent on a task with no repository, on its Claude plan. */
const openAgent = Effect.tap(openAgentWithoutPlan, ({ userId }) => savePlan(userId));

/**
 * The agent just started, its id rewritten to begin with the hex digit
 * given, which puts it in the half of agents whose launches keep the prompt
 * cache for an hour (0 through 7) or in the other; no other row names its id yet.
 */
const agentIdFrom = (agent: Agent, digit: string) =>
  Effect.gen(function* () {
    const id = `${digit}${randomUUID().slice(1)}`;
    yield* Effect.flatMap(Database, (db) =>
      db.update(agentTable).set({ id }).where(eq(agentTable.id, agent.id)),
    );

    return { ...agent, id };
  });

/** The sessions for the account, the next event number read from the counter given. */
function sessionsFor(userId: string, sequence: { next: number }) {
  const options: RunnerSessionsOptions = {
    userId,
    eventsUrl: EVENTS_URL,
    linesUrl: LINES_URL,
    mcpUrl: MCP_URL,
    transcriptsUrl: TRANSCRIPTS_URL,
    integrations: () => Effect.succeed([LINEAR_SERVER]),
    instructions: () => Effect.succeed(INSTRUCTIONS),
    nextSequence: () => Effect.sync(() => sequence.next),
  };

  return claudeCodeSessions(options);
}

/** The first launch's runner as a row leaves it before the next message: as launched, or exited. */
const asLaunched = (_api: ReturnType<typeof runnerSandboxApi>, _userId: string, _session: string) =>
  Effect.void;

const runnerExited = (api: ReturnType<typeof runnerSandboxApi>) => {
  const first = api.commands[0];

  if (first !== undefined) first.exitCode = 0;
};

/** The first launch's runner exited and let go, as its end or the reap leaves it: its place's record tells of no runner up. */
const runnerLetGo = (api: ReturnType<typeof runnerSandboxApi>, userId: string, session: string) =>
  Effect.gen(function* () {
    runnerExited(api);
    const recorded = Option.getOrThrow(yield* readAgentRunnerRecord(userId, session));
    yield* writeAgentRunnerRecord(userId, session, {
      ...recorded,
      sandboxSessionId: null,
      commandId: null,
    });
  });

const message = (agent: Agent, text: string, lineId?: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
  ...(lineId === undefined ? undefined : { lineId }),
});

/** A message written as the line awaiting the turn its send queues or joins, as a Start's first line and a steer are (`start.ts`'s `openingLine`, `steer.ts`), and handed on under its line id. */
const writtenLine = (agent: Agent, text: string) =>
  Effect.gen(function* () {
    const clientKey = randomUUID();
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.writeAwaitingLine(
      { userId: agent.userId, conversationId: agent.conversationId },
      { text, clientKey, sender: { kind: MESSAGE_SENDER.APP } },
      Effect.succeed(true),
    );

    return message(agent, text, sentLineId(clientKey));
  });

/**
 * A Start's open of its agent's session on the message given, whose line its
 * Start wrote awaiting the turn it queues (`writtenLine`), and that turn
 * delivered where the open took it, as the agent-turns consumer hands it
 * over (`turn-delivery.ts`), which opens the place and launches the runner.
 */
const deliveredOpen = (
  sessions: Effect.Success<ReturnType<typeof sessionsFor>>,
  sent: Parameters<Effect.Success<ReturnType<typeof sessionsFor>>["open"]>[0],
) =>
  Effect.gen(function* () {
    const opened = yield* sessions.open(sent);

    if (opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED) {
      yield* sessions.deliverTurn(opened.sessionId, sent.conversationId);
    }

    return opened;
  });

/** A message written and sent, and where it was taken the turn it awaits delivered, as the agent-turns consumer hands it over (`turn-delivery.ts`). */
const sentAndDelivered = (
  sessions: Effect.Success<ReturnType<typeof sessionsFor>>,
  sessionId: string,
  agent: Agent,
  text: string,
) =>
  Effect.gen(function* () {
    const answer = yield* sessions.send(sessionId, yield* writtenLine(agent, text));

    if (answer.outcome === SESSION_SEND_OUTCOME.ACCEPTED) {
      yield* sessions.deliverTurn(sessionId, agent.conversationId);
    }

    return answer;
  });

/** The agent's queued turn delivered once more past a runner's grace to take its line, as the consumer delivers a turn it awaited (`TURN_HANDOVER.AWAITED`). */
const deliveredPastGrace = (
  sessions: Effect.Success<ReturnType<typeof sessionsFor>>,
  sessionId: string,
  agent: Agent,
) =>
  Effect.andThen(
    TestClock.adjust(TURN_DELIVERY.TAKE_GRACE),
    sessions.deliverTurn(sessionId, agent.conversationId),
  );

/** The CLI's session as the events route records it from the runner's init, the store holding it from its root as the Agent SDK mirrors it. */
const recordHeldSession = (
  userId: string,
  agent: { readonly id: string; readonly conversationId: string },
) =>
  Effect.gen(function* () {
    assert.equal(yield* recordAgentNativeSession(userId, agent.id, CLI_SESSION), true);
    yield* appendSessionEntries(userId, agent.conversationId, CLI_TRANSCRIPT, [CLI_ROOT]);
  });

/** The developer's words of a message line: what follows the turn's own words, which lead every message (`turn-message.ts`). */
const developerContent = (line: InputLine | undefined) =>
  line?.type === INPUT_LINE.MESSAGE ? line.content.slice(1) : [];

/** Each message line of the launch as its text blocks, the turn's own words first. */
const textsOf = (command: Parameters<typeof launchLines>[0]) =>
  Effect.map(launchRead(command, readClaudeCodeConfig), ({ lines }) =>
    lines.flatMap((each) =>
      each.type === INPUT_LINE.MESSAGE
        ? [each.content.map((block) => (block.type === "text" ? block.text : ""))]
        : [],
    ),
  );

/** What the launch reads past its config: its own lines, and the messages no earlier launch took, as its runner is handed them. */
const handedLines = (userId: string, command: Parameters<typeof launchLines>[0]) =>
  Effect.gen(function* () {
    const { config } = yield* launchRead(command, readClaudeCodeConfig);
    assert.ok(command?.agentId !== undefined);

    const read = yield* runnerLinesPast(userId, command.agentId, {
      launch: config.firstSequence,
      after: 0,
      limit: 50,
    });

    return read.map((line) => readInputLine(JSON.parse(line.text)));
  });

/** A turn of the agent's under way, as the events route queues and starts one, by the id a Stop names it by. */
const turnUnderWay = (userId: string, agent: Agent) =>
  Effect.gen(function* () {
    // The turn a line queued, as a Start's, is the one its runner starts; one is queued for it where none stands.
    const queued = yield* queuedTurnOf(agent.conversationId);
    const turnId = Option.getOrElse(queued, () => randomUUID());
    const target = { userId, conversationId: agent.conversationId };
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.enqueueTurn(target, { turnId, runtimeTurnId: turnId, origin: TURN_ORIGIN.TYPED });
    yield* writer.consume(target, {
      kind: RUN_EVENT.TURN_STARTED,
      conversationId: sessionKey(agent.conversationId),
      turnId,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: yield* Clock.currentTimeMillis,
    });

    return turnId;
  });

/** A point a fake call stops at until the test opens it: `arrived` settles once a call reached it. */
function gate() {
  let arrive = () => {};
  let open = () => {};

  const arrived = new Promise<void>((settle) => {
    arrive = settle;
  });

  const opened = new Promise<void>((settle) => {
    open = settle;
  });

  return {
    arrived,
    open,
    pass: async () => {
      arrive();
      await opened;
    },
  };
}

/**
 * The work run, the clock moved on by `step` a time at a time until the work
 * is done, at most `times` times, each after the event loop turned enough for
 * a wait the work armed to stand, and the work joined. Note that the clock
 * moves on until the work is done rather than a fixed count of times,
 * because a move made while the work is still reading the store, before it
 * armed its wait, moves nothing on.
 */
/** Real turns of the event loop enough for a forked fiber to reach whatever it waits on next. */
const turnsPass = Effect.promise(async () => {
  for (let turn = 0; turn < 50; turn += 1) {
    await new Promise<void>((settle) => setImmediate(settle));
  }
});

const across = <A, E>(work: Effect.Effect<A, E>, step: Duration.Duration, times: number) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(work);

    for (let move = 0; move < times; move += 1) {
      yield* turnsPass;
      yield* TestClock.adjust(step);
    }

    return yield* Fiber.join(fiber);
  });

/** Settles once the predicate holds, the event loop turning until it does. */
const until = (holds: () => boolean) =>
  Effect.promise(async () => {
    while (!holds()) await new Promise<void>((settle) => setImmediate(settle));
  });

/**
 * A clock over the test's own that counts the waits of `step` begun and ended
 * on it, for sessions built on it, and the work run to its end on it, the
 * clock moved on by `step` each time the work waits one out, as a retry spaced
 * by it does. Note that a move waits on such a wait standing rather than on a
 * fixed drain, because a slow store would spend a drained move the work never
 * waited on, and a wait begun after the last move would stand forever.
 */
const spacedClock = (step: Duration.Duration) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const waits = { begun: 0, ended: 0 };

    const watched: Clock.Clock = {
      currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
      currentTimeMillis: clock.currentTimeMillis,
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      currentTimeNanos: clock.currentTimeNanos,
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) =>
        Duration.equals(duration, step)
          ? Effect.suspend(() => {
              waits.begun += 1;

              return Effect.ensuring(
                clock.sleep(duration),
                Effect.sync(() => {
                  waits.ended += 1;
                }),
              );
            })
          : clock.sleep(duration),
    };

    const waitedOut = <A, E>(work: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(work);
        const done = () => fiber.pollUnsafe() !== undefined;

        for (;;) {
          yield* until(() => done() || waits.begun > waits.ended);

          if (done()) return yield* Fiber.join(fiber);
          const ended = waits.ended;
          yield* TestClock.adjust(step);
          yield* until(() => done() || waits.ended > ended);
        }
      });

    return { clock: watched, waitedOut };
  });

/** The agent's newest turn, as its status reads it, and the word its failure is read as. */
const newestTurn = (agent: Agent) =>
  Effect.map(latestTurnsOfReached([agent.conversationId]), (turns) => {
    const turn = turns.get(agent.conversationId);

    return { status: turn?.status, failure: agentFailureOf(turn) };
  });

/** Why the agent's newest turn failed, as its record keeps it. */
const newestFailureDetail = (agent: Agent) =>
  Effect.map(
    latestTurnsOfReached([agent.conversationId]),
    (turns) => turns.get(agent.conversationId)?.failureDetail,
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

/** What a repository agent's sessions are composed with beside the fake Vercel: what a test does as each request reaches GitHub. */
interface RepositoryAgentSeams {
  readonly onGitHub?: (sent: SentToGitHub) => void | Promise<void>;
  /** The edge runner the machine's checkout runs on, where not this test's own. */
  readonly run?: SandboxRunner;
}

/** An account on its Claude plan with one agent on a task of the Relay repository, and its sessions over the fake Vercel given. */
const repositoryAgent = (
  api: ReturnType<typeof runnerSandboxApi>,
  installation: InstallationFixture = RELAY_INSTALLATION,
  seams: RepositoryAgentSeams = {},
) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* Effect.flatMap(Database, (db) =>
      db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
    );
    yield* savePlan(userId);
    const task = yield* startTask(userId, { name: "Relay", repository: RELAY_FULL_NAME });
    yield* connectWorkspaceGitHub(task.workspaceId, installation);

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Relay\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const agent = Option.getOrThrow(started).agent;

    const github = githubReaching([installation], undefined, {}, async (sent) => {
      if (new URL(sent.url).hostname === "vercel.com") {
        return api.respond(sent.url, {
          method: sent.method,
          headers: sent.headers,
          body: sent.body,
          ...(sent.signal !== undefined && { signal: sent.signal }),
        });
      }

      await seams.onGitHub?.(sent);

      return undefined;
    });

    // The SDK's calls of Vercel reach the same fake as the client's, through its own `fetch`.
    const http = Layer.provideMerge(vercelSandboxOver(api.respond), github.layer);

    const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
      Effect.provide(
        Layer.mergeAll(
          http,
          machineOver(http, seams.run),
          Layer.succeed(HostedEnvironment, NO_KEYS),
          FIXTURE_IMAGE,
        ),
      ),
    );

    return { userId, agent, sessions };
  });

/** The contents access a repository token is cut to: a checkout's reads, the firewall's writes. */
const TOKEN_ACCESS = { READ: "read", WRITE: "write" } as const;

type TokenAccess = (typeof TOKEN_ACCESS)[keyof typeof TOKEN_ACCESS];

/** Whether a request to GitHub mints a repository token cut to the access given. */
const mintsRepositoryToken = (each: SentToGitHub, access: TokenAccess) => {
  if (!new URL(each.url).pathname.endsWith("/access_tokens")) return false;

  const asked: { repositories?: unknown; permissions?: { contents?: string } } = JSON.parse(
    each.body,
  );

  return asked.repositories !== undefined && asked.permissions?.contents === access;
};

/** A request a test waits to see reach GitHub: `seen` settles once one the predicate takes arrived. */
function sighting(wanted: (sent: SentToGitHub) => boolean) {
  let settle = () => {};

  const seen = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return {
    seen,
    observe: (sent: SentToGitHub) => {
      if (wanted(sent)) settle();
    },
  };
}

/** Another agent of the account's on the agent's own task, started on the branch given or the default one. */
const anotherAgent = (
  userId: string,
  agent: Agent,
  startBranch?: string,
  startedFrom?: StoredStartedFrom,
) =>
  Effect.gen(function* () {
    assert.ok(agent.taskId !== null);

    const started = yield* createAgent(userId, {
      taskId: agent.taskId,
      idempotencyKey: `start-${randomUUID()}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Relay\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
      ...(startBranch === undefined ? undefined : { startBranch }),
      ...(startedFrom === undefined ? undefined : { startedFrom }),
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    return Option.getOrThrow(started).agent;
  });

/**
 * An installation of its own reaching the Relay repository, since the tests
 * share one store, in which an installation stays linked to the first
 * workspace that connected it.
 */
function ownInstallation(): InstallationFixture {
  return { ...RELAY_INSTALLATION, id: 1_000 + Math.floor(Math.random() * 1_000_000) };
}

/** Whether a run in the sandbox was the clone, by the variable only the clone is handed. */
const isClone = (run: { readonly env: Readonly<Record<string, string>> }) =>
  Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.URL);

/** Whether a run in the sandbox claimed a workspace drive's folder as the checkout: handed a folder and the repository the checkout records. */
const isClaim = (run: { readonly env: Readonly<Record<string, string>> }) =>
  Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FOLDER) &&
  Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.REPOSITORY);

/** Whether a run in the sandbox linked a workspace drive's folder to a checkout cloned beside it: handed a folder alone. */
const isLink = (run: { readonly env: Readonly<Record<string, string>> }) =>
  Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FOLDER) &&
  !Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.REPOSITORY) &&
  !Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.URL);

/** How the claim exits where the fork holds no checkout in the repository's folder. */
const NOT_HELD_EXIT = 3;

/** The Relay repository's folder on its workspace's drive: `owner/name`, lower-cased. */
const RELAY_FOLDER = "acme/relay";

/** Whether a run in the sandbox was the install. */
const isInstall = (run: { readonly args: readonly string[] }) =>
  run.args.some((arg) => arg.includes("pnpm install"));

/** The agent's workspace's drive standing, as a fill that ended well leaves it, with no sandbox under its name. */
const filledWorkspaceDrive = (api: ReturnType<typeof runnerSandboxApi>, agent: Agent) => {
  const drive = {
    id: `drv_${randomUUID()}`,
    name: workspaceDriveName(agent.organizationId),
    deleted: false,
  };

  api.drives.push(drive);

  return drive;
};

/** The drive a sandbox mounts at the workspace, and the drive it was forked from, where it was. */
const mountedDrive = (api: ReturnType<typeof runnerSandboxApi>, sandbox: FakeSandbox | undefined) =>
  api.mountedAt(sandbox, WORKSPACE_DRIVE.MOUNT);

/** Whether a run in the sandbox made the agent's user, as `@vercel/sandbox` makes one. */
const isUserMade = (run: { readonly args: readonly string[] }) =>
  run.args.join(" ") === "-m -s /bin/bash agent";

/** The agent's own sandbox still standing, by the agent's tag. */
const sandboxOfAgent = (api: ReturnType<typeof runnerSandboxApi>, agent: Agent) =>
  api.sandboxes.find((each) => !each.deleted && each.tags[AGENT_TAG] === agent.id);

/** A host's rule in a policy the fake took, as far as a swap reads it. */
interface SentRule {
  readonly match?: {
    readonly headers?: readonly {
      readonly key: { readonly exact: string };
      readonly value: { readonly exact: string };
    }[];
  };
  readonly transform?: readonly { readonly headers: Readonly<Record<string, string>> }[];
}

/** The swaps on Anthropic's API in the last policy sent to the sandbox session given: the header each matches, the value it matches at, and what it sets there. */
const anthropicSwaps = (api: ReturnType<typeof runnerSandboxApi>, session: string | undefined) => {
  // SAFETY: the fake keeps each network policy as the service sent it, whose rules are listed by host under `allow`.
  const sent = api.policies.filter((each) => each.session === session).at(-1)?.policy as
    | { readonly allow?: Readonly<Record<string, readonly SentRule[]>> }
    | undefined;

  return (sent?.allow?.["api.anthropic.com"] ?? []).flatMap((rule) =>
    (rule.match?.headers ?? []).map(({ key, value }) => ({
      header: key.exact,
      at: value.exact,
      sets: rule.transform?.[0]?.headers[key.exact],
    })),
  );
};

it.layer(SUITE)("a coding agent's sessions on Claude Code", (it) => {
  it.effect(
    "open starts the image's runner as the agent's own user, its bearer and the plan's placeholder in its environment and the plan's token at its firewall, and writes its config and first message to its stdin",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const started = yield* openAgent;
        const { userId } = started;
        // An agent of the hour-long cache's half, which its plan leaves on the CLI's own default.
        const agent = yield* agentIdFrom(started.agent, "0");

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const line = yield* writtenLine(agent, "Fix the invitations.");
        const { lineId } = line;
        assert.ok(lineId !== undefined);

        const opened = yield* deliveredOpen(sessions, line);

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const [sandbox] = api.sandboxes;
        assert.ok(sandbox !== undefined);
        assert.equal(sandbox.image, IMAGE);
        assert.equal(sandbox.tags.sessionId, opened.sessionId);
        // The open claimed the conversation's record for the session it answered.
        assert.equal(
          yield* recordedRuntimeSession({ userId, conversationId: agent.conversationId }),
          opened.sessionId,
        );
        // The working folder an agent with no repository works in.
        assert.ok(
          api.runs.some((run) => run.args.join(" ").includes("mkdir -p /workspace/repository")),
        );

        // The sandbox made the agent's user as it opened, its home closed to every other user, and
        // root shared the checkout with it before the image's runner started as that user.
        assert.ok(api.runs.some((run) => run.args.join(" ") === "-m -s /bin/bash agent"));
        assert.ok(api.runs.some((run) => run.args.slice(-2).join(" ") === "700 /home/agent"));
        assert.ok(
          api.runs.some(
            (run) =>
              run.args[0] === "-n" && (run.args.at(-1) ?? "").includes("core.sharedRepository"),
          ),
        );
        // The launch uploaded the deploy's runner unit whole, and root installed every file of it
        // over the image's before the runner started, so no file of it is the disk's own.
        const uploaded = new Map(api.uploads.flatMap((upload) => [...upload]));

        const installed = readyingScript(api)
          .split("\n")
          .find((line) =>
            line.startsWith("install -o root -g root -m 0444 -t /opt/agent/agent-runner "),
          );

        for (const file of RUNNER_FILES) {
          const upload = `/tmp/agent-runner/${file.name}`;
          assert.equal(uploaded.get(upload), new TextDecoder().decode(file.contents));
          assert.ok(installed?.split(" ").includes(upload));
        }

        const [command] = api.commands;
        assert.ok(command !== undefined);
        assert.equal(command.user, "agent");
        assert.equal(command.command, "node");
        assert.deepEqual(command.args, ["/opt/agent/agent-runner/agent-runner.mjs"]);

        // The CLI reads a placeholder where the plan's token would stand, which the firewall swaps for the token on Anthropic's API.
        const placeholder = command.env[RUNNER_ENV.CLAUDE_TOKEN];
        assert.ok(
          placeholder !== undefined && placeholder.length > 20 && placeholder !== PLAN_TOKEN,
        );
        assert.deepEqual(anthropicSwaps(api, sandbox.currentSessionId), [
          { header: "authorization", at: `Bearer ${placeholder}`, sets: `Bearer ${PLAN_TOKEN}` },
        ]);
        // The runner holds a placeholder for its bearer too, which the firewall standing as it
        // started swaps on our host for the bearer whose digest the agent's row records.
        const bearerPlaceholder = command.env[RUNNER_ENV.BEARER];
        const bearer = launchBearer(api, command, SERVICE_HOST);
        assert.ok(bearerPlaceholder !== undefined && bearer !== undefined && bearer.length > 20);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
        // The fingerprint reads the token held at the firewall by its slot, never a placeholder, as warm runners
        // launched before were recorded: the first 32 hex characters of the SHA-256 of
        // {"env":[],"names":["linear"],"held":{"slot":"claude","credential":PLAN_TOKEN}}.
        const record = Option.getOrThrow(yield* readAgentRunnerRecord(userId, opened.sessionId));
        assert.equal(record.fingerprint, "780f5f77680c20a5ad5b4c255021deb7");

        const {
          config,
          lines: [first],
        } = yield* launchRead(command, readClaudeCodeConfig);

        assert.deepEqual(config, {
          harness: RUNNER_HARNESS.CLAUDE_CODE,
          cwd: "/workspace/repository",
          agentId: agent.id,
          executable:
            "/opt/agent/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
          model: "claude-opus-5-5",
          effort: "high",
          append: INSTRUCTIONS,
          firstSequence: 0,
          eventsUrl: `${EVENTS_URL}${FIRST_LAUNCH}`,
          linesUrl: `${LINES_URL}${FIRST_LAUNCH}`,
          mcpUrl: MCP_URL,
          // Every tool of ours that does more than read, which the worker is denied; it keeps the reads.
          workerDenied: [
            "post_thread",
            "withdraw_ask",
            "open_pull_request",
            "edit_description",
            "show_image",
            "show_page",
            "start_agent",
            "stop_agent",
            "message_agent",
            "update_agent",
            "create_task",
            "update_task",
            "create_section",
            "delete_section",
            "create_automation",
            "update_automation",
            "delete_automation",
            "run_automation",
            "save_memory",
            "forget_memory",
            "reply_to_comment",
            "update_comment",
            "run_on_mac",
            "browser",
            "list_ports",
            "share_port",
            "schedule_wakeup",
            "end_turn",
          ],
          transcriptsUrl: `${TRANSCRIPTS_URL}${FIRST_LAUNCH}`,
          integrations: [LINEAR_SERVER],
          allowedDomains: [],
          installedSkills: "/opt/agent/installed-skills",
          warm: true,
        });
        assert.ok(first?.type === INPUT_LINE.MESSAGE);
        assert.equal(first.uuid, lineId);
        assert.deepEqual(developerContent(first), [{ type: "text", text: "Fix the invitations." }]);

        // No secret in the runner's own argv, the config, a tag, or anything uploaded, and neither the plan's token nor the bearer in any command's environment.
        const visible = JSON.stringify([
          command.args,
          yield* launchLines(command),
          api.sandboxes,
          api.uploads.flatMap((upload) => [...upload.values()]),
        ]);

        for (const secret of [PLAN_TOKEN, placeholder, bearerPlaceholder, bearer]) {
          assert.equal(visible.includes(secret), false);
        }

        const environments = JSON.stringify(
          [api.commands, api.runs].flat().map((each) => each.env),
        );

        for (const secret of [PLAN_TOKEN, bearer])
          assert.equal(environments.includes(secret), false);
      }),
  );

  it.effect(
    "a launch whose agent is deleted while its sandbox opens, as a workspace's delete takes it, starts no runner and throws the sandbox away",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const db = yield* Database;
        const deleted = Effect.orDie(db.delete(agentTable).where(eq(agentTable.id, agent.id)));

        // The agent's row goes once its sandbox has opened, before the launch in it records its bearer.
        const deletedOnceOpened = Layer.effect(
          AgentMachine,
          Effect.gen(function* () {
            const machine = yield* AgentMachine;

            return {
              ...machine,
              open: (ask, use) =>
                machine.open(ask, (opened, beside) => Effect.andThen(deleted, use(opened, beside))),
            } satisfies AgentMachineService;
          }),
        ).pipe(Layer.provide(machineOver(api.layer)));

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(Layer.merge(services(api), deletedOnceOpened)),
        );

        yield* deliveredOpen(sessions, yield* writtenLine(agent, "Fix the invitations."));

        assert.equal(api.sandboxes.length, 1);
        assert.deepEqual(api.commands, []);
        assert.equal(api.sandboxes[0]?.deleted, true);
      }),
  );

  it.effect(
    "a launch on a checkout already shared with agent's group leaves its git config unwritten, so a config.lock an agent's git left behind never fails a relaunch",
    (t) =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        yield* deliveredOpen(sessions, yield* writtenLine(agent, "Fix the invitations."));

        // The launch's step that shares the checkout with the group, run by a real bash on a real checkout.
        const step = readyingScript(api)
          .split("\n")
          .find((each) => each.includes("core.sharedRepository"));

        assert.ok(step !== undefined);
        const checkout = yield* Effect.promise(() => temporaryDirectory(t, "launch-checkout-"));

        const launched = () =>
          spawnSync(
            "bash",
            ["-euo", "pipefail", "-c", step.replaceAll(CODER.CHECKOUT_PATH, checkout)],
            { encoding: "utf8" },
          );

        assert.equal(spawnSync("git", ["init", "--quiet", checkout]).status, 0);

        assert.equal(launched().status, 0);
        writeFileSync(join(checkout, ".git", "config.lock"), "");
        const relaunched = launched();

        assert.equal(relaunched.status, 0, relaunched.stderr);
        assert.equal(
          spawnSync("git", ["-C", checkout, "config", "--get", "core.sharedRepository"], {
            encoding: "utf8",
          }).stdout.trim(),
          "group",
        );
      }),
  );

  it.effect(
    "open writes the member's installed skills as whole folders outside the checkout, which root installs where the config names, and writes none where there are none",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        // An installed skill is handed only to a member with the Skills experiment on.
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.SKILLS]: true } });

        const skillFile =
          "---\nname: sentry-triage\ndescription: Triage a Sentry issue.\nallowed-tools: Bash\n---\nRun `scripts/triage.sh`.\n";

        yield* installSkill(userId, {
          owner: { scope: INSTALLED_SKILL_SCOPE.PERSONAL },
          name: "sentry-triage",
          description: "Triage a Sentry issue.",
          userInvocable: true,
          source: { type: INSTALLED_SKILL_SOURCE.TEXT },
          files: [
            { path: "SKILL.md", bytes: new TextEncoder().encode(skillFile) },
            { path: "scripts/triage.sh", bytes: new TextEncoder().encode("echo triage\n") },
          ],
        });
        // A file that names no skill and describes it in words its stored description has since replaced.
        yield* installSkill(userId, {
          owner: { scope: INSTALLED_SKILL_SCOPE.PERSONAL },
          name: "incident-notes",
          description: "Write incident notes.",
          userInvocable: false,
          source: { type: INSTALLED_SKILL_SOURCE.TEXT },
          files: [
            {
              path: "SKILL.md",
              bytes: new TextEncoder().encode(
                "---\ndescription: >\n  Older words\n  over two lines.\nuser-invocable: false\n---\nWrite them.\n",
              ),
            },
          ],
        });

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(sessions, yield* writtenLine(agent, "Triage it."));

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);

        const skills = api.uploads.find((upload) =>
          [...upload.keys()].some((path) => path.startsWith("/tmp/agent-installed-skills/")),
        );

        assert.ok(skills !== undefined);
        // A Claude Code local plugin named luke, each skill a whole folder.
        assert.deepEqual([...skills.keys()].sort(), [
          "/tmp/agent-installed-skills/.claude-plugin/plugin.json",
          "/tmp/agent-installed-skills/skills/incident-notes/SKILL.md",
          "/tmp/agent-installed-skills/skills/sentry-triage/SKILL.md",
          "/tmp/agent-installed-skills/skills/sentry-triage/scripts/triage.sh",
        ]);
        assert.equal(
          JSON.parse(skills.get("/tmp/agent-installed-skills/.claude-plugin/plugin.json") ?? "")
            .name,
          "workspace",
        );
        // Every other key and the body as installed, under the name and description we keep.
        assert.equal(
          skills.get("/tmp/agent-installed-skills/skills/sentry-triage/SKILL.md"),
          '---\nname: sentry-triage\ndescription: "Triage a Sentry issue."\nallowed-tools: Bash\n---\n\nRun `scripts/triage.sh`.\n',
        );
        assert.equal(
          skills.get("/tmp/agent-installed-skills/skills/incident-notes/SKILL.md"),
          '---\nname: incident-notes\ndescription: "Write incident notes."\nuser-invocable: false\n---\n\nWrite them.\n',
        );
        // Nothing lands in the checkout, so nothing can be committed.
        assert.ok(![...skills.keys()].some((path) => path.startsWith(CODER.CHECKOUT_PATH)));

        const [command] = api.commands;
        assert.ok(command !== undefined);
        assert.match(
          readyingScript(api),
          /mv \/tmp\/agent-installed-skills \/opt\/agent\/installed-skills && chown -R root:root \/opt\/agent\/installed-skills && chmod -R u=rwX,go=rX/u,
        );
        const { config } = yield* launchRead(command, readClaudeCodeConfig);
        assert.equal(config.installedSkills, "/opt/agent/installed-skills");

        // An account with no installed skills uploads none, and the launch installs nothing.
        const bare = runnerSandboxApi();
        const other = yield* openAgent;

        const otherSessions = yield* sessionsFor(other.userId, { next: 0 }).pipe(
          Effect.provide(services(bare)),
        );

        yield* deliveredOpen(otherSessions, yield* writtenLine(other.agent, "Triage it."));
        assert.ok(
          !bare.uploads.some((upload) =>
            [...upload.keys()].some((path) => path.startsWith("/tmp/agent-installed-skills/")),
          ),
        );
      }),
  );

  it.effect(
    "a setup-token Anthropic refused refuses the launch as one to reconnect, a limit refuses it with its reset until that passes, and neither starts a runner while refused",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;

        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        };

        const markPlan = (
          status: typeof PROVIDER_KEY_STATUS.LIMIT_REACHED | typeof PROVIDER_KEY_STATUS.INVALID,
          resetsAt?: Date,
        ) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            yield* setPlanStatus(userId, owner.provider, owner.kind, status, resetsAt, now, now);
          });

        const openOn = (api: ReturnType<typeof runnerSandboxApi>) =>
          Effect.gen(function* () {
            const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
              Effect.provide(services(api)),
            );

            return yield* deliveredOpen(sessions, yield* writtenLine(agent, "Go."));
          });

        const resetsAt = new Date((yield* DateTime.nowAsDate).getTime() + 30 * 60_000);
        yield* markPlan(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt);
        const limited = runnerSandboxApi();
        assert.deepEqual(yield* openOn(limited), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
          planResetsAt: resetsAt.getTime(),
        });
        assert.deepEqual(limited.commands, []);

        yield* TestClock.adjust("31 minutes");
        const reset = runnerSandboxApi();
        const live = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(reset)));
        const reopened = yield* deliveredOpen(live, yield* writtenLine(agent, "Go."));
        assert.ok(reopened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual(
          anthropicSwaps(reset, reset.sandboxes[0]?.currentSessionId).map((swap) => swap.sets),
          [`Bearer ${PLAN_TOKEN}`],
        );

        // Another agent's turn finds the plan refused: a message to this live runner is refused too, and nothing is written to it.
        yield* markPlan(PROVIDER_KEY_STATUS.INVALID);
        const written = (yield* launchLines(reset.commands[0])).length;
        assert.deepEqual(yield* live.send(reopened.sessionId, message(agent, "Also the emails.")), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.equal((yield* launchLines(reset.commands[0])).length, written);

        const refused = runnerSandboxApi();
        assert.deepEqual(yield* openOn(refused), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.deepEqual(refused.commands, []);
      }),
  );

  it.effect(
    "a local agent launches on its machine's own Claude Code login with nothing saved in Vespin, its CLI handed no credential of the account's",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        const deviceId = randomUUID();
        yield* registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });
        const task = yield* startTask(userId, { name: "Teammate invitations" });

        const started = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: AGENT_PAYER.MAC_SIGN_IN,
          machine: AGENT_MACHINE.DEVICE,
          deviceId,
        });

        assert.ok(Option.isSome(started));
        const agent = started.value.agent;

        const onMac = runnerSandboxApi();

        const machines = agentMachinesLayer({
          run: () => assert.fail("a Mac's launch runs no sandbox checkout"),
        }).pipe(Layer.provide(onMac.layer));

        // Note that the machines are provided innermost, so the Mac's machine answers rather than the fake sandbox's.
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(machines),
          Effect.provide(services(onMac)),
        );

        assert.equal(
          (yield* deliveredOpen(sessions, yield* writtenLine(agent, "Go."))).outcome,
          SESSION_SEND_OUTCOME.ACCEPTED,
        );
        const [launch] = yield* deviceAgentLinesWaiting(userId, deviceId);
        assert.ok(launch?.kind === DEVICE_AGENT_LINE_KIND.LAUNCH);

        const claimed = Option.getOrThrow(
          yield* claimedDeviceAgentLine(userId, deviceId, launch.id).pipe(
            Effect.provide(Layer.succeed(HostedEnvironment, NO_KEYS)),
          ),
        );

        assert.ok("secrets" in claimed);
        const { env } = Schema.decodeUnknownSync(deviceAgentLaunchSecretsSchema)(claimed.secrets);
        assert.equal(env[RUNNER_ENV.API_KEY], undefined);
        assert.equal(env[RUNNER_ENV.CLAUDE_TOKEN], undefined);
        assert.deepEqual(onMac.policies, []);
        // Its fingerprint reads no credential: the first 32 hex characters of the SHA-256 of
        // {"env":[],"names":["linear"]}, worked by hand.
        assert.equal(launch.payload.fingerprint, "bd55028e0351bd98a7a597177af52640");

        // A mode that asks is refused by name on a Mac whose runner reads no mode, rather than run with full access,
        // and queues no launch; once the Mac says its runner reads one, the launch is handed it.
        yield* updateAgentPermissionModeCommitted(userId, agent.id, AGENT_PERMISSION_MODE.ASK);

        const asked = () =>
          Effect.flatMap(
            sessionsFor(userId, { next: 0 }).pipe(
              Effect.provide(machines),
              Effect.provide(services(onMac)),
            ),
            (sessions) =>
              Effect.flatMap(writtenLine(agent, "Go on."), (line) => deliveredOpen(sessions, line)),
          );

        assert.deepEqual(yield* asked(), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          runtimeRefusal: RUNTIME_REFUSAL.MODES_UNSUPPORTED,
        });

        const launchesWaiting = (yield* deviceAgentLinesWaiting(userId, deviceId)).filter(
          (line) => line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH,
        );

        assert.deepEqual(launchesWaiting, []);
        yield* registerDevice(userId, {
          id: deviceId,
          name: "Studio",
          ...DEVICE_LAYOUT,
          capabilities: [DEVICE_CAPABILITY.PERMISSION_MODES],
        });
        assert.equal((yield* asked()).outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const relaunch = (yield* deviceAgentLinesWaiting(userId, deviceId)).at(-1);
        assert.ok(relaunch?.kind === DEVICE_AGENT_LINE_KIND.LAUNCH && relaunch.id !== launch.id);

        const reclaimed = Option.getOrThrow(
          yield* claimedDeviceAgentLine(userId, deviceId, relaunch.id).pipe(
            Effect.provide(Layer.succeed(HostedEnvironment, NO_KEYS)),
          ),
        );

        assert.ok("secrets" in reclaimed);

        const [config] = Schema.decodeUnknownSync(deviceAgentLaunchSecretsSchema)(reclaimed.secrets)
          .stdin.trimEnd()
          .split("\n")
          .map((line: string): ClaudeCodeConfig => JSON.parse(line));

        assert.equal(config?.permissionMode, PERMISSION_MODE.ASK);
      }),
  );

  it.effect(
    "an agent whose starter's subscription is refused launches on ANTHROPIC_API_KEY alone, takes messages on it, and is refused in the plan's words once the key is gone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });

        const started = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: AGENT_PAYER.API_KEY,
        });

        assert.ok(Option.isSome(started));
        // An agent of the hour-long cache's half, at its last digit.
        const agent = yield* agentIdFrom(started.value.agent, "7");
        // The account keeps a plan too, refused, which has no room for a turn.
        yield* savePlan(userId);
        const now = yield* DateTime.nowAsDate;
        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.ANTHROPIC,
          PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
          PROVIDER_KEY_STATUS.INVALID,
          undefined,
          now,
          now,
        );
        const ring = parseKeyRing(Redacted.make(RING));
        assert.ok(Result.isSuccess(ring));

        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };

        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring.success, owner, Redacted.make(API_KEY)),
          "sk-ant-api…-key",
          null,
          new Date(0),
        );

        const api = runnerSandboxApi();

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const [command] = api.commands;
        assert.ok(command !== undefined);
        // The CLI reads a placeholder where the key would stand, which the firewall swaps for the key in Anthropic's own header.
        const placeholder = command.env[RUNNER_ENV.API_KEY];
        assert.ok(placeholder !== undefined && placeholder !== API_KEY);
        assert.equal(command.env[RUNNER_ENV.CLAUDE_TOKEN], undefined);
        assert.deepEqual(anthropicSwaps(api, api.sandboxes[0]?.currentSessionId), [
          { header: "x-api-key", at: placeholder, sets: API_KEY },
        ]);

        const visible = JSON.stringify([
          command.args,
          command.env,
          yield* launchLines(command),
          api.sandboxes,
        ]);

        assert.equal(visible.includes(API_KEY), false);
        // The key pays for this agent's writes, so its half keeps the cache for an hour and the other keeps the CLI's five minutes.
        const { config } = yield* launchRead(command, readClaudeCodeConfig);
        assert.equal(config.promptCacheHour, true);

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);

        const other = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-other",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: AGENT_PAYER.API_KEY,
        });

        assert.ok(Option.isSome(other));
        const outside = yield* agentIdFrom(other.value.agent, "8");
        const outsideOpened = yield* deliveredOpen(sessions, yield* writtenLine(outside, "Go."));
        assert.equal(outsideOpened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);

        const { config: outsideConfig } = yield* launchRead(
          api.commands[1] ?? assert.fail(),
          readClaudeCodeConfig,
        );

        assert.equal(outsideConfig.promptCacheHour, undefined);

        yield* removeProviderKey(
          userId,
          PROVIDER_KEY_PROVIDER.ANTHROPIC,
          PROVIDER_KEY_KIND.API_KEY,
        );
        const gone = runnerSandboxApi();

        const without = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(gone)),
        );

        assert.deepEqual(yield* deliveredOpen(without, yield* writtenLine(agent, "Go.")), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.deepEqual(gone.commands, []);
      }),
  );

  it.effect(
    "a launch runs on the first of the account's subscriptions with room, in its order, records it, and goes back to the first once its limit resets",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        const ring = parseKeyRing(Redacted.make(RING));
        assert.ok(Result.isSuccess(ring));

        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        };

        const secondToken = "sk-ant-oat01-fixture-second-token";

        const second = yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring.success, owner, Redacted.make(secondToken)),
          "sk-ant-oat…oken",
          null,
          new Date(0),
          null,
          { add: true },
        );

        const now = yield* DateTime.nowAsDate;
        yield* setPlanStatus(
          userId,
          owner.provider,
          owner.kind,
          PROVIDER_KEY_STATUS.LIMIT_REACHED,
          new Date(now.getTime() + 30 * 60_000),
          now,
          now,
        );

        const sentOn = (on: Agent) =>
          Effect.gen(function* () {
            const api = runnerSandboxApi();

            const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
              Effect.provide(services(api)),
            );

            const opened = yield* deliveredOpen(sessions, yield* writtenLine(on, "Go."));
            assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
            const routing = Option.getOrThrow(yield* readAgentRouting(userId, on.id));

            return [
              anthropicSwaps(api, api.sandboxes[0]?.currentSessionId).map((swap) => swap.sets),
              routing.payer,
              routing.subscriptionId === second,
            ];
          });

        assert.deepEqual(yield* sentOn(agent), [
          [`Bearer ${secondToken}`],
          AGENT_PAYER.CLAUDE_SUBSCRIPTION,
          true,
        ]);

        yield* TestClock.adjust("31 minutes");
        const task = yield* startTask(userId, { name: "Invitation emails" });

        const later = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-2",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Invitation emails\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });

        assert.deepEqual(yield* sentOn(Option.getOrThrow(later).agent), [
          [`Bearer ${PLAN_TOKEN}`],
          AGENT_PAYER.CLAUDE_SUBSCRIPTION,
          false,
        ]);

        // A key saved now joins the bottom of the one order, and pays first, named by its id, once it is moved to its top, since a key has room.
        const keyOwner = { ...owner, kind: PROVIDER_KEY_KIND.API_KEY };

        const key = yield* saveProviderKey(
          userId,
          keyOwner.provider,
          keyOwner.kind,
          sealProviderKey(ring.success, keyOwner, Redacted.make("sk-ant-api03-fixture-order-key")),
          "sk-ant-api03…-key",
          null,
          now,
        );

        const bottom = yield* turnPayerOf(userId, agent.id, MODEL_PROVIDER.ANTHROPIC);
        yield* reorderSubscriptions(userId, owner.provider, [key]);
        const top = yield* turnPayerOf(userId, agent.id, MODEL_PROVIDER.ANTHROPIC);
        // A key its provider refused at the top is passed over for the next with room.
        yield* setPlanStatus(
          userId,
          keyOwner.provider,
          keyOwner.kind,
          PROVIDER_KEY_STATUS.INVALID,
          undefined,
          now,
          now,
          key,
        );
        const refused = yield* turnPayerOf(userId, agent.id, MODEL_PROVIDER.ANTHROPIC);
        assert.deepEqual(
          [bottom.payer, bottom.subscriptionId === second, top, refused.payer],
          [
            AGENT_PAYER.CLAUDE_SUBSCRIPTION,
            false,
            { payer: AGENT_PAYER.API_KEY, subscriptionId: key },
            AGENT_PAYER.CLAUDE_SUBSCRIPTION,
          ],
        );
      }),
  );

  it.effect(
    "an agent its starter's API key pays for, whose saved key does not open under this deployment's ring, is refused as unreadable and starts nothing, but on a Preview launches an admin's on the Preview's stand-in key",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({
            id: userId,
            name: "Test User",
            email: `${userId}@app.test`,
            role: USER_ROLE.ADMIN,
          }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });

        const started = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: AGENT_PAYER.API_KEY,
        });

        assert.ok(Option.isSome(started));

        // The key was sealed under another deployment's ring, as a Preview's database holds production's.
        const elsewhere = parseKeyRing(
          Redacted.make(`1:${Buffer.alloc(32, 9).toString("base64")}`),
        );

        assert.ok(Result.isSuccess(elsewhere));

        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };

        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(elsewhere.success, owner, Redacted.make(API_KEY)),
          "sk-ant-api…-key",
          null,
          new Date(0),
        );

        const api = runnerSandboxApi();

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        assert.deepEqual(
          yield* deliveredOpen(sessions, yield* writtenLine(started.value.agent, "Go.")),
          {
            outcome: SESSION_SEND_OUTCOME.FAILED,
            status: 422,
            keyRefusal: KEY_REFUSAL.UNREADABLE,
          },
        );
        assert.deepEqual(api.commands, []);

        const standIn = "sk-ant-api03-fixture-preview-key";
        const preview = runnerSandboxApi();

        const onPreview = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(
            services(preview, preview.layer, {
              ...NO_KEYS,
              previewApiKeys: { [PROVIDER_KEY_PROVIDER.ANTHROPIC]: Redacted.make(standIn) },
            }),
          ),
        );

        const opened = yield* deliveredOpen(
          onPreview,
          yield* writtenLine(started.value.agent, "Go."),
        );

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const placeholder = preview.commands[0]?.env[RUNNER_ENV.API_KEY];
        assert.deepEqual(anthropicSwaps(preview, preview.sandboxes[0]?.currentSessionId), [
          { header: "x-api-key", at: placeholder, sets: standIn },
        ]);
      }),
  );

  it.effect(
    "a PDF attached to the first message or a later one is written into the sandbox and named by its path, where an image goes as a block",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const pdf = "%PDF-1.7 the spec";
        const png = Buffer.from("png bytes").toString("base64");

        const withFiles = (line: ReturnType<typeof message>, text: string, filename: string) => ({
          ...line,
          message: [
            { type: "text" as const, text },
            {
              type: "file" as const,
              data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
              mediaType: "application/pdf",
              filename,
            },
            { type: "file" as const, data: png, mediaType: "image/png", filename: "shot.png" },
          ],
        });

        const first = yield* writtenLine(agent, "Read the spec.");
        const firstId = first.lineId;

        const opened = yield* deliveredOpen(
          sessions,
          withFiles(first, "Read the spec.", "Spec v2.pdf"),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const later = yield* writtenLine(agent, "And this one.");
        const laterId = later.lineId;

        const sent = yield* sessions.send(
          opened.sessionId,
          withFiles(later, "And this one.", "../../etc/notes.pdf"),
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);

        const firstPath = `/workspace/.agent/attachments/${firstId}/2-Spec-v2.pdf`;
        const laterPath = `/workspace/.agent/attachments/${laterId}/2-etc-notes.pdf`;
        const written = new Map(api.uploads.flatMap((upload) => [...upload]));
        assert.equal(written.get(firstPath), pdf);
        assert.equal(written.get(laterPath), pdf);

        const messages = (yield* launchRead(api.commands[0], readClaudeCodeConfig)).lines.filter(
          (each) => each.type === INPUT_LINE.MESSAGE,
        );

        assert.deepEqual(
          messages.map((each) => developerContent(each)),
          [
            [
              { type: "text", text: "Read the spec." },
              {
                type: "text",
                text: `[Spec v2.pdf (application/pdf) was attached: it is at ${firstPath}, read it from there]`,
              },
              { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
            ],
            [
              { type: "text", text: "And this one." },
              {
                type: "text",
                text: `[../../etc/notes.pdf (application/pdf) was attached: it is at ${laterPath}, read it from there]`,
              },
              { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
            ],
          ],
        );
      }),
  );

  it.effect(
    "an open whose record a session minted after it already holds launches nothing and hands its message to that session",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        yield* TestClock.adjust("1 minute");

        const later = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(later.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        // An open that raced it, its session minted a moment before.
        yield* TestClock.setTime(30_000);

        const earlier = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Also the emails."),
        );

        assert.deepEqual(earlier, {
          outcome: SESSION_SEND_OUTCOME.ACCEPTED,
          sessionId: later.sessionId,
        });
        assert.equal(api.sandboxes.length, 1);
        assert.equal(api.commands.length, 1);
        assert.ok((yield* textsOf(api.commands[0])).flat().includes("Also the emails."));
        assert.equal(
          yield* recordedRuntimeSession({ userId, conversationId: agent.conversationId }),
          later.sessionId,
        );
      }),
  );

  it.effect("send writes a message line to the running runner, and cancel writes stop", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      const lineId = randomUUID();
      yield* updateAgentChoice(userId, agent.id, {
        model: "anthropic/claude-sonnet-5.5",
        effort: "low",
      });

      const sent = yield* sessions.send(
        opened.sessionId,
        message(agent, "Also the emails.", lineId),
      );

      const turnId = yield* turnUnderWay(userId, agent);
      const canceled = yield* sessions.cancel(opened.sessionId, turnId);

      assert.deepEqual(sent, {
        outcome: SESSION_SEND_OUTCOME.ACCEPTED,
        sessionId: opened.sessionId,
        deliveryId: lineId,
      });
      assert.equal(canceled.outcome, SESSION_CANCEL_OUTCOME.ACCEPTED);
      assert.equal(api.commands.length, 1);

      const [model, line, stop] = (yield* launchRead(
        api.commands[0],
        readClaudeCodeConfig,
      )).lines.slice(1);
      // The agent's model and effort as they stand, ahead of the message, so a change since the launch holds.

      assert.deepEqual(model, {
        type: INPUT_LINE.MODEL,
        model: "claude-sonnet-5-5",
        fast: false,
        effort: "low",
      });
      assert.ok(line?.type === INPUT_LINE.MESSAGE);
      assert.equal(line.uuid, lineId);
      assert.deepEqual(developerContent(line), [{ type: "text", text: "Also the emails." }]);
      // The stop names the launch running the turn, by its first event number.
      assert.deepEqual(stop, { type: INPUT_LINE.STOP, launch: 0 });
    }),
  );

  it.effect(
    "a message opening with a command the CLI runs goes bare, and one that would change the agent's row goes behind words",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        yield* sessions.send(opened.sessionId, message(agent, "/compact keep the plan"));
        yield* sessions.send(opened.sessionId, message(agent, "/effort low"));

        const [compact, effort] = (yield* launchRead(api.commands[0], readClaudeCodeConfig)).lines
          .filter(
            (line): line is Extract<InputLine, { type: "message" }> =>
              line.type === INPUT_LINE.MESSAGE,
          )
          .slice(1);

        assert.deepEqual(compact?.content, [{ type: "text", text: "/compact keep the plan" }]);
        // The CLI runs a command from the last text block alone, so the turn's words after it leave it words.
        assert.deepEqual(effort?.content[0], { type: "text", text: "/effort low" });
        assert.equal(effort?.content.length, 2);
      }),
  );

  it.effect(
    "a change of model and effort reaches the running runner as a model line alone, a fast version as its base model with fast mode on, and a session with no runner takes nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* updateAgentChoice(userId, agent.id, {
          model: "anthropic/claude-opus-5.5-fast",
          effort: "low",
        });

        const retuned = yield* sessions.retune(opened.sessionId, agent.conversationId);

        const elsewhere = yield* sessions.retune(
          `${opened.sessionId.slice(0, -4)}0000`,
          agent.conversationId,
        );

        assert.deepEqual([retuned, elsewhere], [RUNNER_CHOICE.WRITTEN, RUNNER_CHOICE.NOT_LIVE]);
        assert.equal(api.commands.length, 1);
        assert.deepEqual((yield* launchLines(api.commands[0])).slice(2), [
          { type: INPUT_LINE.MODEL, model: "claude-opus-5-5", fast: true, effort: "low" },
        ]);
      }),
  );

  it.effect(
    "an agent whose mode asks has its launch handed the mode, and a member's answer reaches its running runner as an approval line, where a session with no runner takes nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        yield* updateAgentPermissionModeCommitted(userId, agent.id, AGENT_PERMISSION_MODE.ASK);

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        const line = {
          type: INPUT_LINE.APPROVAL,
          requestId: "request-1",
          decision: APPROVAL_DECISION.DENY,
          message: "Not on main.",
        } as const;

        const answered = yield* sessions.answer(opened.sessionId, agent.conversationId, line);

        const elsewhere = yield* sessions.answer(
          `${opened.sessionId.slice(0, -4)}0000`,
          agent.conversationId,
          line,
        );

        assert.deepEqual([answered, elsewhere], [RUNNER_ANSWER.WRITTEN, RUNNER_ANSWER.NOT_LIVE]);
        assert.equal(api.commands.length, 1);

        const {
          config,
          lines: [, written],
        } = yield* launchRead(api.commands[0], readClaudeCodeConfig);

        assert.equal(config.permissionMode, PERMISSION_MODE.ASK);
        assert.deepEqual(written, line);
      }),
  );

  it.effect(
    "a Stop its runner never confirms ends that runner and settles the turn canceled once its bound is up",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const turnId = yield* turnUnderWay(userId, agent);
        const kept = keptAfterResponse();

        const canceled = yield* sessions
          .cancel(opened.sessionId, turnId)
          .pipe(Effect.provide(kept.layer));

        // The Stop's stamp, as `stop.ts` writes it once the cancel is taken.
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* writer.requestTurnCancel(
          { userId, conversationId: agent.conversationId },
          { turnId, at: yield* DateTime.nowAsDate },
        );
        const forcing = yield* Effect.forkChild(kept.run);
        yield* turnsPass;
        yield* TestClock.adjust(Duration.subtract(CODER.STOP_CONFIRM, Duration.seconds(1)));
        yield* turnsPass;
        const before = yield* newestTurn(agent);
        yield* TestClock.adjust("1 second");
        yield* across(Fiber.join(forcing), CODER.RUNNER_LEASE.POLL, 5);

        assert.equal(canceled.outcome, SESSION_CANCEL_OUTCOME.ACCEPTED);
        assert.equal(before.status, TURN_STATUS.RUNNING);
        assert.equal((yield* newestTurn(agent)).status, TURN_STATUS.CANCELED);
        assert.equal(api.commands.length, 1);
        assert.notEqual(api.commands[0]?.exitCode, null, "the runner was ended");
      }),
  );

  it.effect("a Stop of a turn no longer under way writes nothing to the runner", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      // The turn a Stop was pressed on, then a newer one the Stop arrives during.
      const stopped = yield* turnUnderWay(userId, agent);
      yield* TestClock.adjust("1 second");
      yield* turnUnderWay(userId, agent);

      const canceled = yield* sessions.cancel(opened.sessionId, stopped);

      assert.equal(canceled.outcome, SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN);
      assert.ok(
        (yield* launchRead(api.commands[0], readClaudeCodeConfig)).lines.every(
          (line) => line.type !== INPUT_LINE.STOP,
        ),
      );
    }),
  );

  it.effect(
    "a launch's end leaves the sandbox to its idle stop; the next message resumes it and relaunches on the CLI's session with the next event number, and cancel then finds no turn once it ends",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const target = { userId, conversationId: agent.conversationId };
        // The events route records the CLI's session from the runner's init, and the run ends.
        yield* recordHeldSession(userId, agent);
        const firstBearer = launchBearer(api, api.commands[0], SERVICE_HOST);
        sequence.next = 42;

        yield* runnerTook(agent.id);

        const ended = yield* runnerEnded({
          target,
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));

        assert.equal(ended, RUNNER_ENDED.LEFT);
        assert.equal(api.sandboxes[0]?.status, "running");
        api.idleStop();
        assert.equal(
          (yield* sessions.cancel(opened.sessionId, "turn_0")).outcome,
          SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN,
        );

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.filter((each) => !each.deleted).length, 1);
        assert.equal(sandboxOfAgent(api, agent)?.status, "running");
        assert.equal(api.commands.length, 2);
        const relaunch = api.commands[1];
        assert.equal(relaunch?.sandboxSessionId, sandboxOfAgent(api, agent)?.currentSessionId);
        const { config } = yield* launchRead(relaunch, readClaudeCodeConfig);
        const [line] = yield* handedLines(userId, relaunch);
        assert.equal(config.resume, CLI_SESSION);
        assert.equal(config.firstSequence, 42);
        assert.ok(line?.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Now the emails." }]);
        // A fresh bearer for the new launch at the resumed session's firewall, recorded in place of the last.
        const bearer = launchBearer(api, relaunch, SERVICE_HOST);
        assert.ok(bearer !== undefined && bearer !== firstBearer);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
        // A fresh placeholder too, swapped for the plan's token at the resumed session's firewall.
        const placeholder = relaunch?.env[RUNNER_ENV.CLAUDE_TOKEN];
        assert.ok(placeholder !== api.commands[0]?.env[RUNNER_ENV.CLAUDE_TOKEN]);
        assert.deepEqual(anthropicSwaps(api, relaunch?.sandboxSessionId), [
          { header: "authorization", at: `Bearer ${placeholder}`, sets: `Bearer ${PLAN_TOKEN}` },
        ]);

        // The first launch's END, arriving late, stops nothing of the second's.
        yield* runnerTook(agent.id);

        const late = yield* runnerEnded({
          target,
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));

        assert.equal(late, RUNNER_ENDED.STALE);
        assert.equal(sandboxOfAgent(api, agent)?.status, "running");
      }),
  );

  it.effect(
    "a message to an agent whose stopped sandbox kept the CLI's session, which the store holds only a tail of, lets that session go and opens a fresh one with the agent's steps replayed, rather than resuming a session the CLI finds no conversation in",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const target = { userId, conversationId: agent.conversationId };
        // The session began before the store kept transcripts: the store holds only the line its
        // last launch wrote as it ended, and the Agent SDK would resume from that line alone.
        assert.equal(yield* recordAgentNativeSession(userId, agent.id, CLI_SESSION), true);
        yield* appendSessionEntries(userId, agent.conversationId, CLI_TRANSCRIPT, [
          { type: "cost-state", sessionId: CLI_SESSION },
        ]);
        yield* (yield* Database).insert(messages).values({
          id: randomUUID(),
          ...target,
          // Note that the Start's own line stands first.
          seq: 10,
          clientId: "first-step",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [{ type: "text", text: "I renamed InviteToken to InvitationToken." }],
          metadata: { author: MESSAGE_AUTHOR.MODEL },
          placedAt: new Date(0),
          finishedAt: new Date(0),
        });
        sequence.next = 42;
        yield* runnerTook(agent.id);
        yield* runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
          Effect.provide(api.layer),
        );
        api.idleStop();
        assert.equal(api.sandboxes[0]?.status, "stopped");

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.filter((each) => !each.deleted).length, 1);
        const relaunch = api.commands[1];
        const { config } = yield* launchRead(relaunch, readClaudeCodeConfig);
        const [line] = yield* handedLines(userId, relaunch);
        assert.equal(config.resume, undefined);
        const [ahead] = line?.type === INPUT_LINE.MESSAGE ? line.content : [];
        assert.ok(
          ahead?.type === "text" &&
            ahead.text.includes("I renamed InviteToken to InvitationToken."),
          JSON.stringify(ahead),
        );
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Now the emails." }]);
      }),
  );

  it.effect(
    "a message to an agent whose sandbox stopped answers once its line is queued, and its turn's delivery resumes the sandbox once the stop's snapshot is taken",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        // The resume is tried again a spacing apart while the stop's snapshot is taken.
        const spaced = yield* spacedClock(CODER.RESUME_WHILE_ENDING.SPACING);

        const sessions = yield* sessionsFor(userId, sequence).pipe(
          Effect.provide(services(api)),
          Effect.provideService(Clock.Clock, spaced.clock),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* recordHeldSession(userId, agent);
        sequence.next = 42;
        yield* runnerTook(agent.id);
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));
        api.idleStop();
        // The stop's snapshot is still being taken as the message arrives, past more than one try.
        api.snapshotting.remaining = 3;

        const sent = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Now the emails."),
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes[0]?.status, "stopped");
        assert.equal(api.commands.length, 1);
        yield* spaced.waitedOut(sessions.deliverTurn(opened.sessionId, agent.conversationId));
        assert.equal(sandboxOfAgent(api, agent)?.status, "running");
        assert.equal(api.commands.length, 2);
        const { config } = yield* launchRead(api.commands[1], readClaudeCodeConfig);
        assert.equal(config.resume, CLI_SESSION);
        assert.deepEqual((yield* handedLines(userId, api.commands[1])).map(developerContent), [
          [{ type: "text", text: "Now the emails." }],
        ]);
      }),
  );

  /**
   * An agent whose session opened with every experiment of its workspace off
   * and took one step, its runner since ended, and whose workspace then
   * turned Task descriptions on: the next message finds the session opened
   * on experiments no longer standing.
   */
  const flippedSession = (api: ReturnType<typeof runnerSandboxApi>) =>
    Effect.gen(function* () {
      const { userId, agent } = yield* openAgent;
      const sequence = { next: 0 };
      const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      yield* recordHeldSession(userId, agent);
      sequence.next = 42;
      yield* runnerTook(agent.id);
      const target = { userId, conversationId: agent.conversationId };
      // The session opened with every experiment of its workspace off, and took one step.
      yield* recordNativeTurnHanded(target, {
        experiments: { descriptionsOn: false, memoryOn: false },
      });
      yield* (yield* Database).insert(messages).values({
        id: randomUUID(),
        ...target,
        // Note that the Start's own line stands first.
        seq: 10,
        clientId: "first-step",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text: "I renamed InviteToken to InvitationToken." }],
        metadata: { author: MESSAGE_AUTHOR.MODEL },
        placedAt: new Date(0),
        finishedAt: new Date(0),
      });
      yield* runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
        Effect.provide(api.layer),
      );
      api.idleStop();
      yield* setWorkspaceExperiment({
        organizationId: agent.organizationId,
        experiment: EXPERIMENT.DESCRIPTIONS,
        on: true,
        by: userId,
      });

      return { userId, agent, sessions, opened };
    });

  it.effect(
    "a message to an agent whose workspace's experiments changed since its session opened opens a fresh session in the same sandbox, its conversation so far replayed ahead of the turn's words",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent, sessions, opened } = yield* flippedSession(api);

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2);
        assert.equal(api.sandboxes.filter((each) => !each.deleted).length, 1);
        const { config } = yield* launchRead(api.commands[1], readClaudeCodeConfig);
        assert.equal(config.resume, undefined);
        const [line] = yield* handedLines(userId, api.commands[1]);
        const [ahead] = line?.type === INPUT_LINE.MESSAGE ? line.content : [];
        assert.ok(
          ahead?.type === "text" &&
            ahead.text.includes("I renamed InviteToken to InvitationToken."),
          JSON.stringify(ahead),
        );
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Now the emails." }]);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.nativeSession, null);
      }),
  );

  it.effect(
    "a message that opened a fresh session for experiments since changed, whose delivery failed, never keeps those experiments as handed, so the next message opens it again with its replay",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent, sessions, opened } = yield* flippedSession(api);
        // The relaunch's policy write is refused, so its runner never takes the line.
        api.failPolicy.remaining = 10;
        const commandsBefore = api.commands.length;

        const sent = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Now the emails."),
        );

        const failed = yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
        api.failPolicy.remaining = 0;

        // A runner the refused relaunch started is ended rather than left waiting for its config.
        const refusedRunners = api.commands
          .slice(commandsBefore)
          .filter((each) => each.command === "node");

        assert.ok(refusedRunners.length > 0, "the refused relaunch started a runner");
        assert.ok(refusedRunners.every((each) => each.exitCode !== null));

        const next = yield* sentAndDelivered(
          sessions,
          opened.sessionId,
          agent,
          "And the invitations.",
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(failed, TURN_HANDOVER.FAILED);
        assert.equal(next.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const relaunch = api.commands.at(-1);
        const { config } = yield* launchRead(relaunch, readClaudeCodeConfig);
        assert.equal(config.resume, undefined);
        const [line] = yield* handedLines(userId, relaunch);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "And the invitations." }]);
        const [ahead] = line?.type === INPUT_LINE.MESSAGE ? line.content : [];
        assert.ok(
          ahead?.type === "text" &&
            ahead.text.includes("I renamed InviteToken to InvitationToken."),
          JSON.stringify(ahead),
        );
      }),
  );

  it.effect(
    "a message to an agent whose workspace's experiments cannot be read resumes its session, rather than opening it afresh as if every experiment were off",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent, sessions, opened } = yield* flippedSession(api);
        // The session opened on what the workspace now has: Task descriptions on alone.
        yield* recordNativeTurnHanded(
          { userId, conversationId: agent.conversationId },
          { experiments: { descriptionsOn: true, memoryOn: false } },
        );
        const db = yield* Database;
        const line = yield* writtenLine(agent, "Now the emails.");

        // Note that the table is taken away for the send alone, so the read of the experiments fails.
        const sent = yield* Effect.acquireUseRelease(
          db.execute(sql`alter table workspace_experiment rename to workspace_experiment_away`),
          () => sessions.send(opened.sessionId, line),
          () =>
            Effect.orDie(
              db.execute(sql`alter table workspace_experiment_away rename to workspace_experiment`),
            ),
        );

        yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2);
        const { config } = yield* launchRead(api.commands[1], readClaudeCodeConfig);
        assert.equal(config.resume, CLI_SESSION);
      }),
  );

  it.effect(
    "a fresh session's replay is fitted beside the rest of its line, so a long message leaves out the older steps it no longer has room for",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent, sessions, opened } = yield* flippedSession(api);
        const target = { userId, conversationId: agent.conversationId };

        // Two later steps: a long one, which fits the window alone, then a short one.
        for (const [seq, text] of [
          [11, `LONG-STEP ${"x".repeat(250_000)}`],
          [12, "I ran the invitation tests."],
        ] as const) {
          yield* (yield* Database).insert(messages).values({
            id: randomUUID(),
            ...target,
            seq,
            clientId: `step-${seq}`,
            role: MESSAGE_ROLE.ASSISTANT,
            parts: [{ type: "text", text }],
            metadata: { author: MESSAGE_AUTHOR.MODEL },
            placedAt: new Date(0),
            finishedAt: new Date(0),
          });
        }

        yield* sentAndDelivered(
          sessions,
          opened.sessionId,
          agent,
          `Now the emails. ${"y".repeat(60_000)}`,
        );

        const [line] = yield* handedLines(userId, api.commands[1]);
        const [ahead] = line?.type === INPUT_LINE.MESSAGE ? line.content : [];
        assert.ok(ahead?.type === "text");
        assert.ok(ahead.text.includes("I ran the invitation tests."), ahead.text.slice(0, 400));
        assert.ok(
          !ahead.text.includes("LONG-STEP"),
          "the long step no longer fits beside the message",
        );
      }),
  );

  it.effect.each([
    ["at its upload of the message's files", (rest: string) => rest === "fs/write", asLaunched],
    ["at the relaunch's command", (rest: string) => rest === "cmd", runnerLetGo],
  ] as const)(
    "a message that meets its sandbox stopping %s resumes the sandbox and runs on a runner launched in its next session",
    ([, call, leave]) =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        // The resume is tried again a spacing apart while the sandbox stops.
        const spaced = yield* spacedClock(CODER.RESUME_WHILE_ENDING.SPACING);

        const sessions = yield* sessionsFor(userId, sequence).pipe(
          Effect.provide(services(api)),
          Effect.provideService(Clock.Clock, spaced.clock),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* runnerTook(agent.id);
        sequence.next = 42;
        const first = api.commands[0];
        yield* leave(api, userId, opened.sessionId);
        api.stopsAt.call = call;
        const pdf = Buffer.from("%PDF-1.7 the report").toString("base64");

        const sent = yield* sessions.send(opened.sessionId, {
          ...(yield* writtenLine(agent, "Now the emails.")),
          message: [
            { type: "text" as const, text: "Now the emails." },
            { type: "file" as const, data: pdf, mediaType: "application/pdf", filename: "r.pdf" },
          ],
        });

        const pdfUploads = () =>
          api.uploads.filter((upload) => [...upload.keys()].some((path) => path.endsWith("r.pdf")))
            .length;

        const uploadedBefore = pdfUploads();
        yield* spaced.waitedOut(sessions.deliverTurn(opened.sessionId, agent.conversationId));

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes[0]?.status, "running");
        assert.equal(api.commands.length, 2);
        const relaunch = api.commands[1];
        assert.equal(relaunch?.sandboxSessionId, api.sandboxes[0]?.currentSessionId);
        assert.notEqual(relaunch?.sandboxSessionId, first?.sandboxSessionId);
        const [line] = yield* handedLines(userId, relaunch);
        assert.ok(line?.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(developerContent(line)[0], { type: "text", text: "Now the emails." });
        // The file its line carries was written by the launch that took it, in the session it runs in.
        assert.ok(pdfUploads() > uploadedBefore);
      }),
  );

  it.effect(
    "a turn past its deadline whose runner a newer launch replaced fails as that runner lost, and its reap leaves the newer launch's runner running under its bearer",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* runnerTook(agent.id);
        // The first launch's runner starts the Start's turn under its launch, then exits without ending it.
        const target = { userId, conversationId: agent.conversationId };
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = Option.getOrThrow(yield* queuedTurnOf(agent.conversationId));
        yield* writer.enqueueTurn(target, {
          turnId,
          runtimeTurnId: turnId,
          origin: TURN_ORIGIN.TYPED,
        });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(agent.conversationId),
          turnId,
          sequence: 1,
          origin: RUN_TURN_ORIGIN.TYPED,
          trigger: TURN_TRIGGER.ASK,
          at: yield* Clock.currentTimeMillis,
          attempt: yield* runnerLaunchOf(agent.id),
        });
        yield* runnerLetGo(api, userId, opened.sessionId);
        sequence.next = 42;
        // A message's line, handed on by a launch before any reap, as a queued turn's delivery makes one.
        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails.");
        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2);
        const relaunch = api.commands[1];
        const bearer = launchBearer(api, relaunch, SERVICE_HOST);
        assert.ok(bearer !== undefined);

        yield* TestClock.adjust(Duration.millis(TURN_DEADLINE.PROGRESS_MS + 1));
        const reaped = yield* reconcileAgent(agent).pipe(Effect.provide(api.layer));

        assert.deepEqual(reaped, [turnId]);

        const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
          agent.conversationId,
        );

        assert.deepEqual(
          [turn?.status, turn?.failure],
          [TURN_STATUS.FAILED, TURN_FAILURE.RUNNER_LOST],
        );
        assert.equal(relaunch?.exitCode, null, "the newer launch's runner runs on");
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
      }),
  );

  it.effect(
    "a turn whose line no runner takes fails as untaken at its pickup deadline from its queueing however often its runner crashes and relaunches meanwhile, and a line written past that deadline queues a turn of its own, whose runner the reap leaves running",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const queuedAt = yield* Clock.currentTimeMillis;

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const untaken = Option.getOrThrow(yield* queuedTurnOf(agent.conversationId));

        /** The newest launch's runner crashes before it takes a line, and the message given's delivery relaunches it. */
        const relaunched = (sent: ReturnType<typeof message>) =>
          Effect.gen(function* () {
            const crashed = api.commands.at(-1);
            assert.ok(crashed !== undefined);
            crashed.exitCode = 1;
            const launches = api.commands.length;
            const answer = yield* sessions.send(opened.sessionId, sent);
            yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
            assert.equal(answer.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
            assert.equal(api.commands.length, launches + 1);
          });

        for (const text of ["Are you there?", "Hello?", "Still nothing?"]) {
          yield* TestClock.adjust(Duration.minutes(2));
          yield* relaunched(message(agent, text));
        }

        yield* TestClock.adjust(
          Duration.millis(
            queuedAt + TURN_DEADLINE.PICKUP_MS + 1 - (yield* Clock.currentTimeMillis),
          ),
        );
        // A line written past the deadline, before any reap, as one is while another call holds the runner lease.
        yield* relaunched(yield* writtenLine(agent, "Try once more."));
        const relaunch = api.commands.at(-1);
        const reaped = yield* reconcileAgent(agent).pipe(Effect.provide(api.layer));

        assert.deepEqual(reaped, [untaken]);

        const [failed] = yield* (yield* Database)
          .select({ failure: turns.failure })
          .from(turns)
          .where(eq(turns.id, untaken));

        assert.equal(failed?.failure, TURN_FAILURE.LINE_UNTAKEN);
        const waiting = Option.getOrThrow(yield* queuedTurnOf(agent.conversationId));
        assert.notEqual(waiting, untaken, "the late line awaits a turn of its own");
        assert.equal(relaunch?.exitCode, null, "the runner launched for the late line runs on");
      }),
  );

  it.effect(
    "a launch's end that left a message untaken keeps the sandbox up, and the launch its turn's delivery starts reads it on a swap of its own",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* recordHeldSession(userId, agent);
        // The runner took its first message, and a message queued as it ended was never read.
        yield* runnerTook(agent.id);

        const sent = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Now the emails."),
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        sequence.next = 9;

        const ended = yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 8,
          reason: RUNNER_END.TURN_ENDED,
        }).pipe(Effect.provide(Layer.merge(api.layer, Layer.succeed(HostedEnvironment, NO_KEYS))));

        assert.equal(ended, RUNNER_ENDED.LINES_WAITING);
        assert.equal(api.sandboxes[0]?.status, "running");
        const first = api.commands[0];
        assert.ok(first !== undefined);
        const firstBearer = launchBearer(api, first, SERVICE_HOST);
        assert.ok(firstBearer !== undefined);
        first.exitCode = 0;
        const handed = yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);

        assert.equal(handed, TURN_HANDOVER.HANDED);
        assert.equal(api.commands.length, 2);
        const placeholder = api.commands[1]?.env[RUNNER_ENV.CLAUDE_TOKEN];
        assert.deepEqual(anthropicSwaps(api, api.sandboxes[0]?.currentSessionId), [
          { header: "authorization", at: `Bearer ${placeholder}`, sets: `Bearer ${PLAN_TOKEN}` },
        ]);
        const handOn = launchBearer(api, api.commands[1], SERVICE_HOST);
        assert.ok(handOn !== undefined && handOn !== firstBearer);
        const { config } = yield* launchRead(api.commands[1], readClaudeCodeConfig);
        assert.equal(config.resume, CLI_SESSION);
        assert.equal(config.firstSequence, 9);

        const read = yield* runnerLinesPast(userId, agent.id, {
          launch: config.firstSequence,
          after: 0,
          limit: 10,
        });

        assert.deepEqual(
          read.map((line) => developerContent(readInputLine(JSON.parse(line.text)))),
          [[{ type: "text", text: "Now the emails." }]],
        );
      }),
  );

  it.effect(
    "a warm call on an agent whose sandbox stopped resumes it and launches its runner warm with no message, the next writes that runner a warm line, and a message long past its turn's end reaches it as a line",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* recordHeldSession(userId, agent);
        yield* runnerTook(agent.id);

        const ended = yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 8,
          reason: RUNNER_END.IDLED,
        }).pipe(Effect.provide(Layer.merge(api.layer, Layer.succeed(HostedEnvironment, NO_KEYS))));

        assert.equal(ended, RUNNER_ENDED.LEFT);
        api.idleStop();
        const first = api.commands[0];
        assert.ok(first !== undefined);
        first.exitCode = 0;
        sequence.next = 9;

        yield* sessions.warm(opened.sessionId, agent.conversationId);

        assert.equal(sandboxOfAgent(api, agent)?.status, "running");
        assert.equal(api.commands.length, 2);
        const { config } = yield* launchRead(api.commands[1], readClaudeCodeConfig);
        assert.equal(config.resume, CLI_SESSION);
        assert.equal(config.warm, true);
        yield* sessions.warm(opened.sessionId, agent.conversationId);
        assert.equal(api.commands.length, 2, "the second warm call launched nothing");
        // The agent's turn ended past a Mac's warm window, which a sandbox's runner has none of.
        yield* (yield* Database).insert(turns).values({
          userId,
          conversationId: agent.conversationId,
          origin: TURN_ORIGIN.TYPED,
          status: TURN_STATUS.SETTLED,
          queuedAt: new Date(0),
          settledAt: new Date(0),
        });
        yield* TestClock.adjust(Duration.sum(CODER.RUNNER_WARM, Duration.minutes(1)));
        const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));
        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2, "the message relaunched nothing");

        const read = yield* runnerLinesPast(userId, agent.id, {
          launch: config.firstSequence,
          after: 0,
          limit: 10,
        });

        const lines = read.map((line) => readInputLine(JSON.parse(line.text)));
        assert.deepEqual(
          lines.filter((line) => line.type === INPUT_LINE.WARM),
          [{ type: INPUT_LINE.WARM }],
        );
        assert.deepEqual(
          lines.flatMap((line) =>
            line.type === INPUT_LINE.MESSAGE ? [developerContent(line)] : [],
          ),
          [[{ type: "text", text: "Now the emails." }]],
        );
      }),
  );

  it.effect(
    "a halt ends the running runner and keeps its sandbox, and the next message relaunches on the CLI's session cut before the line a rewind dropped",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // The runner took its message, and its events were applied.
        yield* runnerTook(agent.id);
        sequence.next = 1;
        yield* recordHeldSession(userId, agent);
        const target = { userId, conversationId: agent.conversationId };
        const lineId = randomUUID();
        yield* (yield* Database).insert(messages).values({
          id: lineId,
          ...target,
          // Note that the Start's own line stands first.
          seq: 10,
          clientId: "dropped-line",
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Fix the invitations." }],
          placedAt: new Date(0),
        });

        const halted = yield* sessions.halt(opened.sessionId, agent.conversationId);
        // Note that the session's record no longer names the ended runner, so no message is written to it.
        const recordAfterHalt = yield* readAgentRunnerRecord(userId, opened.sessionId);
        // Read before the relaunch, which drops what the ended launch was written but its untaken messages.
        const haltedWith = (yield* launchLines(api.commands[0])).at(-1);
        yield* rewindConversation(target, lineId);

        const sent = yield* sentAndDelivered(
          sessions,
          opened.sessionId,
          agent,
          "Fix only the emails.",
        );

        assert.equal(halted, true);
        assert.ok(Option.isNone(recordAfterHalt));
        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 1);
        assert.equal(api.sandboxes[0]?.deleted, false);
        assert.deepEqual(haltedWith, { type: INPUT_LINE.STOP, launch: 0 });
        assert.notEqual(api.commands[0]?.exitCode, null);
        assert.equal(api.commands.length, 2);
        const { config } = yield* launchRead(api.commands[1], readClaudeCodeConfig);
        const [line] = yield* handedLines(userId, api.commands[1]);
        assert.equal(config.resume, CLI_SESSION);
        assert.equal(config.rewindBefore, "dropped-line");
        assert.ok(line?.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Fix only the emails." }]);
        // The cut is handed over once.
        assert.deepEqual(yield* readNativeRewind(target), Option.none());
      }),
  );

  it.effect("a halt waits out a runner that exits within its bound rather than killing it", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      const runner = api.commands[0];
      assert.ok(runner !== undefined);
      // A read that waits for the running command's exit is held until it exits or its reader gives up.
      api.waits.hold = true;

      const halting = yield* Effect.forkChild(
        sessions.halt(opened.sessionId, agent.conversationId),
      );

      // The liveness read gives up on the running runner at the sandbox's own two-second wait, and the runner is written its Stop.
      yield* turnsPass;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* turnsPass;
      assert.deepEqual((yield* launchLines(runner)).at(-1), { type: INPUT_LINE.STOP, launch: 0 });
      assert.equal(runner.exitCode, null);
      // The runner exits five seconds after its Stop, past the machine's own wait and well within the halt's bound.
      yield* TestClock.adjust(Duration.seconds(5));
      yield* turnsPass;
      api.exit(runner, 0);
      const halted = yield* Fiber.join(halting);

      assert.equal(halted, true);
      assert.equal(runner.exitCode, 0);
    }),
  );

  it.effect("a sandbox opens on the idle timeout", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      assert.equal(api.sandboxes[0]?.timeout, Duration.toMillis(SANDBOX_IDLE));
    }),
  );

  // Note that an agent from before the store keeps no transcript there, so its session starts fresh.
  for (const stored of [true, false]) {
    it.effect(
      `a message after the stopped sandbox's snapshot expired deletes it and goes on in a fresh sandbox under the same name from the image, ${stored ? "resuming the CLI's session from the transcript the service keeps" : "starting the CLI's session fresh where the service keeps no transcript of it"}, and the installed skills written again`,
      () =>
        Effect.gen(function* () {
          vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
          const api = runnerSandboxApi();
          const { userId, agent } = yield* openAgent;
          yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.SKILLS]: true } });
          yield* installSkill(userId, {
            owner: { scope: INSTALLED_SKILL_SCOPE.PERSONAL },
            name: "incident-notes",
            description: "Write incident notes.",
            userInvocable: false,
            source: { type: INSTALLED_SKILL_SOURCE.TEXT },
            files: [{ path: "SKILL.md", bytes: new TextEncoder().encode("Write them.\n") }],
          });

          const skillUploads = () =>
            api.uploads.filter((upload) =>
              [...upload.keys()].some((path) => path.startsWith("/tmp/agent-installed-skills/")),
            ).length;

          const sequence = { next: 0 };
          const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

          const opened = yield* deliveredOpen(
            sessions,
            yield* writtenLine(agent, "Fix the invitations."),
          );

          assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

          if (stored) yield* recordHeldSession(userId, agent);
          else assert.equal(yield* recordAgentNativeSession(userId, agent.id, CLI_SESSION), true);
          sequence.next = 42;
          yield* runnerTook(agent.id);
          yield* runnerEnded({
            target: { userId, conversationId: agent.conversationId },
            sessionId: opened.sessionId,
            sequence: 41,
          }).pipe(Effect.provide(api.layer));
          api.idleStop();
          const [expired] = api.sandboxes;
          assert.ok(expired !== undefined);
          expired.snapshotExpired = true;

          const sent = yield* sentAndDelivered(
            sessions,
            opened.sessionId,
            agent,
            "Now the emails.",
          );

          assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
          assert.equal(expired.deleted, true);
          const fresh = api.sandboxes[1];
          assert.ok(fresh !== undefined);
          assert.equal(fresh.status, "running");
          assert.equal(fresh.name, expired.name);
          assert.equal(fresh.tags[SESSION_TAG], opened.sessionId);
          assert.deepEqual([fresh.image, fresh.sourceSnapshotId], [expired.image, undefined]);
          const relaunch = api.commands[1];
          assert.equal(relaunch?.sandboxSessionId, fresh.currentSessionId);
          const { config } = yield* launchRead(relaunch, readClaudeCodeConfig);
          const [line] = yield* handedLines(userId, relaunch);
          assert.equal(config.resume, stored ? CLI_SESSION : undefined);
          assert.ok(line?.type === INPUT_LINE.MESSAGE);
          assert.deepEqual(developerContent(line), [{ type: "text", text: "Now the emails." }]);
          // The installed skills went with the expired disk, so the fresh sandbox is handed them again.
          assert.equal(skillUploads(), 2);
          // The session is found again by its tag, in the new sandbox alone.
          const found = yield* sessions.send(opened.sessionId, message(agent, "And the docs."));
          assert.equal(found.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
          assert.equal(api.sandboxes.length, 2);
        }),
    );
  }

  it.effect(
    "a replacement for an expired sandbox that could not launch fails its turn and leaves the session standing for the next message",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        sequence.next = 42;
        yield* runnerTook(agent.id);
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));
        api.idleStop();
        const [expired] = api.sandboxes;
        assert.ok(expired !== undefined);
        expired.snapshotExpired = true;
        // The fresh sandbox's readying fails once, so its runner never starts.
        api.hooks.runExit = (args) => (args[0] === "-n" ? 1 : 0);

        const sent = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Now the emails."),
        );

        const failed = yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(failed, TURN_HANDOVER.FAILED);
        // The replacement took the expired sandbox's place under the session's name, and stands.
        const replacement = api.sandboxes[1];
        assert.ok(replacement !== undefined);
        assert.deepEqual([expired.deleted, replacement.deleted], [true, false]);
        api.hooks.runExit = undefined;

        const retried = yield* sentAndDelivered(
          sessions,
          opened.sessionId,
          agent,
          "Now the emails.",
        );

        assert.equal(retried.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 2);
        assert.equal(replacement.status, "running");
      }),
  );

  it.effect(
    "a stopped legacy sandbox's next launch opens the sandbox under the session's name from its snapshot, leaves the legacy one stopped, and a reset deletes both",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        sequence.next = 42;
        yield* runnerTook(agent.id);
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));
        api.idleStop();
        const [legacy] = api.sandboxes;
        assert.ok(legacy !== undefined);
        // A sandbox opened before sandboxes were named after their session stands under a UUID, its tags the session's.
        legacy.name = `${SANDBOX_NAME}${randomUUID()}`;
        legacy.currentSnapshotId = "snap_legacy";

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const moved = api.sandboxes[1];
        assert.ok(moved !== undefined);
        assert.deepEqual(
          [moved.name, moved.sourceSnapshotId, moved.status],
          [agentSandboxName(opened.sessionId), "snap_legacy", "running"],
        );
        assert.deepEqual([legacy.status, legacy.deleted], ["stopped", false]);
        const relaunch = api.commands.at(-1);
        assert.equal(relaunch?.sandboxSessionId, moved.currentSessionId);
        // A reset deletes the legacy sandbox with the session's own, so its disk never comes back.
        const reset = yield* sessions.reset(opened.sessionId);
        assert.equal(reset.outcome, SESSION_RESET_OUTCOME.RESET);
        assert.deepEqual([moved.deleted, legacy.deleted], [true, true]);
      }),
  );

  it.effect(
    "an END the replaced launch posts while its replacement's command is starting stops nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const target = { userId, conversationId: agent.conversationId };
        const first = api.commands[0];
        assert.ok(first !== undefined);
        first.exitCode = 0;
        sequence.next = 42;
        const lateEnds: Promise<string>[] = [];
        // The test's own database, which the END's lease is taken in beside the relaunch's.
        const context = yield* Effect.context<DatabaseServices>();
        // The first launch's END lands just as the relaunch's command has started, before its answer,
        // and waits out the relaunch's lease.
        api.hooks.onStart = async () => {
          lateEnds.push(
            Effect.runPromiseWith(context)(
              runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
                Effect.provide(api.layer),
              ),
            ),
          );
        };

        // The exited runner, which posted no END yet, is awaited, and launched again past its grace.
        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Again.");
        yield* deliveredPastGrace(sessions, opened.sessionId, agent);

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        yield* Effect.promise(async () => {
          for (let turn = 0; turn < 50; turn += 1) {
            await new Promise<void>((settle) => setImmediate(settle));
          }
        });
        yield* TestClock.adjust(CODER.RUNNER_LEASE.POLL);
        assert.deepEqual(yield* Effect.promise(() => Promise.all(lateEnds)), [RUNNER_ENDED.STALE]);
        assert.equal(api.sandboxes[0]?.status, "running");
      }),
  );

  it.effect(
    "a Start's open answers before any sandbox is made, a message sent before its turn's delivery is queued beside its line rather than read as its session ended, that delivery opening the sandbox and launching the runner on both, and a plan signed out is refused at once with nothing to deliver",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* sessions.open(yield* writtenLine(agent, "Fix the invitations."));

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual([api.sandboxes.length, api.commands.length], [0, 0]);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        const sent = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Now the emails."),
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual([api.sandboxes.length, api.commands.length], [0, 0]);
        const handed = yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
        assert.equal(handed, TURN_HANDOVER.HANDED);
        assert.deepEqual([api.sandboxes.length, api.commands.length], [1, 1]);
        assert.equal(api.sandboxes[0]?.tags.sessionId, opened.sessionId);
        assert.deepEqual((yield* handedLines(userId, api.commands[0])).map(developerContent), [
          [{ type: "text", text: "Fix the invitations." }],
          [{ type: "text", text: "Now the emails." }],
        ]);

        const unplanned = yield* openAgentWithoutPlan;
        const refusedApi = runnerSandboxApi();

        const unplannedSessions = yield* sessionsFor(unplanned.userId, { next: 0 }).pipe(
          Effect.provide(services(refusedApi)),
        );

        const refused = yield* unplannedSessions.open(message(unplanned.agent, "Go."));
        assert.deepEqual(refused, {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.deepEqual(refusedApi.sandboxes, []);
      }),
  );

  it.effect(
    "a runner that ended is relaunched on the next message though its sandbox is still up",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 3 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const first = api.commands[0];
        assert.ok(first !== undefined);
        // The runner took its message, its events were applied, and it ended.
        yield* runnerTook(agent.id);
        sequence.next = 4;
        yield* runnerLetGo(api, userId, opened.sessionId);

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Again.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2);
        assert.equal(api.commands[1]?.sandboxSessionId, first.sandboxSessionId);
        const [line] = yield* handedLines(userId, api.commands[1]);
        assert.ok(line?.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Again." }]);
      }),
  );

  it.effect(
    "a turn its plan's limit cut short, retried on the next payer, hands the line its runner already took to the relaunched runner",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 3 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));
        const sent = yield* writtenLine(agent, "Fix the invitations.");
        const opened = yield* deliveredOpen(sessions, sent);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // The runner took its message, and its plan's limit cut the turn short.
        yield* runnerTook(agent.id);
        sequence.next = 4;

        const retried = yield* sessions.retry(opened.sessionId, sent);

        assert.equal(retried.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2);
        const [line] = yield* handedLines(userId, api.commands[1]);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Fix the invitations." }]);
      }),
  );

  it.effect(
    "two messages to a runner that ended both reach the one runner their turn's delivery launches, in order, however often it is delivered",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 3 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const first = api.commands[0];
        assert.ok(first !== undefined);
        // The runner took its message, its events were applied, and it ended.
        yield* runnerTook(agent.id);
        sequence.next = 4;
        yield* runnerLetGo(api, userId, opened.sessionId);

        const sent = [
          yield* sessions.send(opened.sessionId, yield* writtenLine(agent, "One.")),
          yield* sessions.send(opened.sessionId, yield* writtenLine(agent, "Two.")),
        ];

        // The queue delivers at least once, so the turn's delivery may come twice.
        const handed = [
          yield* sessions.deliverTurn(opened.sessionId, agent.conversationId),
          yield* sessions.deliverTurn(opened.sessionId, agent.conversationId),
        ];

        assert.deepEqual(
          sent.map((each) => each.outcome),
          [SESSION_SEND_OUTCOME.ACCEPTED, SESSION_SEND_OUTCOME.ACCEPTED],
        );
        // The second delivery awaits the runner the first launched, rather than launching another.
        assert.deepEqual(handed, [TURN_HANDOVER.HANDED, TURN_HANDOVER.AWAITED]);
        assert.equal(api.commands.length, 2);
        assert.deepEqual((yield* handedLines(userId, api.commands[1])).flatMap(developerContent), [
          { type: "text", text: "One." },
          { type: "text", text: "Two." },
        ]);
      }),
  );

  it.effect(
    "a runner the record names up that never takes its line is awaited for its grace, then launched again once, and the relaunch is handed the line",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        // The first launch's runner reads as running to Vercel, and never takes its line.
        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const [stuck] = api.commands;
        assert.ok(stuck !== undefined && stuck.exitCode === null);

        const awaited = yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
        const relaunched = yield* deliveredPastGrace(sessions, opened.sessionId, agent);

        assert.deepEqual([awaited, relaunched], [TURN_HANDOVER.AWAITED, TURN_HANDOVER.HANDED]);
        assert.equal(api.commands.length, 2);
        assert.equal(stuck.exitCode, 143);
        const [, relaunch] = api.commands;
        assert.ok(JSON.stringify(yield* launchLines(relaunch)).includes("Fix the invitations."));
      }),
  );

  it.effect("a message to a running runner is queued for it without waiting on its exit", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      // A read that waits for the running command's exit is held until its reader gives up.
      api.waits.hold = true;

      const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));

      assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
      assert.ok(JSON.stringify(yield* launchLines(api.commands[0])).includes("Now the emails."));
      assert.equal(api.commands.length, 1);
    }),
  );

  it.effect(
    "a message waiting behind another call's lease is interrupted at once, holding nothing and launching nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 3 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const first = api.commands[0];
        assert.ok(first !== undefined);
        first.exitCode = 0;
        // Another instance's call holds the lease, as a launch elsewhere does.
        const now = new Date(yield* Clock.currentTimeMillis);
        const elsewhere = randomUUID();
        const until = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
        assert.equal(yield* claimAgentRunnerLease(agent.id, elsewhere, now, until), true);

        const waiting = yield* Effect.forkChild(
          sessions.send(opened.sessionId, message(agent, "Again.")),
        );

        yield* Effect.promise(async () => {
          for (let turn = 0; turn < 50; turn += 1) {
            await new Promise<void>((settle) => setImmediate(settle));
          }
        });
        yield* TestClock.adjust("5 seconds");
        yield* Fiber.interrupt(waiting);

        assert.equal(api.commands.length, 1);
        // The lease is still the other call's alone, and free once it lets go.
        assert.equal(yield* claimAgentRunnerLease(agent.id, randomUUID(), now, until), false);
        yield* releaseAgentRunnerLease(agent.id, elsewhere);
        assert.equal(yield* claimAgentRunnerLease(agent.id, randomUUID(), now, until), true);
      }),
  );

  it.effect(
    "a message naming files waiting behind another call's lease is answered unavailable before the store's dispatch deadline, its line queued for no launch to read without its files",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 3 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* runnerTook(agent.id);
        // Another instance's call holds the lease, as a launch elsewhere does.
        const now = new Date(yield* Clock.currentTimeMillis);
        const until = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
        assert.equal(yield* claimAgentRunnerLease(agent.id, randomUUID(), now, until), true);

        // The store interrupts a hand-over at thirty seconds, so the send must answer by then.
        const waiting = yield* Effect.forkChild(
          sessions.send(opened.sessionId, {
            ...(yield* writtenLine(agent, "Again.")),
            message: [
              { type: "text" as const, text: "Again." },
              {
                type: "file" as const,
                data: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
                mediaType: "application/pdf",
                filename: "spec.pdf",
              },
            ],
          }),
        );

        for (let second = 0; second < 29; second += 1) {
          yield* turnsPass;
          yield* TestClock.adjust("1 second");
        }

        yield* turnsPass;
        const answered = waiting.pollUnsafe();
        yield* Fiber.interrupt(waiting);

        assert.ok(answered !== undefined && Exit.isSuccess(answered));
        assert.deepEqual(answered.value, { outcome: SESSION_SEND_OUTCOME.FAILED, status: 503 });
        assert.deepEqual(yield* handedLines(userId, api.commands[0]), []);
      }),
  );

  it.effect(
    "messages sent while another call holds the lease, as a launch does, are answered at once and read by the launch after its first, in the order sent",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 3 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // Another instance's call holds the lease, as a launch elsewhere does.
        const now = new Date(yield* Clock.currentTimeMillis);
        const elsewhere = randomUUID();
        const until = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
        assert.equal(yield* claimAgentRunnerLease(agent.id, elsewhere, now, until), true);
        yield* updateAgentChoice(userId, agent.id, {
          model: "anthropic/claude-sonnet-5.5",
          effort: "low",
        });

        const answers = yield* Effect.forEach(["Now the emails.", "And the docs."], (text) =>
          sessions.send(opened.sessionId, message(agent, text)),
        );

        assert.deepEqual(
          answers.map((answer) => answer.outcome),
          [SESSION_SEND_OUTCOME.ACCEPTED, SESSION_SEND_OUTCOME.ACCEPTED],
        );

        const read = yield* runnerLinesPast(userId, agent.id, {
          launch: 3,
          after: 0,
          limit: 10,
        });

        // The developer's words close each message, the turn's own words ahead of them, and the
        // agent's model as it stands now goes ahead of each message queued behind.
        const model = {
          type: INPUT_LINE.MODEL,
          model: "claude-sonnet-5-5",
          fast: false,
          effort: "low",
        };

        assert.deepEqual(
          read.map((line) => {
            const parsed = readInputLine(JSON.parse(line.text));

            return parsed.type === INPUT_LINE.MESSAGE ? parsed.content.at(-1) : parsed;
          }),
          [
            { type: "text", text: "Fix the invitations." },
            model,
            { type: "text", text: "Now the emails." },
            model,
            { type: "text", text: "And the docs." },
          ],
        );
      }),
  );

  it.effect(
    "a repository agent's launch keeps every span it opens in the trace it was asked under, its checkout's on the edge's runner among them",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const sentry = recordingSentry();

        // The edge runner traces as the web's runtime does, its root fiber handed nothing of the caller's.
        const traced: SandboxRunner = (effect) =>
          Effect.runPromise(effect.pipe(Effect.provide(sentryReportingLayer)));

        const asked = yield* Effect.gen(function* () {
          const { agent, sessions } = yield* repositoryAgent(api, ownInstallation(), {
            run: traced,
          });

          const opened = yield* deliveredOpen(
            sessions,
            yield* writtenLine(agent, "Push a branch."),
          );

          assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
          assert.ok(api.runs.some(isClone));

          return yield* Effect.currentSpan;
        }).pipe(Effect.withSpan("web/startAgent"), Effect.provide(sentry.layer));

        const traces = new Set(
          sentOfType(sentry.sent, "span").flatMap((item) =>
            JSON.parse(item.text).items.map((span: { trace_id: string }) => span.trace_id),
          ),
        );

        assert.deepEqual([...traces], [asked.traceId]);
      }),
  );

  it.effect(
    "a launch's END waits out a call holding the agent's runner lease, and stops nothing once that call relaunched the runner",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const [sandbox] = api.sandboxes;
        assert.ok(sandbox !== undefined);
        // A send elsewhere holds the lease, as it does while it relaunches the runner.
        const now = new Date(yield* Clock.currentTimeMillis);
        const elsewhere = randomUUID();
        const until = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
        assert.equal(yield* claimAgentRunnerLease(agent.id, elsewhere, now, until), true);

        yield* runnerTook(agent.id);

        const ending = yield* Effect.forkChild(
          runnerEnded({
            target: { userId, conversationId: agent.conversationId },
            sessionId: opened.sessionId,
            sequence: 5,
          }).pipe(Effect.provide(api.layer)),
        );

        yield* Effect.promise(async () => {
          for (let turn = 0; turn < 50; turn += 1) {
            await new Promise<void>((settle) => setImmediate(settle));
          }
        });
        yield* TestClock.adjust("5 seconds");
        assert.equal(sandbox.status, "running");
        // The send's relaunch records its launch, past the END's sequence, and lets go.
        const recorded = Option.getOrThrow(yield* readAgentRunnerRecord(userId, opened.sessionId));
        yield* writeAgentRunnerRecord(userId, opened.sessionId, {
          ...recorded,
          firstSequence: 42,
        });
        yield* releaseAgentRunnerLease(agent.id, elsewhere);
        yield* TestClock.adjust(CODER.RUNNER_LEASE.POLL);

        assert.equal(yield* Fiber.join(ending), RUNNER_ENDED.STALE);
        assert.equal(sandbox.status, "running");
      }),
  );

  it.effect(
    "a warm runner whose integrations changed since its launch is ended and relaunched for the next message, and one at work keeps going on what it has",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const handed = { servers: [LINEAR_SERVER] };
        // Note that the first launch is numbered past the line queued for whichever launch runs next.
        const sequence = { next: 1 };

        const sessions = yield* claudeCodeSessions({
          userId,
          eventsUrl: EVENTS_URL,
          linesUrl: LINES_URL,
          mcpUrl: MCP_URL,
          transcriptsUrl: TRANSCRIPTS_URL,
          integrations: () => Effect.sync(() => handed.servers),
          instructions: () => Effect.succeed(INSTRUCTIONS),
          nextSequence: () => Effect.sync(() => sequence.next),
        }).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // The runner took its message, and its events were applied.
        yield* runnerTook(agent.id);
        sequence.next = 2;
        handed.servers = [LINEAR_SERVER, { name: "notion", url: `${MCP_URL}/integrations/notion` }];

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Use Notion now.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const [first, second] = api.commands;
        assert.ok(first !== undefined && second !== undefined);
        assert.notEqual(first.exitCode, null);
        assert.ok(!JSON.stringify(yield* launchLines(first)).includes("Use Notion now."));
        const [config] = yield* launchLines(second);
        assert.ok(Predicate.isObjectOrArray(config) && "integrations" in config);
        assert.deepEqual(config.integrations, handed.servers);
        assert.ok(JSON.stringify(yield* handedLines(userId, second)).includes("Use Notion now."));

        // A turn under way keeps its runner, which goes on with the servers it has.
        handed.servers = [LINEAR_SERVER];
        yield* TestClock.adjust("1 second");
        yield* turnUnderWay(userId, agent);
        yield* sessions.send(opened.sessionId, yield* writtenLine(agent, "Also the docs."));
        assert.equal(api.commands.length, 2);
        assert.ok(JSON.stringify(yield* launchLines(second)).includes("Also the docs."));
      }),
  );

  it.effect(
    "a message sent while another call holds the lease waits on it where the warm runner was launched in another mode, and goes to a launch in the agent's mode",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 1 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* runnerTook(agent.id);
        sequence.next = 2;
        // The member asks for approvals while another instance's call holds the lease.
        yield* updateAgentPermissionModeCommitted(userId, agent.id, AGENT_PERMISSION_MODE.ASK);
        const now = new Date(yield* Clock.currentTimeMillis);
        const elsewhere = randomUUID();
        const heldUntil = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
        assert.equal(yield* claimAgentRunnerLease(agent.id, elsewhere, now, heldUntil), true);

        const sending = yield* Effect.forkChild(
          sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails."),
        );

        yield* turnsPass;
        yield* TestClock.adjust(CODER.RUNNER_LEASE.POLL);
        yield* turnsPass;
        // Nothing is queued for the runner launched with full access while the lease stands.
        const [first] = api.commands;
        assert.ok(first !== undefined);
        assert.ok(!JSON.stringify(yield* handedLines(userId, first)).includes("Now the emails."));
        yield* releaseAgentRunnerLease(agent.id, elsewhere);
        yield* TestClock.adjust(CODER.RUNNER_LEASE.POLL);

        assert.equal((yield* Fiber.join(sending)).outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const second = api.commands[1];
        assert.ok(second !== undefined);
        const { config } = yield* launchRead(second, readClaudeCodeConfig);
        assert.equal(config.permissionMode, PERMISSION_MODE.ASK);
        assert.ok(JSON.stringify(yield* handedLines(userId, second)).includes("Now the emails."));
      }),
  );

  it.effect(
    "reset deletes the sandbox and retires the runner's bearer; a session gone answers retired",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // The runner took its line, so nothing of the session waits on a launch once it is reset.
        yield* runnerTook(agent.id);

        const reset = yield* sessions.reset(opened.sessionId);

        assert.equal(reset.outcome, SESSION_RESET_OUTCOME.RESET);
        assert.equal(api.sandboxes[0]?.deleted, true);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, null);
        assert.equal(
          (yield* sessions.reset(opened.sessionId)).outcome,
          SESSION_RESET_OUTCOME.NO_ACTIVE_SESSION,
        );
        assert.deepEqual(yield* sessions.send(opened.sessionId, message(agent, "Hello?")), {
          outcome: SESSION_SEND_OUTCOME.RETIRED,
        });
      }),
  );

  it.effect("a session of another agent takes nothing from this conversation's messages", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const mine = yield* openAgent;
      const theirs = yield* openAgent;

      const theirSessions = yield* sessionsFor(theirs.userId, { next: 0 }).pipe(
        Effect.provide(services(api)),
      );

      const opened = yield* deliveredOpen(
        theirSessions,
        yield* writtenLine(theirs.agent, "Their work."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

      const mySessions = yield* sessionsFor(mine.userId, { next: 0 }).pipe(
        Effect.provide(services(api)),
      );

      const sent = yield* mySessions.send(opened.sessionId, message(mine.agent, "Not yours."));
      // A send queued behind another call's lease is told the same, and queues nothing.
      const now = new Date(yield* Clock.currentTimeMillis);
      const until = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
      assert.equal(yield* claimAgentRunnerLease(mine.agent.id, randomUUID(), now, until), true);

      const queuedBehind = yield* mySessions.send(
        opened.sessionId,
        message(mine.agent, "Still not yours."),
      );

      const canceled = yield* mySessions.cancel(opened.sessionId, "turn_0");
      const reset = yield* mySessions.reset(opened.sessionId);

      assert.deepEqual(sent, { outcome: SESSION_SEND_OUTCOME.RETIRED });
      assert.deepEqual(queuedBehind, { outcome: SESSION_SEND_OUTCOME.RETIRED });
      assert.equal(canceled.outcome, SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN);
      assert.equal(reset.outcome, SESSION_RESET_OUTCOME.NO_ACTIVE_SESSION);
      assert.equal(api.sandboxes[0]?.deleted, false);
      assert.equal((yield* launchLines(api.commands[0])).length, 2);
    }),
  );

  it.effect(
    "a relaunch whose config never reached the runner ends that runner and fails its turn, and the next message's delivery relaunches whole",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* runnerLetGo(api, userId, opened.sessionId);
        api.failStdin.remaining = 1;
        api.failStdin.status = 400;

        const sent = yield* sessions.send(opened.sessionId, yield* writtenLine(agent, "Again."));
        const failed = yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);

        const retried = yield* sentAndDelivered(
          sessions,
          opened.sessionId,
          agent,
          "Again, please.",
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(failed, TURN_HANDOVER.FAILED);
        assert.equal(retried.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 3);
        assert.notEqual(api.commands[1]?.exitCode, null);
        const { config } = yield* launchRead(api.commands[2], readClaudeCodeConfig);
        const [line] = yield* handedLines(userId, api.commands[2]);
        assert.equal(config.harness, RUNNER_HARNESS.CLAUDE_CODE);
        assert.equal(line?.type, INPUT_LINE.MESSAGE);
      }),
  );

  it.effect("a message whose stdin write Vercel refused in passing is written again", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));

      const opened = yield* deliveredOpen(
        sessions,
        yield* writtenLine(agent, "Fix the invitations."),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
      api.failStdin.remaining = 1;
      api.failStdin.status = 503;

      const sending = yield* Effect.forkChild(
        sessions.send(opened.sessionId, message(agent, "Now the emails.")),
      );

      yield* TestClock.adjust(Duration.seconds(5));
      const sent = yield* Fiber.join(sending);

      assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
      assert.equal(api.commands.length, 1);
      const last = (yield* launchRead(api.commands[0], readClaudeCodeConfig)).lines.at(-1);
      assert.ok(last?.type === INPUT_LINE.MESSAGE);
      assert.deepEqual(developerContent(last), [{ type: "text", text: "Now the emails." }]);
    }),
  );

  it.effect(
    "the turn's own words lead every message: the time on a typed first turn, and the time again on the next",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        // Note that the line joins the Start's turn, still open, as a message written before it ends does.
        const after = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Also the docs."),
        );

        assert.equal(after.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 1);
        const [typed, typedAfter] = yield* textsOf(api.commands[0]);
        // A typed first turn opens with the time alone: the plan is its first message already.
        assert.ok(typed?.[0]?.startsWith("The time as this turn opens"), typed?.[0] ?? "");
        assert.deepEqual(typed?.slice(1), ["Fix the invitations."]);
        assert.ok(
          typedAfter?.[0]?.startsWith("The time as this turn opens"),
          typedAfter?.[0] ?? "",
        );
        assert.deepEqual(typedAfter?.slice(1), ["Also the docs."]);
      }),
  );

  it.effect(
    "a message queued behind another its runner has not yet taken hands only what that one does not, the task's words handed once",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // The runner took the Start's line, and its turn ended, so the next line's turn hands the task.
        yield* runnerTook(agent.id);
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* settleRunnerLostTurns(writer, agent.conversationId, yield* Clock.currentTimeMillis);

        // Two messages, the second before the runner took the first.
        const emails = yield* writtenLine(agent, "Now the emails.");
        const sentFirst = yield* sessions.send(opened.sessionId, emails);
        const docs = yield* writtenLine(agent, "And the docs.");
        const sentSecond = yield* sessions.send(opened.sessionId, docs);
        assert.deepEqual(
          [sentFirst.outcome, sentSecond.outcome],
          [SESSION_SEND_OUTCOME.ACCEPTED, SESSION_SEND_OUTCOME.ACCEPTED],
        );

        const [first, second] = (yield* textsOf(api.commands[0])).slice(-2);
        assert.ok(first?.[0]?.startsWith("The task as it stands"), first?.[0] ?? "");
        assert.deepEqual(first?.slice(1), ["Now the emails."]);
        assert.ok(second?.[0]?.startsWith("The time as this turn opens"), second?.[0] ?? "");
        assert.deepEqual(second?.slice(1), ["And the docs."]);
      }),
  );

  it.effect(
    "a launch Vercel refused on a turn's delivery logs the call, its status, and Vercel's error, and no secret, and reads as the agent's failed turn",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const logged: string[] = [];

        const logger = Logger.layer([
          Logger.make((options) => {
            logged.push([options.message].flat().map(String).join(" "));
          }),
        ]);

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(Layer.merge(services(api), logger)),
        );

        api.failStdin.remaining = 1;
        api.failStdin.status = 400;

        const opened = yield* sessions
          .open(yield* writtenLine(agent, "Fix the invitations."))
          .pipe(Effect.provide(logger));

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        const handed = yield* sessions
          .deliverTurn(opened.sessionId, agent.conversationId)
          .pipe(Effect.provide(logger));

        assert.equal(handed, TURN_HANDOVER.FAILED);
        assert.ok(
          logged.includes(
            "A Claude Code launch failed on a turn's delivery: the sandbox's stdin was unavailable: Vercel answered 400: stdin_refused: the command's stdin was refused",
          ),
          logged.join("\n"),
        );
        const bearer = api.commands[0]?.env[RUNNER_ENV.BEARER];
        assert.ok(bearer !== undefined);
        const written = logged.join("\n");

        for (const secret of [PLAN_TOKEN, bearer, fixtureToken()]) {
          assert.equal(written.includes(secret), false);
        }

        assert.deepEqual(yield* newestTurn(agent), {
          status: TURN_STATUS.FAILED,
          failure: AGENT_FAILURE.SANDBOX,
        });
        assert.equal(
          yield* newestFailureDetail(agent),
          `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE} the sandbox's stdin was unavailable: Vercel answered 400: stdin_refused: the command's stdin was refused`,
        );
      }),
  );

  it.effect(
    "a checkout whose sandbox command Vercel never answered keeps the checkout's sentence and Vercel's answer after it",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        // The checkout's own commands, which run through bash, after the SDK made the agent's user.
        api.hooks.onRun = (_env, command) =>
          command === "bash" ? Promise.reject(new Error("socket hang up")) : Promise.resolve();

        yield* deliveredOpen(sessions, yield* writtenLine(agent, "Push a branch."));

        const detail = (yield* newestFailureDetail(agent)) ?? "";
        assert.ok(
          detail.startsWith(`${REPOSITORY_REFUSAL.CHECKOUT_FAILED} the sandbox's cmd`),
          detail,
        );
        assert.ok(detail.includes("socket hang up"), detail);
      }),
  );

  it.effect(
    "a repository agent's sandbox opens with the write token at its firewall, and never in a command",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api);
        const runsAtStart: number[] = [];
        api.hooks.onStart = async () => {
          runsAtStart.push(api.runs.length);
        };

        const opened = yield* deliveredOpen(sessions, yield* writtenLine(agent, "Push a branch."));

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        // The repository is cloned whole, in one fetch, before the runner starts, so no fetch runs
        // beside the agent's own git.
        const clone = api.runs.findIndex(isClone);
        assert.ok(clone >= 0 && clone < (runsAtStart[0] ?? -1));
        const writeHeader = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;
        assert.ok(JSON.stringify(api.policies.at(-1)?.policy).includes(writeHeader));
        assert.equal(api.commands.length, 1);
        const visible = JSON.stringify([api.commands, api.runs, api.sandboxes]);
        assert.equal(visible.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.equal(visible.includes(writeHeader), false);
      }),
  );

  it.effect(
    "messages after a launch whose clone failed make the checkout it left whole before its runner starts: cloned where it is missing, finished where it stands unfinished",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());

        // The fake runs no git, so the checkout holds what went through: its clone, then its identity.
        const checkout = {
          cloneRefused: true,
          identityRefused: true,
          cloned: false,
          finished: false,
        };

        api.hooks.runExit = (args) => {
          if (args[0] === "-d") return checkout.cloned ? 0 : 1;

          if (args[0] === "config") return checkout.finished ? 0 : 1;

          if (args.some((arg) => arg.includes("git clone"))) {
            if (checkout.cloneRefused) return 1;
            checkout.cloned = true;

            return 0;
          }

          if (args.some((arg) => arg.includes("git config user.email"))) {
            if (checkout.identityRefused) return 1;
            checkout.finished = true;

            return 0;
          }

          return 0;
        };

        const isIdentity = (run: { readonly args: readonly string[] }) =>
          run.args.some((arg) => arg.includes("git config user.email"));

        const kept = keptAfterResponse();

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the relay."),
        ).pipe(Effect.provide(kept.layer));

        yield* kept.run;
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal((yield* newestTurn(agent)).status, TURN_STATUS.FAILED);
        const own = sandboxOfAgent(api, agent)?.currentSessionId;
        const failedRuns = api.runs.length;

        // The clone goes through now, and the identity is refused.
        checkout.cloneRefused = false;
        yield* sentAndDelivered(sessions, opened.sessionId, agent, "Try again.").pipe(
          Effect.provide(kept.layer),
        );
        yield* kept.run;
        const clonedRuns = api.runs.length;
        checkout.identityRefused = false;

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Try again.").pipe(
          Effect.provide(kept.layer),
        );

        yield* kept.run;

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);

        const ownAfter = (from: number) =>
          api.runs.slice(from).filter((run) => run.session === own);

        assert.equal(ownAfter(failedRuns).filter(isClone).length, 1, "cloned once");
        assert.equal(ownAfter(clonedRuns).filter(isClone).length, 0, "not cloned again");
        assert.equal(ownAfter(clonedRuns).filter(isIdentity).length, 1, "finished");
        assert.equal(api.commands.length, 1);
        assert.equal(api.commands[0]?.sandboxSessionId, own);
      }),
  );

  it.effect(
    "a Start in a workspace with no drive yet is created from the image on an empty drive of its own and clones its repository whole onto it, filling no workspace drive, and reports the drive gone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        const kept = keptAfterResponse();

        const reported: Parameters<Parameters<typeof ErrorReporter.make>[0]>[0]["attributes"][] =
          [];

        const reporting = ErrorReporter.layer([
          ErrorReporter.make(({ attributes }) => {
            reported.push(attributes);
          }),
        ]);

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the relay."),
        ).pipe(Effect.provide(Layer.merge(kept.layer, reporting)));

        yield* kept.run;

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 1);
        const own = sandboxOfAgent(api, agent);
        const drive = mountedDrive(api, own);
        assert.deepEqual([own?.image, own?.sourceSnapshotId], [IMAGE, undefined]);
        assert.ok(drive !== undefined && drive.forkedFrom === undefined);
        const ownRuns = api.runs.filter((run) => run.session === own?.currentSessionId);
        assert.equal(ownRuns.filter(isClone).length, 1);
        assert.deepEqual(api.drives, [drive], "no drive but its own was made or filled");
        assert.deepEqual(
          reported.filter((each) => each.broken !== undefined),
          [{ workspaceId: agent.organizationId, broken: "gone" }],
        );
        const visible = JSON.stringify([api.commands, api.runs, api.sandboxes]);
        assert.equal(visible.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
      }),
  );
  it.effect(
    "a repository agent's new sandbox starts its workspace's cloud setup after its checkout without waiting on it, the scripts written to files and the setup script given the workspace's variables, and none of the runner's credentials, and records how each script exited once the run ends past the answer",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        const ring = parseKeyRing(Redacted.make(RING));
        assert.ok(Result.isSuccess(ring));
        const workspace = agent.organizationId;
        yield* setInstallScript(workspace, "apt-get install -y redis-tools", new Date(0));
        yield* setRepositorySetup(
          workspace,
          RELAY_FULL_NAME,
          REPOSITORY_SCRIPT_KIND.SETUP,
          "pnpm install",
          new Date(0),
        );
        yield* setWorkspaceVariable(
          workspace,
          "DATABASE_URL",
          sealWorkspaceVariable(
            ring.success,
            { organizationId: workspace, name: "DATABASE_URL" },
            Redacted.make("postgres://fixture"),
          ),
          new Date(0),
        );

        // Note that the setup never exits here, so a launch that waited on it would never start the runner.
        let runsBeforeSetup: number | undefined;
        api.hooks.onStart = async (command) => {
          if (command.args.join(" ").includes(REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG)) {
            runsBeforeSetup = api.runs.length;
          }
        };

        const kept = keptAfterResponse();

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the relay."),
        ).pipe(Effect.provide(kept.layer));

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual(
          yield* listScriptRuns(workspace, agent.userId),
          [],
          "nothing is recorded while the run goes on",
        );

        // The run ends past the answer, its stderr saying how each script exited, which is kept as each one's last run.
        const ended = api.commands.find((each) =>
          each.args.join(" ").includes(REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG),
        );

        assert.ok(ended !== undefined);
        ended.stderr = `vespin-setup-exit ${CLOUD_SETUP_SCRIPT.INSTALL} 0\nvespin-setup-exit ${CLOUD_SETUP_SCRIPT.SETUP} 0\n`;
        ended.exitCode = 0;
        yield* kept.run;
        assert.deepEqual(
          (yield* listScriptRuns(workspace, agent.userId))
            .map((run) => [run.script, run.repository, run.exitCode, run.agent.id])
            .sort(),
          [
            [CLOUD_SETUP_SCRIPT.INSTALL, null, 0, agent.id],
            [CLOUD_SETUP_SCRIPT.SETUP, agent.repository?.toLowerCase(), 0, agent.id],
          ],
        );
        const own = sandboxOfAgent(api, agent);
        const uploaded = new Map(api.uploads.flatMap((upload) => [...upload]));
        assert.equal(
          uploaded.get("/tmp/vespin-setup/install.sh"),
          "apt-get install -y redis-tools",
        );
        assert.equal(uploaded.get("/tmp/vespin-setup/setup.sh"), "pnpm install");

        const clone = api.runs.findIndex(
          (run) => run.session === own?.currentSessionId && isClone(run),
        );

        const setup = api.commands.find(
          (each) =>
            each.sandboxSessionId === own?.currentSessionId &&
            each.args.join(" ").includes(REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG),
        );

        assert.ok(setup !== undefined && clone !== -1 && runsBeforeSetup !== undefined);
        assert.ok(runsBeforeSetup > clone, "the setup starts after the checkout");
        assert.equal(setup.user, undefined);
        assert.equal(setup.env.DATABASE_URL, "postgres://fixture");
        // The runner's own credentials stay in the runner's environment alone.
        const runner = api.commands.find((each) => each.user === "agent");
        assert.ok(runner !== undefined);

        for (const secret of [runner.env[RUNNER_ENV.CLAUDE_TOKEN], runner.env[RUNNER_ENV.BEARER]]) {
          assert.ok(secret !== undefined);
          assert.equal(JSON.stringify(setup.env).includes(secret), false);
        }
      }),
  );

  it.effect(
    "a Start boots from the image on its own fork of its workspace's drive, makes its user, claims its repository's folder there at the default branch under its write token written once ahead of it, clones and installs nothing, and launches with its write token standing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        const drive = filledWorkspaceDrive(api, agent);

        const opened = yield* deliveredOpen(sessions, yield* writtenLine(agent, "Fix the relay."));

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const own = sandboxOfAgent(api, agent);
        assert.deepEqual([own?.image, own?.sourceSnapshotId], [IMAGE, undefined]);
        assert.equal(mountedDrive(api, own)?.forkedFrom, drive.name);
        const ownRuns = api.runs.filter((run) => run.session === own?.currentSessionId);
        assert.equal(ownRuns.filter(isClone).length, 0);
        assert.equal(ownRuns.filter(isUserMade).length, 1);
        assert.equal(ownRuns.filter(isInstall).length, 0);
        const claims = ownRuns.filter(isClaim);
        assert.deepEqual(
          claims.map((run) => [
            run.env[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FOLDER],
            run.env[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.BRANCH],
            run.env[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.REPOSITORY],
          ]),
          [[RELAY_FOLDER, RELAY.defaultBranch, RELAY_FULL_NAME]],
        );
        assert.equal(api.commands.length, 1);
        const writeHeader = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;
        const ownPolicies = api.policies.filter((each) => each.session === own?.currentSessionId);
        assert.ok(JSON.stringify(ownPolicies.at(-1)?.policy).includes(writeHeader));

        // The fetch ran under one write, the agent's own credential on GitHub's API host as well as git's.
        const beforeClaim = api.policies
          .slice(0, claims[0]?.policiesBefore)
          .filter((each) => each.session === own?.currentSessionId);

        assert.equal(beforeClaim.length, 1);

        // SAFETY: the fake keeps each network policy as the service sent it, whose rules are listed by host under `allow`.
        const firstWrite = beforeClaim[0]?.policy as { readonly allow?: WireRecord } | undefined;

        assert.ok(
          JSON.stringify(firstWrite?.allow?.["api.github.com"] ?? null).includes(writeHeader),
        );
      }),
  );

  it.effect(
    "a Start whose workspace's drive holds no checkout of its repository clones it whole on the fork and links it at its folder",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        const drive = filledWorkspaceDrive(api, agent);
        let claiming = false;
        api.hooks.onRun = async (env) => {
          claiming = isClaim({ env });
        };

        api.hooks.runExit = () => (claiming ? NOT_HELD_EXIT : 0);

        const opened = yield* deliveredOpen(sessions, yield* writtenLine(agent, "Fix the relay."));

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal((yield* newestTurn(agent)).status === TURN_STATUS.FAILED, false);
        const own = sandboxOfAgent(api, agent);
        assert.equal(mountedDrive(api, own)?.forkedFrom, drive.name);
        const ownRuns = api.runs.filter((run) => run.session === own?.currentSessionId);

        const steps = ownRuns.flatMap((run) =>
          isClaim(run) ? ["claim"] : isClone(run) ? ["clone"] : isLink(run) ? ["link"] : [],
        );

        assert.deepEqual(steps, ["claim", "clone", "link"]);
        assert.equal(
          ownRuns.find(isLink)?.env[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FOLDER],
          RELAY_FOLDER,
        );
        assert.equal(api.commands.length, 1);
      }),
  );
  it.effect(
    "a message after a drive agent's sandbox stopped makes it again from the image with the drive its first open forked mounted, never resuming its snapshot, and its turns' restore points are still offered",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        filledWorkspaceDrive(api, agent);
        const opened = yield* deliveredOpen(sessions, yield* writtenLine(agent, "Fix the relay."));
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const stopped = sandboxOfAgent(api, agent);
        const drive = mountedDrive(api, stopped);
        assert.ok(stopped !== undefined && drive !== undefined);
        // The turn's checkout as its runner recorded it, whose refs stand in the checkout on the drive.
        const turnId = yield* turnUnderWay(userId, agent);

        const before = {
          commit: "0123456789abcdef0123456789abcdef01234567",
          head: null,
          branch: "main",
        };

        yield* recordTurnSnapshot({ userId, conversationId: agent.conversationId }, turnId, before);
        yield* runnerTook(agent.id);
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 0,
        }).pipe(Effect.provide(api.layer));
        api.idleStop();

        const sent = yield* sentAndDelivered(sessions, opened.sessionId, agent, "Now the emails.");

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const fresh = sandboxOfAgent(api, agent);
        assert.ok(fresh !== undefined && fresh !== stopped);
        assert.equal(stopped.deleted, true);
        assert.deepEqual(
          [fresh.name, fresh.image, fresh.sourceSnapshotId],
          [stopped.name, IMAGE, undefined],
        );
        assert.equal(mountedDrive(api, fresh), drive);

        const kept = yield* Effect.flatMap(Database, (db) =>
          db
            .select({ commit: turns.snapshotCommit, branch: turns.snapshotBranch })
            .from(turns)
            .where(eq(turns.id, turnId)),
        );

        assert.deepEqual(kept, [{ commit: before.commit, branch: before.branch }]);
      }),
  );

  /** An agent continued from one that runs on a fork of its workspace's drive, its sandbox stopped, the drive it owns gone where `gone` says. */
  const continuedFromDrive = (gone: boolean) =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent: onDrive, sessions } = yield* repositoryAgent(api, ownInstallation());
      const drive = filledWorkspaceDrive(api, onDrive);
      const kept = keptAfterResponse();
      yield* deliveredOpen(sessions, yield* writtenLine(onDrive, "Fix the relay.")).pipe(
        Effect.provide(kept.layer),
      );
      const source = sandboxOfAgent(api, onDrive);
      const sourceDrive = mountedDrive(api, source);
      assert.ok(source !== undefined && sourceDrive !== undefined);
      source.status = "stopped";
      sourceDrive.deleted = gone;

      const continued = yield* anotherAgent(userId, onDrive, undefined, {
        agentId: onDrive.id,
        steps: 0,
        totalSteps: 0,
        sandbox: source.name,
      });

      const opened = yield* deliveredOpen(sessions, yield* writtenLine(continued, "Go on.")).pipe(
        Effect.provide(kept.layer),
      );

      assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

      return { api, drive, source, own: sandboxOfAgent(api, continued) };
    });

  it.effect(
    "an agent continued from one on a drive is created from the image with a fork of the source's drive, and clones, fetches, and installs nothing",
    () =>
      Effect.gen(function* () {
        const { api, source, own } = yield* continuedFromDrive(false);

        assert.deepEqual([own?.image, own?.sourceSnapshotId], [IMAGE, undefined]);
        assert.equal(mountedDrive(api, own)?.forkedFrom, mountedDrive(api, source)?.name);
        const ownRuns = api.runs.filter((run) => run.session === own?.currentSessionId);
        assert.deepEqual(
          [ownRuns.filter(isClone).length, ownRuns.filter(isInstall).length],
          [0, 0],
        );
      }),
  );

  it.effect("an agent continued from one whose drive is gone forks its workspace's drive", () =>
    Effect.gen(function* () {
      const { api, drive, own } = yield* continuedFromDrive(true);

      assert.equal(mountedDrive(api, own)?.forkedFrom, drive.name);
    }),
  );

  it.effect(
    "an agent continued from another whose transcript was carried forks the source's CLI session at its first open, cut where the Start cut it, and once cleared opens a fresh one of its own",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;

        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        assert.ok(agent.taskId !== null);

        const started = yield* createAgent(userId, {
          taskId: agent.taskId,
          idempotencyKey: `start-${randomUUID()}`,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Invitations\n",
          prompt: null,
          repository: null,
          startedFrom: {
            agentId: agent.id,
            steps: 0,
            totalSteps: 0,
            session: CLI_SESSION,
            cutBefore: "source-line",
          },
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });

        const continued = Option.getOrThrow(started).agent;
        // The Start copied the source's transcript, which the store holds from its root.
        yield* appendSessionEntries(userId, continued.conversationId, CLI_TRANSCRIPT, [CLI_ROOT]);

        const opened = yield* deliveredOpen(sessions, yield* writtenLine(continued, "Go on."));

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const { config } = yield* launchRead(api.commands[0], readClaudeCodeConfig);
        assert.deepEqual(
          [config.resume, config.fork, config.rewindBefore],
          [CLI_SESSION, true, "source-line"],
        );

        // A clear marks the transcript and lets the session go; the next place made anew starts afresh.
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* writer.markSessionCleared({ userId, conversationId: continued.conversationId });
        yield* recordAgentNativeSession(userId, continued.id, null);
        const fresh = runnerSandboxApi();

        const reopened = yield* deliveredOpen(
          yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(fresh))),
          yield* writtenLine(continued, "Start over."),
        );

        assert.ok(reopened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        const { config: freshConfig } = yield* launchRead(fresh.commands[0], readClaudeCodeConfig);

        assert.deepEqual([freshConfig.resume, freshConfig.fork], [undefined, undefined]);
      }),
  );

  it.effect(
    "an agent started on another branch claims its repository's folder on its workspace's drive at that branch",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent, sessions } = yield* repositoryAgent(api, ownInstallation());
        const drive = filledWorkspaceDrive(api, agent);
        const onBranch = yield* anotherAgent(userId, agent, "relay-fix");

        const opened = yield* deliveredOpen(sessions, yield* writtenLine(onBranch, "Go on."));

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const own = sandboxOfAgent(api, onBranch);
        assert.equal(mountedDrive(api, own)?.forkedFrom, drive.name);
        const ownRuns = api.runs.filter((run) => run.session === own?.currentSessionId);
        assert.equal(ownRuns.filter(isClone).length, 0);
        assert.equal(
          ownRuns.find(isClaim)?.env[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.BRANCH],
          "relay-fix",
        );
      }),
  );
  it.effect(
    "a launch mints its write token once, and clones on it while its commit identity is still read",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const clone = gate();
        const sent: SentToGitHub[] = [];

        // The commit identity's lookup (the App's bot, for a member with no GitHub sign-in) answers only once the clone runs.
        const isIdentity = (each: SentToGitHub) =>
          decodeURIComponent(new URL(each.url).pathname).endsWith("[bot]");

        const identity = sighting(isIdentity);

        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation(), {
          onGitHub: async (each) => {
            sent.push(each);
            identity.observe(each);

            if (isIdentity(each)) await clone.arrived;
          },
        });

        api.hooks.onRun = async (env) => {
          if (isClone({ env })) await clone.pass();
        };

        const line = yield* writtenLine(agent, "Fix the relay.");
        const opening = yield* Effect.forkChild(deliveredOpen(sessions, line));
        yield* Effect.promise(() => Promise.all([clone.arrived, identity.seen]));
        const startedDuringClone = api.commands.length;
        clone.open();
        const opened = yield* Fiber.join(opening);

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(startedDuringClone, 0);
        assert.equal(api.commands.length, 1);
        assert.equal(
          sent.filter((each) => mintsRepositoryToken(each, TOKEN_ACCESS.WRITE)).length,
          1,
        );
        const writeHeader = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;
        assert.ok(JSON.stringify(api.policies.at(-1)?.policy).includes(writeHeader));
      }),
  );
  it.effect(
    "a message to a running runner is written ahead of its credential's renewal, and a renewal Vercel refused leaves the message standing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const policiesBefore = api.policies.length;
        api.failPolicy.remaining = 1;

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));
        const later = yield* sessions.send(opened.sessionId, message(agent, "And the docs."));

        assert.deepEqual(
          [sent.outcome, later.outcome],
          [SESSION_SEND_OUTCOME.ACCEPTED, SESSION_SEND_OUTCOME.ACCEPTED],
        );
        assert.ok(JSON.stringify(yield* launchLines(api.commands[0])).includes("Now the emails."));
        assert.equal(api.commands.length, 1);
        // The refused renewal set nothing; the next message's renewal set the credential afresh.
        assert.equal(api.policies.length, policiesBefore + 1);
      }),
  );
  it.effect(
    "a message to a running runner answers before its credential is renewed, which is set at its firewall past the answer",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api, ownInstallation());

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const policiesBefore = api.policies.length;
        const kept = keptAfterResponse();

        const sent = yield* sessions
          .send(opened.sessionId, message(agent, "Now the emails."))
          .pipe(Effect.provide(kept.layer));

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.ok(JSON.stringify(yield* launchLines(api.commands[0])).includes("Now the emails."));
        assert.equal(api.policies.length, policiesBefore, "nothing is set before the answer");
        yield* kept.run;
        assert.equal(api.policies.length, policiesBefore + 1);
      }),
  );
  it.effect(
    "each message counts how it reached the runner: written to the runner up, or by its turn's delivery relaunched in a sandbox still up, or, its sandbox stopped, made fresh from the image on its own drive",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const analytics = recordingProductAnalytics();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };

        const sessions = yield* sessionsFor(userId, sequence).pipe(
          Effect.provide(Layer.merge(services(api), analytics.layer)),
        );

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);

        yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        // The runner exited and was let go, its sandbox still up.
        yield* runnerLetGo(api, userId, opened.sessionId);
        sequence.next = 10;
        yield* sentAndDelivered(sessions, opened.sessionId, agent, "And the docs.");
        // The launch ended, and the sandbox stopped idle.
        sequence.next = 20;
        yield* runnerTook(agent.id);
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 19,
        }).pipe(Effect.provide(api.layer));
        api.idleStop();
        yield* sentAndDelivered(sessions, opened.sessionId, agent, "And the changelog.");

        assert.deepEqual(
          analytics.recorded
            .filter((event) => event.name === SERVER_EVENT.AGENT_HANDOFF)
            .map((event) => ({ userId: event.userId, ...event.properties })),
          [
            { userId, harness: "claude_code", path: "warm", turn_running: false },
            { userId, harness: "claude_code", path: "relaunched", turn_running: false },
            { userId, harness: "claude_code", path: "fresh", turn_running: false },
          ],
        );
      }),
  );
});
