import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  INPUT_LINE,
  type InputLine,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  type RunnerConfig,
  type RunnerEvent,
} from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import {
  type Agent,
  createAgent,
  latestTurnsOfReached,
  readAgentRouting,
} from "@repo/database/models/agent-store";
import { deviceAgentLinesWaiting } from "@repo/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@repo/database/models/device-store";
import { parseKeyRing, sealProviderKey } from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import { runnerLinesPast } from "@repo/database/models/runner-line-store";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@repo/database/testing";
import {
  AGENT_FAILURE,
  AGENT_MACHINE,
  AGENT_PAYER,
  type AgentPayer,
} from "@repo/features/agent-wire";
import {
  DEVICE_AGENT_LINE_KIND,
  deviceAgentLaunchSecretsSchema,
} from "@repo/features/device-agent-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { TURN_DEADLINE } from "@repo/features/turn-deadline";
import { memorySandbox } from "@repo/sandbox/testing";
import { fixtureToken } from "@repo/sandbox/vercel/testing";
import { TURN_STATUS, type WireRecord } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { Clock, DateTime, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { sealCodexDeviceCredentials } from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { type AfterResponse, keptAfterResponse } from "../../http/after-response.js";
import { NO_GITHUB } from "../../testing/github-app-fake.js";
import {
  type FakeCommand,
  launchBearer,
  linesOf,
  runnerSandboxApi,
} from "../../testing/runner-sandbox-fake.js";
import { claimedDeviceAgentLine } from "../device-agent.js";
import { agentMachinesLayer } from "../machine/agent-machines.js";
import { RUNNER_EVENTS_PATH, runnerEventsApp } from "../native-events/runner-events-app.js";
import { SESSION_SEND_OUTCOME } from "../sessions/agent-sessions.js";
import { launchUrl } from "../workspace-mcp/bearer.js";
import { AgentImage } from "./agent-image.js";
import { claudeCodeSessions } from "./claude-code-sessions.js";
import { codexSessions } from "./codex-sessions.js";
import { reconcileAgent } from "./reconcile.js";
import type { RunnerSessionsOptions } from "./runner-sessions.js";
import { NativeAgentSessions } from "./runtime-sessions.js";
import { agentFailureOf } from "./status.js";
import { resumeWaitedTurns } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * A plan's usage limit met mid-turn, end to end through the service, on
 * each harness and each machine: the runner's limited turn posted to the
 * events route, which reads the limit's moments and hands the turn on
 * (`turnRetried`), or holds it for the reset the sweep releases it at
 * (`resumeWaitedTurns`); the relaunch's payer chosen afresh
 * (`turnPayerOf`); the turn's line handed to the new launch, read from the
 * line store in the cloud and on its stdin on a Mac; and that launch's turn
 * posted back to the route, which finishes it. Only the runner, Vercel, and
 * the Mac are faked. Synthetic accounts, tokens, and ids throughout.
 */

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

const ORIGIN = "https://app.test";
const SERVICE_HOST = "app.test";
/** The query a runner's URLs name its launch by. */
const LAUNCH_QUERY = "runnerLaunch";
const SESSION = "00000000-0000-4000-8000-000000000001";
const THREAD = "00000000-0000-4000-8000-000000000002";
const RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;
const CODEX_EXECUTABLE = "/Users/fixture/Library/Application Support/Vespin/codex/bin/codex";

const ENVIRONMENT: HostedEnvironmentValues = {
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

/** How long the limit a turn meets stands from the test's clock. */
const LIMIT_FOR = Duration.hours(1);

/** Who may pay once the first subscription meets its limit. */
const FALLBACK = {
  NEXT_PLAN: "next_plan",
  API_KEY: "api_key",
  NONE: "none",
} as const;
type Fallback = (typeof FALLBACK)[keyof typeof FALLBACK];

const keyRing = () => {
  const ring = parseKeyRing(Redacted.make(RING));
  assert.ok(Result.isSuccess(ring));
  return ring.success;
};

/** Events numbered from the one given, as a runner posts them. */
const numbered = (from: number, said: readonly unknown[]): readonly RunnerEvent[] =>
  // SAFETY: each message is one the harness or the runner emits, written in its JSON shape.
  said.map((message, index) => ({ sequence: from + index, message }) as RunnerEvent);

const CLAUDE_TOP = { parent_tool_use_id: null, session_id: SESSION };

/** One notification app-server sends on the session's thread, as the runner posts it. */
const codexNotification = (method: string, params: WireRecord) => ({
  method,
  params: { threadId: THREAD, turnId: "turn-1", ...params },
});

/** What each harness's account keeps, and how its runner says a turn met the plan's limit or finished. */
const HARNESS = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: {
    model: "anthropic/claude-opus-5.5",
    planPayer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
    /** A setup-token, sealed as Settings saves it, after the account's first where `add` asks. */
    savePlan: (userId: string, add: boolean) => {
      const owner = {
        userId,
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      };
      return saveProviderKey(
        userId,
        owner.provider,
        owner.kind,
        sealProviderKey(keyRing(), owner, Redacted.make(`sk-ant-oat01-${randomUUID()}`)),
        "sk-ant-oat…",
        null,
        new Date(0),
        null,
        add ? { add: true } : undefined,
      );
    },
    keyProvider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    limited: (lineId: string, resetsAt: number): readonly unknown[] => [
      { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
      { type: "system", subtype: "init", ...CLAUDE_TOP },
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: resetsAt / 1000,
        },
        uuid: randomUUID(),
        ...CLAUDE_TOP,
      },
      {
        type: "assistant",
        message: {
          id: "msg_limit",
          content: [{ type: "text", text: "You've hit your session limit · resets 5pm" }],
        },
        error: "rate_limit",
        uuid: randomUUID(),
        ...CLAUDE_TOP,
      },
      { type: "result", subtype: "success", is_error: true, ...CLAUDE_TOP },
      { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
    ],
    finished: (lineId: string): readonly unknown[] => [
      { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
      { type: "system", subtype: "init", ...CLAUDE_TOP },
      {
        type: "assistant",
        message: { id: "msg_done", content: [{ type: "text", text: "Done." }] },
        uuid: randomUUID(),
        ...CLAUDE_TOP,
      },
      { type: "result", subtype: "success", is_error: false, ...CLAUDE_TOP },
      { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
    ],
  },
  [CONVERSATION_RUNTIME.CODEX]: {
    model: "openai/gpt-6.1-sol",
    planPayer: AGENT_PAYER.CHATGPT_SUBSCRIPTION,
    /** A ChatGPT sign-in, sealed as its device-code login saves it, whose token outlasts the case, after the account's first where `add` asks. */
    savePlan: (userId: string, add: boolean) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const accessExpiresAt = new Date(now.getTime() + Duration.toMillis(Duration.hours(3)));
        const { sealed, hint } = sealCodexDeviceCredentials(keyRing(), userId, {
          accessToken: `access-${randomUUID()}`,
          refreshToken: "refresh-0",
          idToken: "id-token-0",
          accountId: "chatgpt-subject",
          chatgptAccountId: "chatgpt-workspace",
          accessExpiresAt,
        });
        return yield* saveProviderKey(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          sealed,
          hint,
          null,
          now,
          accessExpiresAt,
          add ? { add: true } : undefined,
        );
      }),
    keyProvider: PROVIDER_KEY_PROVIDER.OPENAI,
    limited: (lineId: string, resetsAt: number): readonly unknown[] => [
      { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
      codexNotification("turn/started", { turn: { id: "turn-1" } }),
      {
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: resetsAt / 1000 },
            secondary: null,
            rateLimitReachedType: "rate_limit_reached",
          },
        },
      },
      codexNotification("turn/completed", {
        turn: {
          id: "turn-1",
          status: "failed",
          error: {
            message: 'unexpected status 429: {"error":{"code":"usage_limit_reached"}}',
            codexErrorInfo: "usageLimitExceeded",
            additionalDetails: null,
          },
        },
      }),
      { type: RUNNER_EVENT.END, reason: RUNNER_END.FAILED },
    ],
    finished: (lineId: string): readonly unknown[] => [
      { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
      codexNotification("turn/started", { turn: { id: "turn-2" } }),
      codexNotification("turn/completed", { turn: { id: "turn-2", status: "completed" } }),
      { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
    ],
  },
} as const;
type Harness = keyof typeof HARNESS;

/** A launch's runner as a case reads it: how it reaches the events route, where it numbers its events from, the developer's words of each message it is handed, and whether each of those it is handed first was resent. */
interface Launched {
  readonly bearer: string;
  readonly launch: number;
  readonly firstSequence: number;
  readonly texts: readonly string[];
  readonly resent: readonly boolean[];
}

/** The developer's words of a message line, past the turn's own words that lead it. */
const wordsOf = (line: InputLine): readonly string[] =>
  line.type === INPUT_LINE.MESSAGE
    ? line.content.slice(1).flatMap((block) => (block.type === "text" ? [block.text] : []))
    : [];

/** Whether a message line was resent to a session that holds it. */
const resentOf = (line: InputLine): readonly boolean[] =>
  line.type === INPUT_LINE.MESSAGE ? [line.resent === true] : [];

/** The launch a runner's config names in its URLs. */
const launchNamed = (config: RunnerConfig) =>
  Number(new URL(config.eventsUrl).searchParams.get(LAUNCH_QUERY));

/** A sandbox's launch as its command was started: its bearer as the firewall swaps it in, and its lines as the line store hands them. */
const sandboxLaunch = (
  api: ReturnType<typeof runnerSandboxApi>,
  userId: string,
  command: FakeCommand,
) =>
  Effect.gen(function* () {
    const [config] = linesOf(command) as [RunnerConfig];
    const bearer = launchBearer(api, command, SERVICE_HOST);
    assert.ok(bearer !== undefined && command.agentId !== undefined);
    const read = yield* runnerLinesPast(userId, command.agentId, {
      launch: config.firstSequence,
      after: 0,
      limit: 50,
    });
    const lines = read.map((row) => JSON.parse(row.text) as InputLine);
    const launched: Launched = {
      bearer,
      launch: launchNamed(config),
      firstSequence: config.firstSequence,
      texts: lines.flatMap(wordsOf),
      resent: lines.flatMap(resentOf),
    };
    return launched;
  });

/** A Mac's launch as it claims its line: the bearer it is handed, and the lines on its stdin. */
const macLaunch = (userId: string, deviceId: string, lineId: string) =>
  Effect.gen(function* () {
    const claimed = Option.getOrThrow(
      yield* claimedDeviceAgentLine(userId, deviceId, lineId).pipe(
        Effect.provide(Layer.succeed(HostedEnvironment, ENVIRONMENT)),
      ),
    );
    assert.ok("secrets" in claimed);
    const secrets = Schema.decodeUnknownSync(deviceAgentLaunchSecretsSchema)(claimed.secrets);
    const [config, ...lines] = secrets.stdin
      .trimEnd()
      .split("\n")
      .map((line): unknown => JSON.parse(line)) as [RunnerConfig, ...InputLine[]];
    const launched: Launched = {
      bearer: secrets.env[RUNNER_ENV.BEARER] ?? "",
      launch: launchNamed(config),
      firstSequence: config.firstSequence,
      texts: lines.flatMap(wordsOf),
      resent: lines.flatMap(resentOf),
    };
    return launched;
  });

/** An account on the harness's plan, with the fallback the case names, and one agent on the machine given, in no repository: the agent, its sessions, and its launches so far. */
const accountWith = (harness: Harness, onMac: boolean, fallback: Fallback) =>
  Effect.gen(function* () {
    const spec = HARNESS[harness];
    const userId = `user-${randomUUID()}`;
    yield* Effect.flatMap(Database, (db) =>
      db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
    );
    yield* spec.savePlan(userId, false);
    if (fallback === FALLBACK.NEXT_PLAN) yield* spec.savePlan(userId, true);
    if (fallback === FALLBACK.API_KEY) {
      const owner = { userId, provider: spec.keyProvider, kind: PROVIDER_KEY_KIND.API_KEY };
      yield* saveProviderKey(
        userId,
        owner.provider,
        owner.kind,
        sealProviderKey(keyRing(), owner, Redacted.make(`sk-fixture-${randomUUID()}`)),
        "sk-…",
        null,
        new Date(0),
      );
    }
    const deviceId = randomUUID();
    if (onMac) {
      yield* registerDevice(userId, {
        id: deviceId,
        name: "Studio",
        ...DEVICE_LAYOUT,
        codexExecutable: CODEX_EXECUTABLE,
      });
    }
    const task = yield* startTask(userId, { name: "Teammate invitations" });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: spec.model,
      effort: "high",
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      repository: null,
      runtime: harness,
      ...(onMac ? { machine: AGENT_MACHINE.DEVICE, deviceId } : undefined),
    });
    const agent = Option.getOrThrow(started).agent;

    const api = runnerSandboxApi();
    const sequence = { next: 1 };
    const options: RunnerSessionsOptions = {
      userId,
      eventsUrl: `${ORIGIN}/api/agents/runner/events`,
      linesUrl: `${ORIGIN}/api/agents/runner-lines`,
      mcpUrl: `${ORIGIN}/api/agents/mcp`,
      transcriptsUrl: `${ORIGIN}/api/agents/runner-transcripts`,
      integrations: () => Effect.succeed([]),
      instructions: () => Effect.succeed("You are a Vespin coding agent."),
      nextSequence: () => Effect.sync(() => sequence.next),
    };
    const built =
      harness === CONVERSATION_RUNTIME.CODEX
        ? codexSessions({ ...options, tokenUrl: `${ORIGIN}/api/agents/runner-token` })
        : claudeCodeSessions(options);
    const environment = Layer.succeed(HostedEnvironment, ENVIRONMENT);
    const sessions = yield* built.pipe(
      Effect.provide(
        Layer.mergeAll(
          api.layer,
          agentMachinesLayer({ run: (effect) => Effect.runPromise(effect) }).pipe(
            Layer.provide(Layer.merge(api.layer, environment)),
          ),
          environment,
          NO_GITHUB,
          Layer.succeed(AgentImage, {
            reference: Effect.succeed("agent-image:fixture"),
            runner: Effect.succeed([]),
          }),
        ),
      ),
    );

    // Each launch so far, in order: a sandbox's commands, or the launch lines its Mac claimed, each
    // with the messages written to its runner after it, which its Mac's lines keep until they are taken.
    const claimed: Launched[] = [];
    const writtenTo = new Map<string, number>();
    const launches = onMac
      ? Effect.gen(function* () {
          const waiting = yield* deviceAgentLinesWaiting(userId, deviceId);
          const after: string[][] = claimed.map(() => []);
          for (const line of waiting) {
            if (line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH) {
              claimed.push(yield* macLaunch(userId, deviceId, line.id));
              after.push([]);
            }
            if (line.kind !== DEVICE_AGENT_LINE_KIND.MESSAGE) continue;
            const into = writtenTo.get(line.id) ?? claimed.length - 1;
            writtenTo.set(line.id, into);
            const lines = String(line.payload.text).trimEnd().split("\n");
            after[into]?.push(...lines.flatMap((each) => wordsOf(JSON.parse(each) as InputLine)));
          }
          return claimed.map((launch, index) => ({
            ...launch,
            texts: [...launch.texts, ...(after[index] ?? [])],
          }));
        })
      : Effect.forEach(api.commands, (command) => sandboxLaunch(api, userId, command));
    // A Mac beats on while it waits for the agent's next launch; a sandbox has nothing to beat.
    const beat = onMac ? Effect.asVoid(beatDevice(userId, deviceId)) : Effect.void;
    return { userId, agent, api, sessions, sequence, launches, beat };
  });

