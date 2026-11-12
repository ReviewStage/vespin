/**
 * codex.test.ts -- one Codex launch of the runner against a scripted app-server playing P16's recorded notifications and a fake service: the config line in, app-server started with the plan's provider, messages as turns and steers, Stop as an interrupt, a refreshed token as a restart between turns or, on a host's plan, the runner's token command run again mid-turn, and in a sandbox app-server signed in on host-supplied tokens and refreshed on asking, every notification out in order, and the launch's end at the turn's.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import {
  type Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Match,
  Predicate,
  Queue,
  Stream,
} from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { CODEX_BUNDLED_MODELS_JSON } from "./codex-protocol/bundled-models.js";
import {
  APPROVAL_BY,
  APPROVAL_DECISION,
  CODEX_EFFORT,
  CONNECTION_LOST_DETAIL,
  type CodexConfig,
  connectionLostFailure,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_PLACE,
  RUNNER_RECONNECT,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import {
  type Exchange,
  fakeAppServer,
  type RecordedMessage,
  received,
  recordedExchanges,
  type Script,
  type Spawned,
} from "./testing/fake-app-server.js";
import {
  fakeCheckoutSnapshots,
  fakeFilesOf,
  fakeSnapshotOf,
} from "./testing/fake-checkout-snapshots.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { fakeProbe } from "./testing/fake-probe.js";
import { makeFakeService } from "./testing/fake-service.js";

const BEARER = "runner-bearer-for-tests";
const EVENTS_URL = "https://app.test/runner/events";
const FIRST_SEQUENCE = 11;
const THREAD = "00000000-0000-4000-8000-000000000002";

it.effect(
  "on an OpenAI API key, app-server reads it through the provider's env_key, no command inherits it, no event carries it, and a model line moving to an Ultrafast version runs the next turn on the ultrafast tier its own catalog lists",
  () =>
    Effect.gen(function* () {
      // Note that in a sandbox this is the launch's placeholder, the key itself set at its firewall, which the runner reads alike.
      const apiKey = "openai-api-key-for-tests";
      const service = fakeService("sleep 600");

      // On its API key it asks no token.
      const { spawned, write, run } = yield* launch([STOPPED], service, {
        ...SANDBOX_ENV,
        [RUNNER_ENV.OPENAI_API_KEY]: apiKey,
      });

      yield* write({ ...CONFIG, model: "gpt-6.1-sol", fast: true });
      yield* write({ type: INPUT_LINE.MODEL, fast: true, ultrafast: true });
      yield* write(message("Run sleep 600.", LINE.FIRST));
      yield* service.seen;
      // The catalog app-server reads in place of its bundled one, while it runs: every bundled model, each listing Ultrafast.
      const catalogPath = JSON.parse(override(spawned[0], "model_catalog_json") ?? '""');
      const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
      const bundled = JSON.parse(CODEX_BUNDLED_MODELS_JSON);
      assert.deepEqual(
        catalog.models.map((model: { slug: string }) => model.slug),
        bundled.models.map((model: { slug: string }) => model.slug),
      );
      const sol = catalog.models.find((model: { slug: string }) => model.slug === "gpt-6.1-sol");
      assert.ok(sol.service_tiers.some((tier: { id: string }) => tier.id === "ultrafast"));
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      assert.ok(!existsSync(catalogPath), "the launch removes its catalog as it ends");
      const [process] = spawned;
      const overrides = (process?.args ?? []).filter((_, index, args) => args[index - 1] === "-c");
      assert.deepEqual(
        overrides.filter((each) => each.startsWith("model_provider")),
        [
          'model_provider="openai_api_key"',
          'model_providers.openai_api_key.name="OpenAI API key"',
          'model_providers.openai_api_key.base_url="https://api.openai.com/v1"',
          'model_providers.openai_api_key.env_key="OPENAI_API_KEY"',
          'model_providers.openai_api_key.wire_api="responses"',
          "model_providers.openai_api_key.requires_openai_auth=false",
          "model_providers.openai_api_key.supports_websockets=false",
        ],
      );
      assert.ok(
        overrides.includes(
          'shell_environment_policy.exclude=["APP_RUNNER_TOKEN", "OPENAI_API_KEY"]',
        ),
      );
      // An Ultrafast version runs on Codex's ultrafast tier, turned on beside the fast one.
      assert.ok(overrides.includes("features.fast_mode=true"));
      assert.ok(overrides.includes("features.ultrafast_mode=true"));
      assert.equal(received(process, "turn/start")[0]?.serviceTier, "ultrafast");
      assert.equal(process?.env[RUNNER_ENV.OPENAI_API_KEY], apiKey);
      assert.ok(!(process?.args ?? []).join(" ").includes(apiKey));
      assert.ok(!JSON.stringify(service.applied).includes(apiKey));
    }),
);

const TOKEN_URL = "https://app.test/api/agents/runner-token";

/** A launch on a host, which runs Codex on the machine's own login. */
const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST,
  CODEX_HOME: "/home/agent/.codex",
  PATH: "/usr/bin",
};

/** A launch in the cloud's sandbox, whose bearer is the launch's placeholder and whose plan is signed in on host-supplied tokens. */
const SANDBOX_ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  CODEX_HOME: "/home/agent/.codex",
  PATH: "/usr/bin",
};

const CONFIG: CodexConfig = {
  harness: RUNNER_HARNESS.CODEX,
  cwd: "/srv/agent-probe-repo",
  agentId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  executable: "/opt/agent-codex/bin/codex",
  model: "gpt-5.5",
  effort: CODEX_EFFORT.HIGH,
  developerInstructions: "You are a Vespin coding agent.",
  firstSequence: FIRST_SEQUENCE,
  eventsUrl: EVENTS_URL,
  mcpUrl: "https://app.test/runner/mcp",
  integrations: [{ name: "linear", url: "https://app.test/runner/mcp/integrations/linear" }],
  tokenUrl: TOKEN_URL,
};

/** A message line of text alone, under the service's id for the line where one is given. */
function message(text: string, uuid?: string): InputLine {
  const line = { type: INPUT_LINE.MESSAGE, content: [{ type: "text" as const, text }] };

  return uuid === undefined ? line : { ...line, uuid };
}

/** P16's first phase: initialize, initialized, thread/start, turn/start, turn/steer, turn/start, turn/interrupt. */
const FIRST = recordedExchanges("first");

/** P16's resumed phase, after a restart: initialize, initialized, thread/resume, turn/start. */
const RESUMED = recordedExchanges("resumed");

function exchange(exchanges: readonly Exchange[], index: number): Exchange {
  const found = exchanges[index];

  if (found === undefined) throw new Error(`the recording has no exchange ${index}`);

  return found;
}

const OPEN = [exchange(FIRST, 0), exchange(FIRST, 1), exchange(FIRST, 2)];
const RESUME = [exchange(RESUMED, 0), exchange(RESUMED, 1), exchange(RESUMED, 2)];

