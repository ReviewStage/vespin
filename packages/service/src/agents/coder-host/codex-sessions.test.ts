import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  CODEX_PLAN_BACKEND,
  type CodexConfig,
  INPUT_LINE,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import { readAgentRunnerRecord } from "@repo/database/models/agent-runner-record";
import {
  type Agent,
  createAgent,
  readAgentRouting,
  recordAgentNativeSession,
  updateAgentChoice,
  updateAgentPermissionModeCommitted,
} from "@repo/database/models/agent-store";
import { appendSessionEntries } from "@repo/database/models/claude-session-entries";
import { registerDevice } from "@repo/database/models/device-store";
import { recordHostVersion } from "@repo/database/models/host-store";
import {
  type KeyRing,
  parseKeyRing,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  removeProviderKey,
  saveProviderKey,
  setPlanStatus,
  setProviderKeyStatus,
} from "@repo/database/models/provider-key-store";
import { runnerLinesPast } from "@repo/database/models/runner-line-store";
import { queuedTurnOf } from "@repo/database/models/turn-state";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { deviceAgentLine } from "@repo/database/schemas/device-agent";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PERMISSION_MODE } from "@repo/features/agent-approval-wire";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { deviceAgentLaunchSecretsSchema } from "@repo/features/device-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import type { Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { fixtureToken, vercelSandboxOver } from "@repo/sandbox/vercel/testing";
import { sentLineId } from "@repo/wire/host-ids";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import {
  CHATGPT_OAUTH,
  CODEX_DEVICE_OAUTH,
  sealCodexDeviceCredentials,
} from "../../accounts/chatgpt-credentials.js";
import { TURN_ORIGIN } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { GITHUB_APP_WITH_TOKENS } from "../../testing/github-app-fake.js";
import {
  launchBearer,
  launchLines,
  linesOf,
  runnerSandboxApi,
  runnerTook,
} from "../../testing/runner-sandbox-fake.js";
import { claimedDeviceAgentLine } from "../device-agent.js";
import { agentMachinesLayer } from "../machine/agent-machines.js";
import { sandboxMachineLayer } from "../machine/sandbox-machine.js";
import {
  PLAN_REFUSAL,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
} from "../sessions/agent-sessions.js";
import { runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { AgentImage } from "./agent-image.js";
import { type CodexSessionsOptions, codexSessions } from "./codex-sessions.js";
import { RUNNER_ENDED, runnerEnded } from "./runner-sessions.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * A coding agent's sessions on Codex, against a fake of Vercel Sandbox's
 * REST API and of OpenAI's token endpoint, over a real store: on the plan,
 * the runner launched naming our token route and handed no token, the
 * account's token renewed first where less than forty-five minutes are left;
 * a local agent's launch on its Mac, sealed in its line with no token in it,
 * on the plan's route or on the Mac's own Codex sign-in; a stop and a reset; a
 * relaunch on Codex's thread after the sandbox stopped; and a sign-in OpenAI
 * signed out, or none at all, failing the launch with that refusal and
 * opening nothing. Synthetic accounts, tokens, and snapshot ids throughout.
 */

const IMAGE = "agent-image:fixture";
const EVENTS_URL = "https://app.test/api/agents/runner-events";
const LINES_URL = "https://app.test/api/agents/runner-lines";
const TRANSCRIPTS_URL = "https://app.test/api/agents/runner-transcripts";
const MCP_URL = "https://app.test/api/agents/mcp";
/** The host every address the runner reaches us at names, which the firewall swaps its bearer in on. */
const SERVICE_HOST = "app.test";

/** The one integration the agent is handed, a server of its own. */
const LINEAR_SERVER = { name: "linear", url: `${MCP_URL}/integrations/linear` };
const INSTRUCTIONS = "You are a Vespin coding agent.";
const KEK = `1:${Buffer.alloc(32, 3).toString("base64")}`;
const THREAD = "019a0b1c-2d3e-7f40-8a5b-6c7d8e9f0a1b";
const TOKEN_URL = "https://app.test/api/agents/runner-token";
/** The query every URL a runner is handed names its launch by, here the agent's first. */
const FIRST_LAUNCH = "?runnerLaunch=1";
const MINUTE = 60 * 1000;
/** The ChatGPT workspace a device-code login's ID token names. */
const WORKSPACE = "chatgpt-workspace-fixture";
/** Codex's ChatGPT backend, where a sandbox's runner sends the plan's token itself. */
const CODEX_BACKEND_HOST = "chatgpt.com";

function ring(): KeyRing {
  const parsed = parseKeyRing(Redacted.make(KEK));
  if (Result.isFailure(parsed)) return assert.fail("not a ring");
  return parsed.success;
}

/**
 * OpenAI's token endpoint as a renewal reaches it, in Codex's JSON: each
 * renewal rotates the refresh token and answers the next access token, good
 * for an hour.
 */
function openAi() {
  const state = { renewals: 0 };
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    if (url !== CODEX_DEVICE_OAUTH.TOKEN_URL) assert.fail(`an unexpected call to OpenAI: ${url}`);
    const body = await new Response(init.body).text();
    const refreshToken = (JSON.parse(body) as { readonly refresh_token?: string }).refresh_token;
    assert.equal(refreshToken, `refresh-${state.renewals}`);
    state.renewals += 1;
    return Response.json({
      access_token: `access-${state.renewals}`,
      refresh_token: `refresh-${state.renewals}`,
      expires_in: 3600,
    });
  };
  return { state, respond };
}