type Sessions = Effect.Success<ReturnType<typeof accountWith>>["sessions"];

/** The harnesses a limited turn is handed on to: the account's sessions given, and none of any other account's. */
const reaching = (userId: string, sessions: Sessions) =>
  Layer.succeed(NativeAgentSessions, {
    sessions: (_runtime, account) =>
      account === userId ? Option.some(Effect.succeed(sessions)) : Option.none(),
  });

/** The events route over the test's store, its limited turns handed on to the harnesses given, as a fetch answering its status; past its answer where `after` keeps that work for the case to run. */
const eventsRoute = (
  reached: Layer.Layer<NativeAgentSessions>,
  after: Layer.Layer<AfterResponse> = Layer.empty as Layer.Layer<AfterResponse>,
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      memorySandbox().layer,
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, ENVIRONMENT),
      reached,
      after,
    );
    const web = HttpRouter.toWebHandler(
      runnerEventsApp({}).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    return (runner: Launched, events: readonly RunnerEvent[]) =>
      Effect.promise(async () => {
        const response = await web.handler(
          new Request(launchUrl(`${ORIGIN}${RUNNER_EVENTS_PATH}`, runner.launch), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${runner.bearer}`,
            },
            body: JSON.stringify({ events }),
          }),
        );
        return response.status;
      });
  });

/** The developer's line, written awaiting the turn its open queues, as a Start's first line is. */
const writtenLine = (agent: Agent, text: string) =>
  Effect.gen(function* () {
    const clientKey = randomUUID();
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.writeAwaitingLine(
      { userId: agent.userId, conversationId: agent.conversationId },
      { text, clientKey, sender: { kind: MESSAGE_SENDER.APP } },
      Effect.succeed(true),
    );
    return {
      conversationId: agent.conversationId,
      turn: "typed" as const,
      message: text,
      lineId: sentLineId(clientKey),
    };
  });

/** Each harness on each machine, past each fallback, and who its relaunch must run on. */
const CASES = [CONVERSATION_RUNTIME.CLAUDE_CODE, CONVERSATION_RUNTIME.CODEX].flatMap((harness) =>
  [false, true].flatMap((onMac) =>
    Object.values(FALLBACK).map((fallback) => ({
      name: `${harness} ${onMac ? "on a Mac" : "in the cloud"}, ${fallback}`,
      harness,
      onMac,
      fallback,
      payer: (fallback === FALLBACK.API_KEY
        ? AGENT_PAYER.API_KEY
        : HARNESS[harness].planPayer) as AgentPayer,
    })),
  ),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(SUITE)("a turn its plan's limit cuts short", (it) => {
  it.effect.each(CASES)(
    "goes on with the next payer, or at the reset, its relaunch handed the turn's line, and finishes: $name",
    ({ harness, onMac, fallback, payer }) =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const spec = HARNESS[harness];
        const { userId, agent, sessions, sequence, launches, beat } = yield* accountWith(
          harness,
          onMac,
          fallback,
        );
        const reached = reaching(userId, sessions);
        const post = yield* eventsRoute(reached);

        const sent = yield* writtenLine(agent, "Fix the invitations.");
        const opened = yield* sessions.open(sent);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED, JSON.stringify(opened));
        yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
        const [first] = yield* launches;
        assert.ok(first !== undefined);
        const limitedOn = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));

        // The first launch's turn meets its subscription's limit, which the route writes and hands the turn on past.
        const resetsAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(LIMIT_FOR);
        const limited = numbered(first.firstSequence, spec.limited(sent.lineId, resetsAt));
        sequence.next = first.firstSequence + limited.length;
        assert.equal(yield* post(first, limited), 200);
        // Where no payer has room, the turn waits for the reset, which the sweep hands on.
        if (fallback === FALLBACK.NONE) {
          assert.equal((yield* launches).length, 1);
          yield* TestClock.adjust(LIMIT_FOR);
          yield* beat;
          yield* resumeWaitedTurns(yield* Clock.currentTimeMillis).pipe(Effect.provide(reached));
        }

        const all = yield* launches;
        assert.equal(all.length, 2);
        const [, second] = all;
        assert.ok(second !== undefined);
        assert.deepEqual(second.texts, ["Fix the invitations."]);
        // The line goes to a session that already holds it, which drops a prompt under an id it holds.
        assert.deepEqual(second.resent, [true]);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.deepEqual(
          [routing.payer, routing.subscriptionId === limitedOn.subscriptionId],
          [payer, fallback === FALLBACK.NONE],
        );

        const finished = numbered(second.firstSequence, spec.finished(sent.lineId));
        assert.equal(yield* post(second, finished), 200);
        const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
          agent.conversationId,
        );
        assert.deepEqual([turn?.status, agentFailureOf(turn)], [TURN_STATUS.SETTLED, undefined]);
      }),
  );

  it.effect.each(CASES.filter((each) => each.fallback !== FALLBACK.NONE))(
    "takes a message sent before its relaunch, which the relaunched runner is handed after the turn's line: $name",
    ({ harness, onMac, fallback }) =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const spec = HARNESS[harness];
        const { userId, agent, sessions, sequence, launches } = yield* accountWith(
          harness,
          onMac,
          fallback,
        );
        const reached = reaching(userId, sessions);
        const kept = keptAfterResponse();
        const post = yield* eventsRoute(reached, kept.layer);

        const sent = yield* writtenLine(agent, "Fix the invitations.");
        const opened = yield* sessions.open(sent);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
        const [first] = yield* launches;
        assert.ok(first !== undefined);
        const resetsAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(LIMIT_FOR);
        const limited = numbered(first.firstSequence, spec.limited(sent.lineId, resetsAt));
        sequence.next = first.firstSequence + limited.length;
        assert.equal(yield* post(first, limited), 200);

        // Another agent's message arrives while the turn waits for its launch on the next payer.
        const steer = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Also the emails."),
        );
        yield* kept.run;

        assert.equal(steer.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        const [, second] = yield* launches;
        assert.deepEqual(second?.texts, ["Fix the invitations.", "Also the emails."]);
      }),
  );

  it.effect(
    "whose relaunch on the next payer never takes it up fails, past its deadline, for the plan's limit rather than as a stuck agent",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const spec = HARNESS[CONVERSATION_RUNTIME.CLAUDE_CODE];
        const { userId, agent, api, sessions, sequence, launches } = yield* accountWith(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
          FALLBACK.API_KEY,
        );
        const post = yield* eventsRoute(reaching(userId, sessions));
        const sent = yield* writtenLine(agent, "Fix the invitations.");
        const opened = yield* sessions.open(sent);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);
        const [first] = yield* launches;
        assert.ok(first !== undefined);
        const resetsAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(LIMIT_FOR);
        const limited = numbered(first.firstSequence, spec.limited(sent.lineId, resetsAt));
        sequence.next = first.firstSequence + limited.length;
        assert.equal(yield* post(first, limited), 200);
        assert.equal((yield* launches).length, 2);

        // The relaunch on the account's key never posts, as the runner of LUKE's turn on Nov 9 never did.
        yield* TestClock.adjust(
          Duration.millis(TURN_DEADLINE.PICKUP_MS + TURN_DEADLINE.PROGRESS_MS + 1),
        );
        yield* reconcileAgent(agent).pipe(Effect.provide(api.layer));

        const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
          agent.conversationId,
        );
        assert.deepEqual(
          [turn?.status, agentFailureOf(turn)],
          [TURN_STATUS.FAILED, AGENT_FAILURE.PLAN_LIMIT],
        );
      }),
  );
});