/** The probe's first turn: an edit, a scan, an MCP call, then the CI watch a steer lands in, then completed. */
const WORKFLOW: Script = { exchanges: [...OPEN, exchange(FIRST, 3), exchange(FIRST, 4)] };

/** The probe's `sleep 600` turn, interrupted. */
const STOPPED: Script = { exchanges: [...OPEN, exchange(FIRST, 5), exchange(FIRST, 6)] };

/** The resumed turn, cut where its last two notifications (idle, turn/completed) begin. */
const RESUMED_TURN = exchange(RESUMED, 3);
const RESUMED_TURN_END = RESUMED_TURN.reply.slice(-2);

/** The method of each notification a script's replies hold, in order. */
function notified(exchanges: readonly Exchange[]): string[] {
  return exchanges.flatMap(({ reply }) =>
    reply.flatMap((line) => (line.method === undefined ? [] : [line.method])),
  );
}

/** The service's ids for the lines a test writes, as it sends them. */
const LINE = {
  FIRST: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e01",
  STEERED: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e02",
} as const;

/** The lines a launch said app-server took, in order. */
function acceptedLines(events: readonly RunnerEvent[]): string[] {
  return events.flatMap(({ message: posted }) =>
    "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED ? [posted.uuid] : [],
  );
}

/** What each applied event was: a notification's method, or one of the runner's own. */
function kinds(events: readonly RunnerEvent[]): string[] {
  return events.map(({ message: posted }) => ("method" in posted ? posted.method : posted.type));
}

/** One Codex launch over stdin lines the test writes, against scripted app-servers and a fake service. */
function launch(
  scripts: readonly Script[],
  service: ReturnType<typeof makeFakeService>,
  env: Record<string, string> = ENV,
  extra: {
    readonly http?: Layer.Layer<HttpClient.HttpClient>;
    readonly probe?: ReturnType<typeof fakeProbe>;
    /** Whether each turn changed files (`fakeFilesOf`). */
    readonly changed?: boolean;
  } = {},
) {
  return Effect.gen(function* () {
    const server = fakeAppServer(scripts);
    const claude = yield* fakeClaudeCode([]);
    const probe = extra.probe ?? fakeProbe();
    const logged: string[] = [];

    const recorder = Logger.make(({ message: logMessage }) => {
      logged.push(JSON.stringify(logMessage));
    });

    const stdin = yield* Queue.unbounded<string, Cause.Done>();
    const write = (line: CodexConfig | InputLine) => Queue.offer(stdin, JSON.stringify(line));

    const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          server.layer,
          extra.http ?? service.layer,
          claude.layer,
          probe.layer,
          fakeCheckoutSnapshots(false, extra.changed === true).layer,
          Logger.layer([recorder]),
        ),
      ),
      Effect.forkScoped,
    );

    return {
      spawned: server.spawned,
      write,
      closeStdin: Queue.end(stdin),
      run,
      logged,
      probed: probe.record,
    };
  });
}

function fakeService(watchFor?: string) {
  return makeFakeService({
    url: EVENTS_URL,
    firstSequence: FIRST_SEQUENCE,
    watchFor,
  });
}

it.effect(
  "sets the member's installed skills as an extra skills root before the thread opens, and none where Vespin wrote none",
  () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), "installed-skills-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(folder, { recursive: true })));
      const skills = join(folder, INSTALLED_SKILLS.SKILLS);
      mkdirSync(join(skills, "pr-style"), { recursive: true });

      const extraRoots: Exchange = {
        method: "skills/extraRoots/set",
        reply: [{ id: 0, result: {} }],
      };

      const withRoot: Script = {
        exchanges: [
          exchange(FIRST, 0),
          exchange(FIRST, 1),
          extraRoots,
          ...WORKFLOW.exchanges.slice(2),
        ],
      };

      const turn = (script: Script, installedSkills: string) =>
        Effect.gen(function* () {
          const service = fakeService("ci-watch");
          const { spawned, write, run } = yield* launch([script], service);
          yield* write({ ...CONFIG, installedSkills });
          yield* write(message("The probe's first turn.", LINE.FIRST));
          yield* service.seen;
          yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));
          assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);

          return spawned[0];
        });

      const withSkills = yield* turn(withRoot, folder);
      const withNone = yield* turn(WORKFLOW, join(folder, "never-written"));

      assert.deepEqual(withSkills?.unexpected, []);
      assert.deepEqual(received(withSkills, "skills/extraRoots/set"), [{ extraRoots: [skills] }]);
      // Set before the thread is opened, so the thread's first turn lists them.
      assert.deepEqual(withSkills?.received.map((each) => each.method).slice(0, 4), [
        "initialize",
        "initialized",
        "skills/extraRoots/set",
        "thread/start",
      ]);
      assert.deepEqual(withNone?.unexpected, []);
      assert.deepEqual(received(withNone, "skills/extraRoots/set"), []);

      // The roots are app-server's process-wide, so a relaunch's new app-server is set them again before its thread resumes.
      const relaunched = yield* launch(
        [
          {
            exchanges: [
              exchange(RESUMED, 0),
              exchange(RESUMED, 1),
              extraRoots,
              exchange(RESUMED, 2),
            ],
          },
        ],
        fakeService(),
      );

      yield* relaunched.write({ ...CONFIG, threadId: THREAD, installedSkills: folder });
      yield* relaunched.closeStdin;
      assert.equal(yield* Fiber.join(relaunched.run), RUNNER_END.INPUT_CLOSED);
      const [resumed] = relaunched.spawned;
      assert.deepEqual(resumed?.unexpected, []);
      assert.deepEqual(resumed?.received.map((each) => each.method).slice(0, 4), [
        "initialize",
        "initialized",
        "skills/extraRoots/set",
        "thread/resume",
      ]);
    }),
);