const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(KEK),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** The agent's machine over the fake Vercel the client given answers as, its checkout run on this test's own runner. */
function machineOver<E, R>(http: Layer.Layer<HttpClient.HttpClient | Sandbox, E, R>) {
  return sandboxMachineLayer({
    run: (effect) => Effect.runPromise(effect),
  }).pipe(Layer.provide(http));
}

/** Everything but the store: Vercel and OpenAI behind one client, the agent's machine, and the image. */
function services(
  api: ReturnType<typeof runnerSandboxApi>,
  openai: ReturnType<typeof openAi> = openAi(),
) {
  const http = Layer.provideMerge(
    vercelSandboxOver(api.respond),
    fakeHttpClientLayer((url, init) =>
      new URL(url).origin === CHATGPT_OAUTH.ISSUER
        ? openai.respond(url, init)
        : api.respond(url, init),
    ),
  );
  return Layer.mergeAll(
    http,
    machineOver(http),
    GITHUB_APP_WITH_TOKENS,
    Layer.succeed(HostedEnvironment, NO_KEYS),
    Layer.succeed(AgentImage, {
      reference: Effect.succeed(IMAGE),
      runner: Effect.succeed([]),
    }),
  );
}

/** An account with one GPT agent on a task with no repository. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "openai/gpt-6.1-sol",
    effort: "xhigh",
    descriptionSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  assert.ok(Option.isSome(started));
  return { userId, agent: started.value.agent };
});

/** The account's plan connected through Codex's device-code login, its access token `access-0` good for the minutes given. */
const signIn = (userId: string, minutesLeft: number) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const accessExpiresAt = new Date(now.getTime() + minutesLeft * MINUTE);
    const { sealed, hint } = sealCodexDeviceCredentials(ring(), userId, {
      accessToken: "access-0",
      refreshToken: "refresh-0",
      idToken: "id-token-0",
      accountId: "chatgpt-subject",
      chatgptAccountId: WORKSPACE,
      accessExpiresAt,
    });
    yield* saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      sealed,
      hint,
      null,
      now,
      accessExpiresAt,
    );
  });

function sessionsFor(userId: string, sequence: { next: number } = { next: 0 }) {
  const options: CodexSessionsOptions = {
    userId,
    eventsUrl: EVENTS_URL,
    linesUrl: LINES_URL,
    mcpUrl: MCP_URL,
    transcriptsUrl: TRANSCRIPTS_URL,
    integrations: () => Effect.succeed([LINEAR_SERVER]),
    instructions: () => Effect.succeed(INSTRUCTIONS),
    nextSequence: () => Effect.sync(() => sequence.next),
    tokenUrl: TOKEN_URL,
  };
  return codexSessions(options);
}

/** What the newest policy the sandbox's firewall was sent sets on the host given: OpenAI's API, unless another is named. */
const openAiRules = (api: ReturnType<typeof runnerSandboxApi>, host = "api.openai.com") => {
  const policy = api.policies.at(-1)?.policy as
    | { readonly allow?: Readonly<Record<string, unknown>> }
    | undefined;
  return policy?.allow?.[host];
};

/** The swap the firewall carries for a credential: its bearer set where a request carries the placeholder's. */
const swapRule = (placeholder: string, credential: string) => ({
  match: {
    headers: [{ key: { exact: "authorization" }, value: { exact: `Bearer ${placeholder}` } }],
  },
  transform: [{ headers: { authorization: `Bearer ${credential}` } }],
});