it.effect(
  "on a host, starts app-server on the machine's own login with none of the cloud image's tool settings, runs a fast version on the fast tier, steers the running turn, and ends at its completion",
  () =>
    Effect.gen(function* () {
      const service = fakeService("ci-watch");
      const { spawned, write, run } = yield* launch([WORKFLOW], service);
      yield* write({ ...CONFIG, fast: true });
      yield* write({
        type: INPUT_LINE.MESSAGE,
        uuid: LINE.FIRST,
        content: [
          { type: "text", text: "The probe's first turn." },
          {
            type: "image",
            source: { type: "base64", media_type: IMAGE_MEDIA_TYPE.PNG, data: "iVBORw0K" },
          },
        ],
      });
      yield* service.seen;
      // The catalog app-server reads on the plan, while it runs: every bundled model, none offering Codex's subagents, whose messages OpenAI refuses on a plan.
      const catalogOverride = override(spawned[0], "model_catalog_json");
      const catalog = JSON.parse(readFileSync(JSON.parse(catalogOverride ?? '""'), "utf8"));
      assert.deepEqual(
        catalog.models.map((model: { slug: string }) => model.slug),
        JSON.parse(CODEX_BUNDLED_MODELS_JSON).models.map((model: { slug: string }) => model.slug),
      );
      assert.ok(
        catalog.models.every((model: { slug: string }) => !("multi_agent_version" in model)),
      );
      yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(
        kinds(service.applied).filter((kind) => kind !== RUNNER_EVENT.ACCEPTED),
        [...notified(WORKFLOW.exchanges), RUNNER_EVENT.END],
      );
      // Each line is said taken once, under the service's own id, which Codex is handed to echo; the
      // first opened the turn, so its ACCEPTED carries the checkout as it stood before it, and the steer's none.
      assert.deepEqual(
        service.applied.flatMap(({ message: posted }) =>
          "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED ? [posted] : [],
        ),
        [
          {
            type: RUNNER_EVENT.ACCEPTED,
            uuid: LINE.FIRST,
            snapshot: fakeSnapshotOf(CONFIG.cwd, LINE.FIRST),
          },
          { type: RUNNER_EVENT.ACCEPTED, uuid: LINE.STEERED },
        ],
      );
      assert.deepEqual(
        service.applied.map(({ sequence }) => sequence),
        service.applied.map((_, index) => FIRST_SEQUENCE + index),
      );
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.TURN_ENDED,
      });
      assert.deepEqual(
        service.bearers,
        service.bearers.map(() => `Bearer ${BEARER}`),
      );

      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.equal(process?.program, CONFIG.executable);
      assert.equal(process?.cwd, CONFIG.cwd);
      const overrides = (process?.args ?? []).filter((_, index, args) => args[index - 1] === "-c");
      assert.deepEqual(process?.args.slice(0, 3), ["app-server", "--listen", "stdio://"]);
      assert.deepEqual(overrides, [
        "features.fast_mode=true",
        `model_catalog_json=${catalogOverride}`,
        'mcp_servers.workspace.url="https://app.test/runner/mcp"',
        'mcp_servers.workspace.bearer_token_env_var="APP_RUNNER_TOKEN"',
        'mcp_servers.workspace.default_tools_approval_mode="approve"',
        "mcp_servers.workspace.tool_timeout_sec=600.0",
        'mcp_servers.linear.url="https://app.test/runner/mcp/integrations/linear"',
        'mcp_servers.linear.bearer_token_env_var="APP_RUNNER_TOKEN"',
        'mcp_servers.linear.default_tools_approval_mode="approve"',
        "mcp_servers.linear.startup_timeout_sec=20.0",
        'mcp_servers.linear.startup_readiness="catalog"',
        "mcp_servers.linear.tool_timeout_sec=600.0",
        'approval_policy="never"',
        'sandbox_mode="danger-full-access"',
        'shell_environment_policy.inherit="all"',
        "shell_environment_policy.ignore_default_excludes=true",
        'shell_environment_policy.exclude=["APP_RUNNER_TOKEN"]',
      ]);
      // The bearer reaches app-server in its environment alone, never argv.
      assert.equal(process?.env[RUNNER_ENV.BEARER], BEARER);
      assert.equal(process?.env.CODEX_HOME, ENV.CODEX_HOME);
      assert.ok(!process?.args.some((arg) => arg.includes(BEARER)));

      assert.deepEqual(received(process, "initialize"), [
        { clientInfo: { name: "Vespin", title: "Vespin", version: "dev" }, capabilities: null },
      ]);
      assert.deepEqual(received(process, "thread/start"), [
        {
          cwd: CONFIG.cwd,
          model: CONFIG.model,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          developerInstructions: CONFIG.developerInstructions,
        },
      ]);
      const [start] = received(process, "turn/start");
      assert.equal(start?.threadId, THREAD);
      assert.equal(start?.clientUserMessageId, LINE.FIRST);
      assert.equal(start?.model, CONFIG.model);
      assert.equal(start?.effort, CODEX_EFFORT.HIGH);
      assert.equal(start?.serviceTier, "fast");
      // Every turn names its sandbox, none of Codex's own, so a thread started under another runs under this one.
      assert.equal(start?.approvalPolicy, "never");
      assert.deepEqual(start?.sandboxPolicy, { type: "dangerFullAccess" });
      assert.deepEqual(start?.input, [
        { type: "text", text: "The probe's first turn.", text_elements: [] },
        { type: "image", url: "data:image/png;base64,iVBORw0K" },
      ]);
      const [steer] = received(process, "turn/steer");
      assert.equal(steer?.clientUserMessageId, LINE.STEERED);
      assert.equal(steer?.expectedTurnId, "00000000-0000-4000-8000-000000000003");
      assert.deepEqual(steer?.input, [
        {
          type: "text",
          text: "Also, before your final reply, append the line.",
          text_elements: [],
        },
      ]);
      assert.ok(process?.ended);
    }),
);

it.effect(
  "keeps a warm launch up past its completed turn, posting IDLE with the files the turn changed, and ends it as idled on Vespin's retire",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { spawned, write, run } = yield* launch([WORKFLOW], service, ENV, { changed: true });
      yield* write({ ...CONFIG, warm: true });
      yield* write(message("The probe's first turn.", LINE.FIRST));
      yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));

      for (let step = 0; step < 5_000; step += 1) {
        if (kinds(service.applied).includes(RUNNER_EVENT.IDLE)) break;
        yield* Effect.yieldNow;
      }

      assert.equal(run.pollUnsafe(), undefined, "the launch stays up past its turn");

      yield* write({ type: INPUT_LINE.RETIRE });

      assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
      assert.deepEqual(spawned[0]?.unexpected, []);
      assert.deepEqual(kinds(service.applied).slice(-3), [
        "turn/completed",
        RUNNER_EVENT.IDLE,
        RUNNER_EVENT.END,
      ]);
      // The turn's files ride its IDLE, read from the snapshot its first line opened on; the idled END ended no turn, so carries none.
      assert.deepEqual(service.applied.at(-2)?.message, {
        type: RUNNER_EVENT.IDLE,
        files: fakeFilesOf(fakeSnapshotOf(CONFIG.cwd, LINE.FIRST).commit),
      });
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.IDLED,
      });
    }),
);

it.effect("interrupts the running turn on a stop and ends the launch as stopped", () =>
  Effect.gen(function* () {
    const service = fakeService("sleep 600");
    const { spawned, write, run } = yield* launch([STOPPED], service);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.MODEL, model: "gpt-5.5-codex", effort: CODEX_EFFORT.LOW });
    yield* write(message("Run `sleep 600` and wait for it to finish."));
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    const [start] = received(process, "turn/start");
    assert.equal(start?.model, "gpt-5.5-codex");
    assert.equal(start?.effort, CODEX_EFFORT.LOW);
    assert.deepEqual(received(process, "turn/interrupt"), [
      { threadId: THREAD, turnId: "00000000-0000-4000-8000-000000000006" },
    ]);
    assert.deepEqual(kinds(service.applied).slice(-2), ["turn/completed", RUNNER_EVENT.END]);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect("runs a message sent while a stop's interrupt is in flight as the next turn", () =>
  Effect.gen(function* () {
    const service = fakeService("sleep 600");
    // The interrupt is answered before its turn completes, as P16 recorded it; the message then starts the next turn.
    const script: Script = { exchanges: [...STOPPED.exchanges, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], service);
    yield* write(CONFIG);
    yield* write(message("Run `sleep 600` and wait for it to finish.", LINE.FIRST));
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "turn/start")[1]?.input, [
      { type: "text", text: "What exact line did you first write to PROBE.md?", text_elements: [] },
    ]);
    assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST, LINE.STEERED]);
  }),
);

it.effect(
  "a thread resumed in a sandbox that no longer holds its rollout has every file of it written back whole from the service's store first, across its pages, a revert's segment among them, and none whose subpath escapes its home",
  () =>
    Effect.gen(function* () {
      const home = mkdtempSync(join(tmpdir(), "codex-home-"));
      const subpath = `sessions/2026/11/06/rollout-2026-11-06T18-00-00-${THREAD}.jsonl`;
      const segment = subpath.replace(".jsonl", "_01a1c22e-c54f-77b3-8748-7037accf178c.jsonl");
      // A subpath another agent's runner appended, carried with its copy, names a place outside the home.
      const escaping = "../escaped.jsonl";

      const kept = [
        { type: "session_meta", payload: { id: THREAD } },
        { type: "response_item", payload: { type: "message", role: "user" } },
      ];

      const segmentKept = [
        {
          type: "session_meta",
          payload: { id: THREAD, history_base: { end_ordinal_exclusive: 1 } },
        },
      ];

      // The store answers the thread's file a line a page, so the restore joins both pages in order.
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const call = JSON.parse(String(init?.body));

        const answer = Match.value(call.call).pipe(
          Match.when("listSubkeys", () => ({ subkeys: [subpath, segment, escaping] })),
          Match.when("loadPage", () =>
            call.key.subpath === segment
              ? { entries: segmentKept, next: null }
              : call.after === null
                ? { entries: kept.slice(0, 1), next: 1 }
                : { entries: kept.slice(1), next: null },
          ),
          Match.orElse(() => ({})),
        );

        return new Response(JSON.stringify(answer));
      });
      const service = fakeService("What exact line");

      const { write, run } = yield* launch([{ exchanges: [...RESUME, RESUMED_TURN] }], service, {
        ...ENV,
        CODEX_HOME: home,
      });

      yield* write({
        ...CONFIG,
        threadId: THREAD,
        transcriptsUrl: "https://app.test/api/agents/runner-transcripts",
      });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);

      const lines = (entries: readonly unknown[]) =>
        entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");

      assert.deepEqual(
        [readFileSync(join(home, subpath), "utf8"), readFileSync(join(home, segment), "utf8")],
        [lines(kept), lines(segmentKept)],
      );
      assert.equal(existsSync(join(home, escaping)), false, "a rollout written outside the home");
      vi.restoreAllMocks();
      rmSync(home, { recursive: true, force: true });
    }),
);

it.effect(
  "resumes the thread it is given and sends a message the ended turn refused as the next turn",
  () =>
    Effect.gen(function* () {
      const service = fakeService("What exact line");

      const script: Script = {
        exchanges: [
          ...RESUME,
          { method: "turn/start", reply: RESUMED_TURN.reply.slice(0, -2) },
          {
            method: "turn/steer",
            reply: [
              { id: 4, error: { code: -32600, message: "no active turn to steer" } },
              ...RESUMED_TURN_END,
            ],
          },
          RESUMED_TURN,
        ],
      };

      const { spawned, write, run } = yield* launch([script], service);
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
      yield* service.seen;
      yield* write(message("And the second line?", LINE.STEERED));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(received(process, "thread/start"), []);
      assert.deepEqual(received(process, "thread/resume"), [
        {
          cwd: CONFIG.cwd,
          model: CONFIG.model,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          developerInstructions: CONFIG.developerInstructions,
          threadId: THREAD,
          excludeTurns: true,
        },
      ]);
      const starts = received(process, "turn/start");
      assert.equal(starts.length, 2);
      assert.deepEqual(starts[1]?.input, [
        { type: "text", text: "And the second line?", text_elements: [] },
      ]);
      assert.equal(
        starts[1]?.clientUserMessageId,
        received(process, "turn/steer")[0]?.clientUserMessageId,
      );
      assert.deepEqual(
        kinds(service.applied).filter((kind) => kind === "turn/completed").length,
        2,
      );
      // The refused steer's line is said taken when the next turn takes it, not before.
      assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST, LINE.STEERED]);

      const steeredAt = service.applied.findIndex(
        ({ message: posted }) =>
          "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED && posted.uuid === LINE.STEERED,
      );

      const firstCompletedAt = kinds(service.applied).indexOf("turn/completed");
      assert.ok(steeredAt > firstCompletedAt);
    }),
);

it.effect("forks a thread app-server will not resume on this launch's model provider", () =>
  Effect.gen(function* () {
    const service = fakeService("What exact line");
    const resumed = exchange(RESUMED, 2);

    const mismatch: RecordedMessage = {
      id: 3,
      error: {
        code: -32600,
        message: "Model provider mismatch",
        data: {
          type: "modelProviderMismatch",
          modelProvider: "vespin",
          currentModelProvider: "openai",
        },
      },
    };

    const script: Script = {
      exchanges: [
        exchange(RESUMED, 0),
        exchange(RESUMED, 1),
        { method: "thread/resume", reply: [mismatch] },
        { method: "thread/fork", reply: resumed.reply },
        RESUMED_TURN,
      ],
    };

    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(
      received(process, "thread/fork").map((params) => params.threadId),
      [THREAD],
    );
    assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST]);
  }),
);

/** The resumed launch, its second message's steer refused as said, then, where it waits, run as the next turn. */
function refusedSteer(error: NonNullable<RecordedMessage["error"]>, waits: boolean): Script {
  const refusal: RecordedMessage = { id: 4, error };

  return {
    exchanges: [
      ...RESUME,
      { method: "turn/start", reply: RESUMED_TURN.reply.slice(0, -2) },
      { method: "turn/steer", reply: waits ? [refusal, ...RESUMED_TURN_END] : [refusal] },
      ...(waits ? [RESUMED_TURN] : []),
    ],
  };
}

it.effect("sends a steer refused by a turn that cannot be steered as the next turn", () =>
  Effect.gen(function* () {
    const service = fakeService("What exact line");

    const script = refusedSteer(
      {
        code: -32600,
        message: "cannot steer a compact turn",
        data: {
          message: "cannot steer a compact turn",
          codexErrorInfo: { activeTurnNotSteerable: { turnKind: "compact" } },
          additionalDetails: null,
        },
      },
      true,
    );

    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
    yield* service.seen;
    yield* write(message("And the second line?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "turn/start")[1]?.input, [
      { type: "text", text: "And the second line?", text_elements: [] },
    ]);
    // The next turn goes on with the agent's turn the service holds, so only the line that opened it
    // carries the checkout: a record under the steer's would write over the turn's own.
    assert.deepEqual(
      service.applied.flatMap(({ message: posted }) =>
        "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED ? [posted] : [],
      ),
      [
        {
          type: RUNNER_EVENT.ACCEPTED,
          uuid: LINE.FIRST,
          snapshot: fakeSnapshotOf(CONFIG.cwd, LINE.FIRST),
        },
        { type: RUNNER_EVENT.ACCEPTED, uuid: LINE.STEERED },
      ],
    );
  }),
);