/** The developer's words of a message line: what follows the turn's own words, which lead every message (`turn-message.ts`). */
const developerContent = (line: InputLine | undefined) =>
  line?.type === INPUT_LINE.MESSAGE ? line.content.slice(1) : [];

const message = (agent: Agent, text: string, lineId?: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
  ...(lineId === undefined ? undefined : { lineId }),
});

/** A message written as the line awaiting the turn its send queues, as a steer's is (`steer.ts`), and handed on under its line id. */
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

/** What the launch reads past its config: its own lines, and the messages no earlier launch took, as its runner is handed them. */
const handedLines = (userId: string, command: Parameters<typeof launchLines>[0]) =>
  Effect.gen(function* () {
    const [config] = (yield* launchLines(command)) as [CodexConfig];
    assert.ok(command?.agentId !== undefined);
    const read = yield* runnerLinesPast(userId, command.agentId, {
      launch: config.firstSequence,
      after: 0,
      limit: 50,
    });
    return read.map((line) => JSON.parse(line.text) as InputLine);
  });

/** A turn of the agent's under way, as the events route queues one, by the id a Stop names it by. */
const turnUnderWay = (userId: string, agent: Agent) =>
  Effect.gen(function* () {
    // The turn a line queued, as a Start's, is the one its runner takes up; one is queued where none stands.
    const queued = yield* queuedTurnOf(agent.conversationId);
    const turnId = Option.getOrElse(queued, () => randomUUID());
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.enqueueTurn(
      { userId, conversationId: agent.conversationId },
      { turnId, runtimeTurnId: turnId, origin: TURN_ORIGIN.TYPED },
    );
    return turnId;
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(SUITE)("a coding agent's sessions on Codex", (it) => {
  it.effect(
    "a local agent's launch on its Mac runs the Codex the Mac checked in its folder, sealed in its line with no token in it, on the plan naming the token route",
    () =>
      Effect.gen(function* () {
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        yield* signIn(userId, 60);
        const deviceId = randomUUID();
        const codexExecutable = "/Users/fixture/Library/Application Support/Vespin/codex/bin/codex";
        yield* registerDevice(userId, {
          id: deviceId,
          name: "Studio",
          ...DEVICE_LAYOUT,
          codexExecutable,
        });
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const localAgent = (payer: (typeof AGENT_PAYER)[keyof typeof AGENT_PAYER]) =>
          Effect.map(
            createAgent(userId, {
              taskId: task.id,
              idempotencyKey: randomUUID(),
              model: "openai/gpt-6.1-sol",
              effort: "xhigh",
              descriptionSnapshot: "# Teammate invitations\n",
              prompt: null,
              repository: null,
              runtime: CONVERSATION_RUNTIME.CODEX,
              payer,
              machine: AGENT_MACHINE.DEVICE,
              deviceId,
            }),
            (started) => Option.getOrThrow(started).agent,
          );
        const http = fakeHttpClientLayer(() => assert.fail("a local launch reaches no network"));
        const machines = agentMachinesLayer({
          run: (effect) => Effect.runPromise(effect),
        }).pipe(Layer.provide(http));
        /** The agent's launch, its line's row as stored and its secrets as the Mac's claim opens them. */
        const launched = (agent: Agent) =>
          Effect.gen(function* () {
            // Note that the machines are provided innermost, so the Mac's machine answers rather than the fake sandbox's.
            const sessions = yield* sessionsFor(userId).pipe(
              Effect.provide(machines),
              Effect.provide(services(runnerSandboxApi())),
            );
            const opened = yield* deliveredOpen(
              sessions,
              yield* writtenLine(agent, "Fix the invitations."),
            );
            assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
            const db = yield* Database;
            const [row] = yield* db
              .select()
              .from(deviceAgentLine)
              .where(eq(deviceAgentLine.agentId, agent.id));
            assert.ok(row !== undefined);
            const claimed = Option.getOrThrow(
              yield* claimedDeviceAgentLine(userId, deviceId, row.id).pipe(
                Effect.provide(Layer.succeed(HostedEnvironment, NO_KEYS)),
              ),
            );
            assert.ok("secrets" in claimed);
            const secrets = Schema.decodeUnknownSync(deviceAgentLaunchSecretsSchema)(
              claimed.secrets,
            );
            const [config] = secrets.stdin
              .trimEnd()
              .split("\n")
              .map((line: string): CodexConfig => JSON.parse(line));
            assert.ok(config !== undefined);
            return { stored: JSON.stringify(row), secrets, config };
          });

        const onPlan = yield* localAgent(AGENT_PAYER.CHATGPT_SUBSCRIPTION);
        const plan = yield* launched(onPlan);
        // The runner is told Codex's ChatGPT backend and the workspace, and handed no token.
        assert.deepEqual(plan.secrets.env, {
          [RUNNER_ENV.CODEX_PLAN_BACKEND]: CODEX_PLAN_BACKEND.CHATGPT,
          [RUNNER_ENV.CHATGPT_ACCOUNT_ID]: WORKSPACE,
          [RUNNER_ENV.BEARER]: plan.secrets.env[RUNNER_ENV.BEARER],
        });
        assert.equal(plan.config.executable, codexExecutable);
        assert.equal(plan.config.tokenUrl, `${TOKEN_URL}${FIRST_LAUNCH}`);
        const bearer = plan.secrets.env[RUNNER_ENV.BEARER] ?? "";
        // A Mac has no firewall of ours, so its runner is handed the bearer itself.
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, onPlan.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
        // The bearer is sealed in the row, and no token of the plan's is in the row or the launch at all.
        for (const secret of ["access-0", "refresh-0", "id-token-0", bearer]) {
          assert.equal(plan.stored.includes(secret), false, "a secret in the row in the clear");
        }
        assert.equal(JSON.stringify(plan.secrets).includes("access-0"), false);
        // A Mac whose host bundles a runner from before the transcript store keeps its threads on its disk alone.
        assert.equal(plan.config.transcriptsUrl, undefined);

        // From the host release whose runner mirrors them, they are kept at the service, its Codex home
        // named at its default under the agent's own home, which the runner mirrors from.
        yield* recordHostVersion(deviceId, "0.11.0");
        const onKept = yield* localAgent(AGENT_PAYER.CHATGPT_SUBSCRIPTION);
        const kept = yield* launched(onKept);
        assert.deepEqual(
          [kept.config.transcriptsUrl, kept.secrets.env.CODEX_HOME],
          [
            `${TRANSCRIPTS_URL}${FIRST_LAUNCH}`,
            `/Users/fixture/.vespin/agents/${onKept.id}/home/.codex`,
          ],
        );
      }),
  );

  it.effect(
    "a launch's fingerprint digests the credential its machine handed it as it did before the machine decided: the key itself where it is held at a sandbox's firewall or handed to a Mac, and on the plan no credential at all, which the runner asks our route for",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const apiKey = "sk-proj-fixture-account-key";
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        yield* signIn(userId, 60);
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };
        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring(), owner, Redacted.make(apiKey)),
          "sk-proj…-key",
          null,
          new Date(0),
        );
        const deviceId = randomUUID();
        yield* registerDevice(userId, {
          id: deviceId,
          name: "Studio",
          ...DEVICE_LAYOUT,
          codexExecutable: "/Users/fixture/Library/Application Support/Vespin/codex/bin/codex",
        });
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const agentOn = (
          payer: (typeof AGENT_PAYER)[keyof typeof AGENT_PAYER],
          machine: (typeof AGENT_MACHINE)[keyof typeof AGENT_MACHINE],
        ) =>
          Effect.map(
            createAgent(userId, {
              taskId: task.id,
              idempotencyKey: randomUUID(),
              model: "openai/gpt-6.1-sol",
              effort: "xhigh",
              descriptionSnapshot: "# Teammate invitations\n",
              prompt: null,
              repository: null,
              runtime: CONVERSATION_RUNTIME.CODEX,
              payer,
              machine,
              ...(machine === AGENT_MACHINE.DEVICE ? { deviceId } : undefined),
            }),
            (started) => Option.getOrThrow(started).agent,
          );
        const machines = agentMachinesLayer({
          run: (effect) => Effect.runPromise(effect),
        }).pipe(
          Layer.provide(
            fakeHttpClientLayer(() => assert.fail("a local launch reaches no network")),
          ),
        );
        /** The fingerprint the agent's first launch recorded: in its sandbox's runner record, or in its Mac's launch line. */
        const fingerprintOf = (agent: Agent) =>
          Effect.gen(function* () {
            const local = agent.machine === AGENT_MACHINE.DEVICE;
            const sessions = yield* sessionsFor(userId).pipe(
              local ? Effect.provide(machines) : (effect) => effect,
              Effect.provide(services(runnerSandboxApi())),
            );
            const opened = yield* deliveredOpen(
              sessions,
              yield* writtenLine(agent, "Fix the invitations."),
            );
            assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
            const db = yield* Database;
            if (local) {
              const [line] = yield* db
                .select({ payload: deviceAgentLine.payload })
                .from(deviceAgentLine)
                .where(eq(deviceAgentLine.agentId, agent.id));
              return (line?.payload as { readonly fingerprint?: string } | undefined)?.fingerprint;
            }
            const record = yield* readAgentRunnerRecord(userId, opened.sessionId);
            return Option.getOrUndefined(record)?.fingerprint;
          });

        // The plan pays while its sign-in has room, and the key once it is at its limit.
        const sandboxPlan = yield* fingerprintOf(
          yield* agentOn(AGENT_PAYER.CHATGPT_SUBSCRIPTION, AGENT_MACHINE.VERCEL),
        );
        const macPlan = yield* fingerprintOf(
          yield* agentOn(AGENT_PAYER.CHATGPT_SUBSCRIPTION, AGENT_MACHINE.DEVICE),
        );
        const now = yield* DateTime.nowAsDate;
        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          PROVIDER_KEY_STATUS.LIMIT_REACHED,
          new Date(now.getTime() + 30 * 60_000),
          now,
          now,
        );

        // Each digest but the sandbox plan's is the one a launch recorded before its machine handed its
        // credential over, so a warm runner launched then is not relaunched for it: the first 32 hex
        // characters of the SHA-256 of
        // `{"env":[…sorted entries],"names":["linear"],"held":{"slot":…,"credential":…}}`, worked by
        // hand, `held` absent on a Mac and on the plan. A sandbox's plan held its slot at the firewall
        // before it signed in on host-supplied tokens, so its warm runner relaunches once to do so.
        assert.deepEqual(
          {
            sandboxKey: yield* fingerprintOf(
              yield* agentOn(AGENT_PAYER.API_KEY, AGENT_MACHINE.VERCEL),
            ),
            sandboxPlan,
            macKey: yield* fingerprintOf(yield* agentOn(AGENT_PAYER.API_KEY, AGENT_MACHINE.DEVICE)),
            macPlan,
          },
          {
            sandboxKey: "6b61996f589fd234bed48d87b442c8b9",
            sandboxPlan: "e772975c0b503f36d76b5d0fc2cf1ad7",
            macKey: "3f16ad6f5312b44aa95199a2436df31f",
            macPlan: "70d33426f2bcfa677ec90b7a985a3e46",
          },
        );
      }),
  );

  it.effect(
    "open launches the runner in its Codex mode on the account's plan, which it asks our token route for, with no token of the plan's at the firewall or in the sandbox and the bearer's placeholder in its environment alone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        yield* updateAgentPermissionModeCommitted(userId, agent.id, AGENT_PERMISSION_MODE.AUTO);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));
        const line = yield* writtenLine(agent, "Fix the invitations.");
        const { lineId } = line;
        assert.ok(lineId !== undefined);

        const opened = yield* deliveredOpen(sessions, line);

        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.match(opened.sessionId, /^codex-[0-9a-f]{12}-[0-9a-f-]{36}$/u);
        const [sandbox] = api.sandboxes;
        assert.equal(sandbox?.tags.sessionId, opened.sessionId);
        // A token with an hour left is launched on as it stands.
        assert.equal(openai.state.renewals, 0);

        const [command] = api.commands;
        assert.ok(command !== undefined);
        assert.equal(command.user, "agent");
        assert.equal(command.env.CODEX_HOME, "/home/agent/.codex");
        assert.equal(command.env[RUNNER_ENV.CLAUDE_TOKEN], undefined);
        assert.equal(command.env[RUNNER_ENV.CODEX_PLAN_BACKEND], CODEX_PLAN_BACKEND.CHATGPT);
        assert.equal(command.env[RUNNER_ENV.CHATGPT_ACCOUNT_ID], WORKSPACE);
        // The runner holds the placeholder, which the firewall standing as it started swaps on our
        // host for the bearer whose digest the agent's row records.
        const placeholder = command.env[RUNNER_ENV.BEARER];
        const bearer = launchBearer(api, command, SERVICE_HOST);
        assert.ok(placeholder !== undefined && bearer !== undefined && bearer.length > 20);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
        // The runner asks our route for the plan's tokens itself, so none is set at the firewall.
        assert.equal(openAiRules(api, CODEX_BACKEND_HOST), undefined);
        assert.equal(openAiRules(api), undefined);

        const [config, first] = (yield* launchLines(command)) as [CodexConfig, InputLine];
        assert.deepEqual(config, {
          harness: RUNNER_HARNESS.CODEX,
          cwd: "/workspace/repository",
          executable: "/usr/local/bin/codex",
          model: "gpt-6.1-sol",
          effort: "xhigh",
          developerInstructions: INSTRUCTIONS,
          firstSequence: 0,
          eventsUrl: `${EVENTS_URL}${FIRST_LAUNCH}`,
          linesUrl: `${LINES_URL}${FIRST_LAUNCH}`,
          mcpUrl: MCP_URL,
          transcriptsUrl: `${TRANSCRIPTS_URL}${FIRST_LAUNCH}`,
          integrations: [LINEAR_SERVER],
          tokenUrl: `${TOKEN_URL}${FIRST_LAUNCH}`,
          installedSkills: "/opt/agent/installed-skills",
          permissionMode: PERMISSION_MODE.AUTO,
          warm: true,
        });
        assert.ok(first.type === INPUT_LINE.MESSAGE);
        assert.equal(first.uuid, lineId);
        assert.deepEqual(developerContent(first), [{ type: "text", text: "Fix the invitations." }]);
        // No token anywhere in the command, the placeholder only in its environment, and the bearer nowhere in the sandbox.
        assert.equal(JSON.stringify(command).includes("access-0"), false);
        const visible = JSON.stringify([
          command.args,
          yield* launchLines(command),
          api.sandboxes,
          api.uploads.flatMap((upload) => [...upload.values()]),
        ]);
        for (const secret of ["access-0", "refresh-0", "id-token-0", placeholder, bearer]) {
          assert.equal(visible.includes(secret), false, "a secret outside the environment");
        }
        assert.equal(JSON.stringify(command.env).includes(bearer), false);
      }),
  );

  it.effect(
    "an agent its starter's OpenAI API key pays for launches with a placeholder as OPENAI_API_KEY, the key held at the firewall, an Ultrafast version on the ultrafast tier, never asks the plan, and is refused once the key is gone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const apiKey = "sk-proj-fixture-account-key";
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const started = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "openai/gpt-6.1-sol-ultrafast",
          effort: "xhigh",
          descriptionSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CODEX,
          payer: AGENT_PAYER.API_KEY,
        });
        assert.ok(Option.isSome(started));
        const agent = started.value.agent;
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };
        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring(), owner, Redacted.make(apiKey)),
          "sk-proj…-key",
          null,
          new Date(0),
        );

        // No ChatGPT sign-in at all: an agent on its key never asks one, so OpenAI's token endpoint is never called.
        const api = runnerSandboxApi();
        const openai = openAi();
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));
        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        const [command] = api.commands;
        assert.ok(command !== undefined);
        const placeholder = command.env[RUNNER_ENV.OPENAI_API_KEY];
        assert.ok(placeholder !== undefined && placeholder.length > 20);
        assert.deepEqual(openAiRules(api), [swapRule(placeholder, apiKey)]);
        assert.equal(command.env.CODEX_HOME, "/home/agent/.codex");
        // An Ultrafast version runs its base model on Codex's ultrafast tier, and on its fast one where the runner predates it.
        const [config] = linesOf(command) as [CodexConfig];
        assert.equal(config.model, "gpt-6.1-sol");
        assert.deepEqual([config.fast, config.ultrafast], [true, true]);
        const visible = JSON.stringify([command, api.sandboxes]);
        assert.equal(visible.includes(apiKey), false);
        assert.equal(
          (yield* sessions.send(opened.sessionId, message(agent, "Also the emails."))).outcome,
          SESSION_SEND_OUTCOME.ACCEPTED,
        );
        assert.equal(openai.state.renewals, 0);

        yield* removeProviderKey(userId, owner.provider, owner.kind);
        const gone = runnerSandboxApi();
        const without = yield* sessionsFor(userId).pipe(Effect.provide(services(gone)));
        assert.equal(
          (yield* deliveredOpen(without, yield* writtenLine(agent, "Go."))).outcome,
          SESSION_SEND_OUTCOME.FAILED,
        );
        assert.deepEqual(gone.commands, []);
      }),
  );

  it.effect(
    "a token with less than forty-five minutes left is renewed before the launch, and handed to the runner nowhere",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        // Past the store's own ten-minute margin, and past the old launch margin of fifteen, but short of forty-five.
        yield* signIn(userId, 40);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(openai.state.renewals, 1);
        assert.equal(JSON.stringify([api.commands, api.sandboxes]).includes("access-1"), false);
        const [row] = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        const now = (yield* DateTime.nowAsDate).getTime();
        assert.equal(row?.accessExpiresAt?.getTime(), now + 60 * MINUTE);
      }),
  );

  it.effect(
    "send writes the agent's model and effort as they stand and the message; cancel writes stop; reset deletes the sandbox and retires the bearer",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api)));
        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* updateAgentChoice(userId, agent.id, {
          model: "openai/gpt-4.1",
          effort: "low",
        });

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        const canceled = yield* sessions.cancel(
          opened.sessionId,
          yield* turnUnderWay(userId, agent),
        );

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(canceled.outcome, SESSION_CANCEL_OUTCOME.ACCEPTED);
        const lines = (yield* launchLines(api.commands[0])).slice(2) as InputLine[];
        assert.deepEqual(lines[0], {
          type: INPUT_LINE.MODEL,
          model: "gpt-4.1",
          fast: false,
          effort: "low",
        });
        assert.equal(lines[1]?.type, INPUT_LINE.MESSAGE);
        assert.deepEqual(lines[2], { type: INPUT_LINE.STOP, launch: 0 });
        // The runner took its lines, so nothing of the session waits on a launch once it is reset.
        yield* runnerTook(agent.id);

        const reset = yield* sessions.reset(opened.sessionId);

        assert.equal(reset.outcome, SESSION_RESET_OUTCOME.RESET);
        assert.equal(api.sandboxes[0]?.deleted, true);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, null);
        assert.deepEqual(yield* sessions.send(opened.sessionId, message(agent, "Hello?")), {
          outcome: SESSION_SEND_OUTCOME.RETIRED,
        });
      }),
  );

  it.effect(
    "after the sandbox stopped, the next message resumes it and relaunches the runner on Codex's thread, the next event number, a fresh bearer, and a token renewed where it is due",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(
          Effect.provide(services(api, openai)),
        );
        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        // The events route records Codex's thread as the runner reports it, the store holding its
        // rollout from its first line as the runner mirrors it, and the run ends.
        assert.equal(yield* recordAgentNativeSession(userId, agent.id, THREAD), true);
        yield* appendSessionEntries(
          userId,
          agent.conversationId,
          { projectKey: "codex", sessionId: THREAD, subpath: `sessions/rollout-${THREAD}.jsonl` },
          [{ type: "session_meta", payload: { id: THREAD } }],
        );
        yield* runnerTook(agent.id);
        const [first] = api.commands;
        const firstBearer = launchBearer(api, first, SERVICE_HOST);
        sequence.next = 17;
        const ended = yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 16,
        }).pipe(Effect.provide(services(api, openai)));
        assert.equal(ended, RUNNER_ENDED.LEFT);
        api.idleStop();
        yield* TestClock.adjust("55 minutes");

        const sent = yield* sessions.send(
          opened.sessionId,
          yield* writtenLine(agent, "Now the emails."),
        );
        // The turn the message awaits is delivered, as the agent-turns consumer hands it over (`turn-delivery.ts`).
        yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);

        assert.equal(sent.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 1);
        assert.equal(api.sandboxes[0]?.status, "running");
        assert.equal(api.commands.length, 2);
        const relaunch = api.commands[1];
        assert.equal(relaunch?.sandboxSessionId, api.sandboxes[0]?.currentSessionId);
        assert.equal(openai.state.renewals, 1);
        const [config] = (yield* launchLines(relaunch)) as [CodexConfig];
        const [line] = yield* handedLines(userId, relaunch);
        assert.equal(config.harness, RUNNER_HARNESS.CODEX);
        assert.equal(config.threadId, THREAD);
        assert.equal(config.firstSequence, 17);
        assert.ok(line?.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Now the emails." }]);
        // A fresh bearer for the new launch at the resumed session's firewall, recorded in place of the last.
        const bearer = launchBearer(api, relaunch, SERVICE_HOST);
        assert.ok(bearer !== undefined && bearer !== firstBearer);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
      }),
  );

  it.effect(
    "a sign-in OpenAI signed out, or none, fails the launch with that refusal, deletes its sandbox and starts no runner",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        const none = runnerSandboxApi();
        const withoutSignIn = yield* sessionsFor(userId).pipe(Effect.provide(services(none)));
        assert.deepEqual(yield* deliveredOpen(withoutSignIn, yield* writtenLine(agent, "Go.")), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.NONE,
        });
        assert.ok(none.sandboxes.every((sandbox) => sandbox.deleted));
        assert.deepEqual(none.commands, []);

        yield* signIn(userId, 60);
        const [row] = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        assert.ok(row !== undefined);
        yield* setProviderKeyStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          row.sealedKey,
          PROVIDER_KEY_STATUS.INVALID,
          yield* DateTime.nowAsDate,
        );
        const invalid = runnerSandboxApi();
        const openai = openAi();
        const signedOut = yield* sessionsFor(userId).pipe(
          Effect.provide(services(invalid, openai)),
        );

        assert.deepEqual(yield* deliveredOpen(signedOut, yield* writtenLine(agent, "Go.")), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.ok(invalid.sandboxes.every((sandbox) => sandbox.deleted));
        assert.deepEqual(invalid.commands, []);
        assert.equal(openai.state.renewals, 0);
      }),
  );

  it.effect(
    "a plan whose limit a turn reached refuses the launch by name until the reset it named, then launches; an account OpenAI said is not eligible refuses by name; neither starts a runner while refused",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const now = yield* DateTime.nowAsDate;
        const resetsAt = new Date(now.getTime() + 30 * 60_000);
        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          PROVIDER_KEY_STATUS.LIMIT_REACHED,
          resetsAt,
          now,
          now,
        );
        const limited = runnerSandboxApi();
        const limitedSessions = yield* sessionsFor(userId).pipe(Effect.provide(services(limited)));
        assert.deepEqual(yield* deliveredOpen(limitedSessions, yield* writtenLine(agent, "Go.")), {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
          planResetsAt: resetsAt.getTime(),
        });
        assert.deepEqual(limited.commands, []);

        yield* TestClock.adjust("31 minutes");
        const reset = runnerSandboxApi();
        const resetSessions = yield* sessionsFor(userId).pipe(
          Effect.provide(services(reset, openAi())),
        );
        const reopened = yield* deliveredOpen(resetSessions, yield* writtenLine(agent, "Go."));
        assert.equal(reopened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        assert.notDeepEqual(reset.commands, []);

        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          PROVIDER_KEY_STATUS.INELIGIBLE,
          undefined,
          yield* DateTime.nowAsDate,
          yield* DateTime.nowAsDate,
        );
        const ineligible = runnerSandboxApi();
        const ineligibleSessions = yield* sessionsFor(userId).pipe(
          Effect.provide(services(ineligible)),
        );
        assert.deepEqual(
          yield* deliveredOpen(ineligibleSessions, yield* writtenLine(agent, "Go on.")),
          {
            outcome: SESSION_SEND_OUTCOME.FAILED,
            status: 422,
            planRefusal: PLAN_REFUSAL.INELIGIBLE,
          },
        );
        assert.deepEqual(ineligible.commands, []);
      }),
  );

  it.effect(
    "on the plan, the launch names the token route and hands the runner no token, a token with fifty minutes left goes as it stands, and a message renews it where it is due",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 50);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));

        const opened = yield* deliveredOpen(
          sessions,
          yield* writtenLine(agent, "Fix the invitations."),
        );
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        assert.equal(openai.state.renewals, 0);
        // Ten minutes on, forty are left: renewed ahead of the message, and handed on nowhere.
        yield* TestClock.adjust("10 minutes");
        yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        assert.equal(openai.state.renewals, 1);

        const [command] = api.commands;
        assert.equal(command?.env.CODEX_HOME, "/home/agent/.codex");
        const lines = linesOf(command) as [CodexConfig, ...InputLine[]];
        assert.equal(lines[0].tokenUrl, `${TOKEN_URL}${FIRST_LAUNCH}`);
        const visible = JSON.stringify([command, api.sandboxes]);
        for (const secret of ["access-0", "access-1", "refresh-1"]) {
          assert.equal(visible.includes(secret), false, "a token handed to the runner");
        }
      }),
  );
});