it.effect("ends the launch as failed when app-server refuses a steer for any other reason", () =>
  Effect.gen(function* () {
    const service = fakeService("What exact line");
    const script = refusedSteer({ code: -32603, message: "failed to steer turn: boom" }, false);
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
    yield* service.seen;
    yield* write(message("And the second line?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "turn/steer: failed to steer turn: boom",
    });
    assert.deepEqual(received(spawned[0], "turn/start").length, 1);
    assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST]);
  }),
);

it.effect("ends the launch as stopped when app-server never answers the stop's interrupt", () =>
  Effect.gen(function* () {
    const service = fakeService("sleep 600");

    const hung: Script = {
      exchanges: [...OPEN, exchange(FIRST, 5), { method: "turn/interrupt", reply: [] }],
    };

    const { spawned, write, run } = yield* launch([hung], service);
    yield* write(CONFIG);
    yield* write(message("Run `sleep 600` and wait for it to finish."));
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP });

    while (received(spawned[0], "turn/interrupt").length === 0) yield* Effect.yieldNow;
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 50 }));
    yield* TestClock.adjust(Duration.minutes(1));

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.ok(spawned[0]?.ended);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect("ends the launch as failed when app-server exits, its secrets taken out of why", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const { write, run } = yield* launch(
      [{ exchanges: [...OPEN, exchange(FIRST, 3)], exitWith: `panic: bad token ${BEARER}` }],
      service,
    );

    yield* write(CONFIG);
    yield* write(message("The probe's first turn."));

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "app-server exited: panic: bad token [redacted]",
    });
  }),
);

it.effect("ends an idle launch at once on a stop, and on stdin closing, with no turn started", () =>
  Effect.gen(function* () {
    const stoppedService = fakeService();
    const stopped = yield* launch([{ exchanges: OPEN }], stoppedService);
    yield* stopped.write(CONFIG);
    yield* stopped.write({ type: INPUT_LINE.STOP });
    assert.equal(yield* Fiber.join(stopped.run), RUNNER_END.STOPPED);
    assert.deepEqual(received(stopped.spawned[0], "turn/start"), []);
    assert.deepEqual(kinds(stoppedService.applied), [...notified(OPEN), RUNNER_EVENT.END]);

    const closed = yield* launch([{ exchanges: OPEN }], fakeService());
    yield* closed.write(CONFIG);
    yield* closed.closeStdin;
    assert.equal(yield* Fiber.join(closed.run), RUNNER_END.INPUT_CLOSED);
    assert.ok(closed.spawned[0]?.ended);
  }),
);

it.effect("compacts the thread in a compaction line's place, its words dropped", () =>
  Effect.gen(function* () {
    const service = fakeService("turn/completed");
    const started = RESUMED_TURN.reply.find((line) => line.method === "turn/started");

    if (started === undefined) throw new Error("the resumed turn has no turn/started");

    const script: Script = {
      exchanges: [
        ...RESUME,
        {
          method: "thread/compact/start",
          reply: [{ id: 3, result: {} }, started, ...RESUMED_TURN_END],
        },
      ],
    };

    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write({
      type: INPUT_LINE.MESSAGE,
      uuid: LINE.FIRST,
      content: [{ type: "text", text: "/compact keep the plan" }],
      compact: true,
    });

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "thread/compact/start"), [{ threadId: THREAD }]);
    assert.deepEqual(received(process, "turn/start"), []);
    assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST]);
  }),
);

it.effect(
  "sets the thread's goal from a goal line, takes up each turn app-server runs toward it, and ends once it is met",
  () =>
    Effect.gen(function* () {
      const service = fakeService("turn/completed");
      const started = RESUMED_TURN.reply.find((line) => line.method === "turn/started");

      if (started === undefined) throw new Error("the resumed turn has no turn/started");
      const objective = "every billing test passes";

      const goal = (status: string, tokensUsed: number) => ({
        method: "thread/goal/updated",
        params: {
          threadId: THREAD,
          turnId: null,
          goal: {
            threadId: THREAD,
            objective,
            status,
            tokenBudget: 500_000,
            tokensUsed,
            timeUsedSeconds: 60,
            createdAt: 1,
            updatedAt: 2,
          },
        },
      });

      const script: Script = {
        exchanges: [
          ...RESUME,
          {
            method: "thread/goal/set",
            // App-server runs a turn toward the goal, then goes on with another of its own, in which the goal is met.
            reply: [
              { id: 3, result: { goal: goal("active", 0).params.goal } },
              goal("active", 0),
              started,
              goal("active", 40_000),
              ...RESUMED_TURN_END,
              started,
              goal("complete", 90_000),
              ...RESUMED_TURN_END,
            ],
          },
        ],
      };

      const { spawned, write, run } = yield* launch([script], service);
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write({
        type: INPUT_LINE.MESSAGE,
        uuid: LINE.FIRST,
        content: [{ type: "text", text: `/goal ${objective}` }],
        goal: true,
      });

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(received(process, "thread/goal/set"), [
        { threadId: THREAD, origin: "user", objective, status: "active" },
      ]);
      assert.deepEqual(received(process, "turn/start"), []);
      assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST]);
      // Only the goal's moves are posted as its events, not each change of its token count.
      assert.deepEqual(
        service.applied.flatMap(({ message: posted }) =>
          "type" in posted && posted.type === RUNNER_EVENT.GOAL
            ? [[posted.event, posted.tokens]]
            : [],
        ),
        [
          ["set", 0],
          ["met", 90_000],
        ],
      );
    }),
);

it.effect("starts the next turn for a message Vespin sent just before the turn completed", () =>
  Effect.gen(function* () {
    const service = fakeService("turn/completed");
    const release = yield* Deferred.make<void>();
    const userMessage = RESUMED_TURN.reply.find((line) => line.method === "item/started");

    if (userMessage === undefined) throw new Error("the resumed turn has no user message");

    const script: Script = {
      exchanges: [
        ...RESUME,
        { method: "turn/start", reply: RESUMED_TURN.reply.slice(0, -2) },
        // The steer is taken and the turn completes before app-server answers it.
        {
          method: "turn/steer",
          reply: [
            { id: 4, result: { turnId: "00000000-0000-4000-8000-000000000008" } },
            userMessage,
            ...RESUMED_TURN_END,
          ],
          holdAnswer: Deferred.await(release),
        },
        RESUMED_TURN,
      ],
    };

    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?"));
    yield* write(message("And the second line?"));
    yield* service.seen;
    // The follow-up is queued behind the completion before the steer is answered.
    yield* write(message("Also check the tests."));
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 50 }));
    yield* Deferred.succeed(release, undefined);

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    const starts = received(process, "turn/start");
    assert.equal(starts.length, 2);
    assert.deepEqual(starts[1]?.input, [
      { type: "text", text: "Also check the tests.", text_elements: [] },
    ]);
  }),
);

/** The value of the `-c` override `key` a process was started with, where it has one. */
function override(process: Spawned | undefined, key: string): string | undefined {
  const prefix = `${key}=`;

  return process?.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/**
 * The service's token route as the runner reaches it: each ask under the
 * runner's bearer answers the next fresh token, `plan-token-1`, `-2`, …, and
 * the workspace given, where one is.
 */
function fakeTokenRoute(chatgptAccountId?: string) {
  const bearers: (string | null)[] = [];
  let issued = 0;

  const respond = async (_url: string, init: RequestInit) => {
    bearers.push(new Headers(init.headers).get("authorization"));
    issued += 1;

    return Response.json({ accessToken: `plan-token-${issued}`, chatgptAccountId });
  };

  return { bearers, respond };
}

/** The workspace the fake token route says the plan pays from. */
const WORKSPACE = "chatgpt-workspace-fixture";

/** App-server's ask for fresh tokens after a 401, as its own request of the runner. */
const REFRESH_REQUEST: RecordedMessage = {
  id: "refresh-1",
  method: "account/chatgptAuthTokens/refresh",
  params: { reason: "unauthorized", previousAccountId: WORKSPACE },
};

it.effect(
  "in a sandbox, app-server is signed in on the service's host-supplied tokens before the thread opens, its ask after a 401 is answered with fresh ones, and no token reaches argv, its environment, an event, or a log",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const route = fakeTokenRoute(WORKSPACE);

      const http = fakeHttpClientLayer((url, init) =>
        url === TOKEN_URL ? route.respond(url, init) : service.respond(url, init),
      );

      const login: Exchange = {
        method: "account/login/start",
        reply: [{ id: 0, result: { type: "chatgptAuthTokens" } }],
      };

      // App-server asks for fresh tokens as the thread resumes, and the turn goes out once the runner answered.
      const resumed: Exchange = {
        ...exchange(RESUMED, 2),
        reply: [REFRESH_REQUEST, ...exchange(RESUMED, 2).reply],
      };

      const answered: RecordedMessage[] = [];

      const turn: Exchange = {
        ...RESUMED_TURN,
        beforeReply: (process) =>
          Effect.map(Queue.take(process.answers), (answer) => {
            answered.push(answer);
          }),
      };

      const { spawned, write, run, logged } = yield* launch(
        [{ exchanges: [exchange(RESUMED, 0), exchange(RESUMED, 1), login, resumed, turn] }],
        service,
        SANDBOX_ENV,
        { http },
      );

      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?"));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.equal(received(process, "initialize")[0]?.capabilities?.experimentalApi, true);
      assert.deepEqual(received(process, "account/login/start"), [
        {
          type: "chatgptAuthTokens",
          accessToken: "plan-token-1",
          chatgptAccountId: WORKSPACE,
          chatgptPlanType: null,
        },
      ]);
      assert.deepEqual(answered, [
        {
          id: "refresh-1",
          result: {
            accessToken: "plan-token-2",
            chatgptAccountId: WORKSPACE,
            chatgptPlanType: null,
          },
        },
      ]);
      assert.deepEqual(route.bearers, [`Bearer ${BEARER}`, `Bearer ${BEARER}`]);
      // Codex's own OpenAI provider carries the sign-in: the runner names none of its own.
      assert.equal(override(process, "model_provider"), undefined);

      const posted = service.bodies.join("\n");

      for (const secret of ["plan-token-1", "plan-token-2"]) {
        assert.ok(!posted.includes(secret));
        assert.ok(!logged.some((line) => line.includes(secret)));
        assert.ok(!process?.args.some((arg) => arg.includes(secret)));
        assert.ok(!Object.values(process?.env ?? {}).some((value) => value?.includes(secret)));
      }
    }),
);

/** A page of the thread's turns, newest first, each naming the client id of the line it took. */
function turnsPage(turns: readonly { readonly id: string; readonly line: string }[]): Exchange {
  return {
    method: "thread/turns/list",
    reply: [
      {
        id: 90,
        result: {
          data: turns.map(({ id, line }) => ({
            id,
            items: [{ type: "userMessage", id: `${id}-item`, clientId: line, content: [] }],
          })),
          nextCursor: null,
          backwardsCursor: null,
        },
      },
    ],
  };
}

const REVERTED: Exchange = {
  method: "thread/revert",
  reply: [{ id: 91, result: { turnsBackwardsCursor: null, itemsBackwardsCursor: null } }],
};

it.effect("reverts a rewound thread to before the turn that took the line the rewind dropped", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const page = turnsPage([
      { id: "turn-3", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e09" },
      { id: "turn-2", line: LINE.STEERED },
      { id: "turn-1", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e08" },
    ]);

    const script: Script = { exchanges: [...RESUME, page, REVERTED, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD, rewindBefore: LINE.STEERED });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "thread/revert"), [
      { threadId: THREAD, beforeTurnId: "turn-2" },
    ]);
  }),
);

/** The lines of a thread's file app-server just wrote, which the store holds none of yet: a fork's whole file, or a revert's segment. */
const FRESH_LINES = [
  { type: "session_meta", payload: { id: THREAD } },
  { type: "response_item", payload: { type: "message", role: "user" } },
];

const FORKED_FILE = `sessions/2026/11/09/rollout-2026-11-09T21-52-40-${THREAD}.jsonl`;
const SEGMENT_FILE = FORKED_FILE.replace(".jsonl", "_01a1c24c-01e2-79a2-bc69-837e26c4ac0e.jsonl");

/** The thread forked into the file at the path given, under the same id the recorded turn names. */
function forked(path: string): Exchange {
  return { method: "thread/fork", reply: [{ id: 2, result: { thread: { id: THREAD, path } } }] };
}

/** The thread reverted to before the steered line's turn, Codex naming the segment it began at the path given. */
function revertedInto(path: string): Exchange[] {
  return [
    turnsPage([{ id: "turn-2", line: LINE.STEERED }]),
    {
      method: "thread/revert",
      reply: [
        {
          id: 91,
          result: {
            thread: { id: THREAD, path },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
        },
      ],
    },
  ];
}

const SOURCE_THREAD = "00000000-0000-4000-8000-0000000000ff";

it.effect.each([
  {
    opened: "the segment a revert began",
    files: [SEGMENT_FILE],
    config: { threadId: THREAD, rewindBefore: LINE.STEERED },
    exchanges: ([segment = ""]: readonly string[]) => [...RESUME, ...revertedInto(segment)],
  },
  {
    opened: "a forked thread's file",
    files: [FORKED_FILE],
    config: { threadId: SOURCE_THREAD, fork: true },
    exchanges: ([file = ""]: readonly string[]) => [
      exchange(RESUMED, 0),
      exchange(RESUMED, 1),
      forked(file),
    ],
  },
  {
    opened:
      "the file of a fork a provider's refusal of the resume made, then the segment its rewind began",
    files: [FORKED_FILE, SEGMENT_FILE],
    config: { threadId: SOURCE_THREAD, rewindBefore: LINE.STEERED },
    exchanges: ([file = "", segment = ""]: readonly string[]) => [
      exchange(RESUMED, 0),
      exchange(RESUMED, 1),
      {
        method: "thread/resume",
        reply: [
          {
            id: 2,
            error: {
              code: -32600,
              message: "Model provider mismatch",
              data: { type: "modelProviderMismatch" },
            },
          },
        ],
      },
      forked(file),
      ...revertedInto(segment),
    ],
  },
  {
    opened: "a fork's file, then the segment the fork's cut began",
    files: [FORKED_FILE, SEGMENT_FILE],
    config: { threadId: SOURCE_THREAD, fork: true, rewindBefore: LINE.STEERED },
    exchanges: ([file = "", segment = ""]: readonly string[]) => [
      exchange(RESUMED, 0),
      exchange(RESUMED, 1),
      forked(file),
      ...revertedInto(segment),
    ],
  },
])("mirrors $opened to the service's store from its first line", ({ files, config, exchanges }) =>
  Effect.gen(function* () {
    const home = mkdtempSync(join(tmpdir(), "codex-home-"));
    const paths = files.map((file) => join(home, file));

    // Codex writes each file as it answers, so it stands with lines the store has none of.
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, FRESH_LINES.map((line) => `${JSON.stringify(line)}\n`).join(""));
    }

    const appended: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const call = JSON.parse(String(init?.body));

      if (call.call === "append") appended.push({ key: call.key, entries: call.entries });

      return new Response(JSON.stringify(call.call === "listSubkeys" ? { subkeys: [] } : {}));
    });
    const script: Script = { exchanges: [...exchanges(paths), RESUMED_TURN] };

    const { spawned, write, run } = yield* launch([script], fakeService(), {
      ...ENV,
      CODEX_HOME: home,
    });

    yield* write({
      ...CONFIG,
      ...config,
      transcriptsUrl: "https://app.test/api/agents/runner-transcripts",
    });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.deepEqual(spawned[0]?.unexpected, []);
    assert.deepEqual(
      appended,
      files.map((subpath) => ({
        key: { projectKey: "codex", sessionId: THREAD, subpath },
        entries: FRESH_LINES,
      })),
    );
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  }),
);

it.effect("resumes a thread whole where no turn took the line the rewind dropped", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const page = turnsPage([{ id: "turn-1", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e08" }]);
    const script: Script = { exchanges: [...RESUME, page, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD, rewindBefore: LINE.STEERED });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "thread/revert"), []);
  }),
);

/** The carry-on line the service sends once the provider's host answers. */
const CARRY_ON = "Your previous turn was interrupted; carry on.";

/**
 * The resumed turn, failed as app-server reports a stream it lost to the
 * network: Codex's own kind for it, with no HTTP status since nothing
 * answered; or refused with a status, which no probe mends.
 */
function lostTurn(httpStatusCode: number | null): Exchange {
  const completed = RESUMED_TURN.reply.at(-1);
  assert.ok(completed?.method === "turn/completed");
  const params = completed.params;
  assert.ok(Predicate.isObjectKeyword(params) && "turn" in params);
  const turn = params.turn;
  assert.ok(Predicate.isObjectKeyword(turn));

  return {
    method: "turn/start",
    reply: [
      ...RESUMED_TURN.reply.slice(0, -1),
      {
        ...completed,
        params: {
          ...params,
          turn: {
            ...turn,
            status: "failed",
            error: {
              message: "stream disconnected before completion: connection reset",
              codexErrorInfo: { responseStreamDisconnected: { httpStatusCode } },
              additionalDetails: null,
            },
          },
        },
      },
    ],
  };
}

/** Waits, without moving the clock, until the service has taken an event of the type given. */
function untilPosted(service: ReturnType<typeof fakeService>, type: string) {
  return Effect.gen(function* () {
    const posted = () =>
      service.applied.some(({ message }) => "type" in message && message.type === type);

    for (let step = 0; step < 5_000 && !posted(); step += 1) yield* Effect.yieldNow;
    assert.ok(posted(), `the service took no ${type}`);
  });
}

it.effect(
  "keeps the launch up when app-server loses its provider, probes the host, and runs the carry-on as the next turn once it answers",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const script: Script = { exchanges: [...RESUME, lostTurn(null), RESUMED_TURN] };

      const { spawned, write, run, probed } = yield* launch([script], service, ENV, {
        probe: fakeProbe(1),
      });

      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_LOST);
      assert.equal(run.pollUnsafe(), undefined, "the launch stays up");

      // Refused at once, answered after the first wait.
      yield* TestClock.adjust(RUNNER_RECONNECT.FIRST_WAIT_MS);
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_RESTORED);
      assert.equal(probed.targets.length, 2);

      const restored = service.applied.find(
        ({ message: posted }) =>
          "type" in posted && posted.type === RUNNER_EVENT.CONNECTION_RESTORED,
      )?.message;

      assert.ok(restored !== undefined && "type" in restored);
      assert.deepEqual(restored, {
        type: RUNNER_EVENT.CONNECTION_RESTORED,
        host: probed.targets[0]?.host,
        carryOn: true,
      });

      yield* write(message(CARRY_ON, LINE.STEERED));
      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(received(process, "turn/start")[1]?.input, [
        { type: "text", text: CARRY_ON, text_elements: [] },
      ]);
      assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST, LINE.STEERED]);
    }),
);

it.effect(
  "ends the launch failed, saying why, once the provider's host stays silent past the wait",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const script: Script = { exchanges: [...RESUME, lostTurn(null)] };

      const { write, run, probed } = yield* launch([script], service, ENV, {
        probe: fakeProbe(Number.POSITIVE_INFINITY),
      });

      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_LOST);

      for (;;) {
        if (run.pollUnsafe() !== undefined) break;
        yield* TestClock.adjust(RUNNER_RECONNECT.LONGEST_WAIT_MS);
      }

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: connectionLostFailure(
          probed.targets[0]?.host ?? "",
          CONNECTION_LOST_DETAIL.GAVE_UP,
        ),
      });
    }),
);

it.effect(
  "ends the launch failed as before on a stream the provider refused with a status, probing nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const script: Script = { exchanges: [...RESUME, lostTurn(401)] };
      const { write, run, probed } = yield* launch([script], service);
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.equal(probed.targets.length, 0);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: "stream disconnected before completion: connection reset",
      });
    }),
);

/** The sleep turn's command, as app-server asks to run it outside the sandbox. */
const COMMAND_ASK: RecordedMessage = {
  id: 41,
  method: "item/commandExecution/requestApproval",
  params: {
    kind: "command",
    threadId: THREAD,
    turnId: "00000000-0000-4000-8000-000000000006",
    itemId: "call_9_0",
    startedAtMs: 1792520831000,
    environmentId: null,
    reason: "Install the dependencies over the network",
    command: "/bin/bash -lc 'sleep 600'",
    cwd: "/srv/agent-probe-repo",
  },
};

/** An MCP server's form, which app-server hands the client under approval `on-request`. */
const ELICITATION: RecordedMessage = {
  id: 42,
  method: "mcpServer/elicitation/request",
  params: {
    threadId: THREAD,
    turnId: null,
    serverName: "linear",
    mode: "form",
    message: "Pick a team",
  },
};

/** The sleep turn with what app-server asks the client after the command starts. */
function sleepTurnAsking(...asked: readonly RecordedMessage[]): Script {
  const turn = exchange(FIRST, 5);

  return {
    exchanges: [...OPEN, { ...turn, reply: [...turn.reply, ...asked] }, exchange(FIRST, 6)],
  };
}

/** The runner's events of one type, as posted. */
function posted(service: ReturnType<typeof fakeService>, type: string) {
  return service.applied.flatMap(({ message: each }) =>
    "type" in each && each.type === type ? [each] : [],
  );
}

it.effect(
  "in Ask for approval, runs Codex's workspace sandbox on its own defaults, holds an ask for the member, answers Always allow as acceptForSession, and declines an MCP form",
  () =>
    Effect.gen(function* () {
      const service = fakeService(RUNNER_EVENT.APPROVAL_REQUESTED);

      const { spawned, write, run } = yield* launch(
        [sleepTurnAsking(COMMAND_ASK, ELICITATION)],
        service,
      );

      yield* write({ ...CONFIG, permissionMode: PERMISSION_MODE.ASK });
      yield* write(message("Run sleep 600.", LINE.FIRST));
      yield* service.seen;
      const [process] = spawned;
      assert.ok(process !== undefined);
      // The form is declined at once; the command waits on the member.
      assert.deepEqual(yield* Queue.take(process.answers), {
        id: 42,
        result: { action: "decline", content: null, _meta: null },
      });
      const [asked] = posted(service, RUNNER_EVENT.APPROVAL_REQUESTED);
      assert.ok(asked !== undefined && asked.type === RUNNER_EVENT.APPROVAL_REQUESTED);
      assert.equal(asked.toolUseId, "call_9_0");
      assert.equal(asked.toolName, "commandExecution");
      assert.equal(asked.description, "Install the dependencies over the network");
      assert.equal(asked.input.command, "/bin/bash -lc 'sleep 600'");
      yield* write({
        type: INPUT_LINE.APPROVAL,
        requestId: asked.requestId,
        decision: APPROVAL_DECISION.ALLOW_FOR_AGENT,
      });
      assert.deepEqual(yield* Queue.take(process.answers), {
        id: 41,
        result: { decision: "acceptForSession" },
      });
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      assert.deepEqual(
        posted(service, RUNNER_EVENT.APPROVAL_RESOLVED).map((each) => ({ ...each })),
        [
          {
            type: RUNNER_EVENT.APPROVAL_RESOLVED,
            requestId: asked.requestId,
            decision: APPROVAL_DECISION.ALLOW_FOR_AGENT,
            by: APPROVAL_BY.MEMBER,
          },
        ],
      );
      assert.equal(override(process, "approval_policy"), '"on-request"');
      assert.equal(override(process, "approvals_reviewer"), '"user"');
      assert.equal(override(process, "sandbox_mode"), '"workspace-write"');
      // Codex's own workspace defaults: nothing writable beside the checkout, and the network off.
      assert.equal(override(process, "sandbox_workspace_write.writable_roots"), undefined);
      assert.equal(override(process, "sandbox_workspace_write.network_access"), undefined);
      const [thread] = received(process, "thread/start");
      assert.equal(thread?.approvalPolicy, "on-request");
      assert.equal(thread?.approvalsReviewer, "user");
      assert.equal(thread?.sandbox, "workspace-write");
      assert.deepEqual(received(process, "turn/start")[0]?.sandboxPolicy, {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      });
    }),
);

/** A command Codex's automatic review denied, its completion, and an ask the review handed to the member. */
const REVIEWED: readonly RecordedMessage[] = [
  {
    method: "item/autoApprovalReview/completed",
    params: {
      threadId: THREAD,
      turnId: "00000000-0000-4000-8000-000000000006",
      startedAtMs: 1792520831000,
      completedAtMs: 1792520832000,
      reviewId: "review-1",
      targetItemId: "call_reviewed",
      decisionSource: "agent",
      review: {
        status: "denied",
        riskLevel: null,
        userAuthorization: null,
        rationale: "Automatic approval review failed: the reviewer's model was refused.",
      },
      action: {
        type: "command",
        source: "shell",
        command: "curl https://example.test",
        cwd: "/srv/agent-probe-repo",
      },
    },
  },
  {
    method: "item/completed",
    params: {
      threadId: THREAD,
      turnId: "00000000-0000-4000-8000-000000000006",
      item: {
        type: "commandExecution",
        id: "call_reviewed",
        command: "curl https://example.test",
        cwd: "/srv/agent-probe-repo",
        status: "declined",
        aggregatedOutput: null,
        exitCode: null,
      },
    },
  },
  COMMAND_ASK,
];

it.effect(
  "in Approve for me, Codex's automatic review answers, a command it denied says why on its row, and an ask still waiting as the launch ends is resolved before its end",
  () =>
    Effect.gen(function* () {
      const service = fakeService(RUNNER_EVENT.APPROVAL_REQUESTED);
      const { spawned, write, run } = yield* launch([sleepTurnAsking(...REVIEWED)], service);
      yield* write({ ...CONFIG, permissionMode: PERMISSION_MODE.AUTO });
      yield* write(message("Run sleep 600.", LINE.FIRST));
      yield* service.seen;
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      const [process] = spawned;
      assert.equal(override(process, "approvals_reviewer"), '"auto_review"');
      assert.equal(received(process, "turn/start")[0]?.approvalsReviewer, "auto_review");

      const declined = service.applied.flatMap(({ message: each }) =>
        "method" in each &&
        each.method === "item/completed" &&
        each.params.item.id === "call_reviewed"
          ? [each.params.item]
          : [],
      );

      assert.deepEqual(
        declined.map((item) =>
          item.type === "commandExecution" ? item.aggregatedOutput : undefined,
        ),
        [
          "Codex's automatic review denied this command. Automatic approval review failed: the reviewer's model was refused.",
        ],
      );
      assert.deepEqual(
        posted(service, RUNNER_EVENT.APPROVAL_RESOLVED).map((each) =>
          each.type === RUNNER_EVENT.APPROVAL_RESOLVED ? each.by : undefined,
        ),
        [APPROVAL_BY.ENDED],
      );
      assert.equal(kinds(service.applied).at(-1), RUNNER_EVENT.END);
    }),
);
