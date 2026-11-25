/**
 * cursor.test.ts -- one Cursor launch of the runner against a scripted SDK playing the spike's recorded messages and a fake service: the agent made or resumed on the launch's key and mode, its store mirrored and read back, messages as runs and steers, Stop as a cancel, a run's failure, silence, and cut-off, a warm launch's idle and retire, a summary's instructions, our tools as custom tools, and every message out in order.
 */

import assert from "node:assert/strict";
import type { SDKMessage } from "@cursor/sdk";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Match,
  Option,
  Queue,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { EventsUndelivered } from "./events.js";
import {
  CURSOR_MODEL_CALL,
  CURSOR_SIGNED_OUT_DETAIL,
  type CursorConfig,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_CONTROL,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_PLACE,
  RUNNER_TRANSCRIPTS,
  RUNNER_UNANSWERED,
  type RunnerEnd,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import { fakeAppServer } from "./testing/fake-app-server.js";
import { fakeCheckoutSnapshots, fakeSnapshotOf } from "./testing/fake-checkout-snapshots.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { type FakeDelta, type FakeRun, fakeBlobOf, fakeCursor } from "./testing/fake-cursor.js";
import { fakeProbe } from "./testing/fake-probe.js";
import { ANSWER, type Answer, makeFakeService } from "./testing/fake-service.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const BEARER = "runner-bearer-for-tests";

/** In the cloud's sandbox this is the launch's placeholder, the key itself set at its firewall, which the runner reads alike. */
const CURSOR_KEY = "cursor-api-key-for-tests";
const EVENTS_URL = "https://app.test/runner/events";
const MCP_URL = "https://app.test/runner/mcp";
const TRANSCRIPTS_URL = "https://app.test/api/agents/runner-transcripts";
const FIRST_SEQUENCE = 21;
const SESSION = "cursor-6f1d2a10-2c1d-4c7a-9a55-5e3b7b0f5f3e";

/** A launch in the cloud's sandbox, which names no place. */
const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  [RUNNER_ENV.CURSOR_API_KEY]: CURSOR_KEY,
  PATH: "/usr/bin",
};

const CONFIG: CursorConfig = {
  harness: RUNNER_HARNESS.CURSOR,
  cwd: "/vercel/sandbox/repository",
  agentId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  sdk: "/opt/agent/cursor-sdk/node_modules/@cursor/sdk/dist/esm/index.js",
  session: SESSION,
  model: { id: "grok-4.7", params: [{ id: "reasoning_effort", value: "high" }] },
  instructions: "You are a Vespin coding agent.",
  firstSequence: FIRST_SEQUENCE,
  eventsUrl: EVENTS_URL,
  mcpUrl: MCP_URL,
};

const LINE = {
  FIRST: "10000000-0000-4000-8000-000000000001",
  SECOND: "10000000-0000-4000-8000-000000000002",
  THIRD: "10000000-0000-4000-8000-000000000005",
} as const;

/** A message line as the service writes it. */
function message(text: string, uuid: string): InputLine {
  return { type: INPUT_LINE.MESSAGE, uuid, content: [{ type: "text", text }] };
}

const IDS = { agent_id: SESSION, run_id: "run-1" } as const;

/** A short turn as the spike recorded one, shortened: a status, thinking and words a token at a time, a read, and the turn's usage. */
const RECORDED_TURN: readonly SDKMessage[] = [
  { type: "status", ...IDS, status: "RUNNING" },
  { type: "thinking", ...IDS, text: "The" },
  { type: "thinking", ...IDS, text: " file" },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-1",
    name: "read",
    status: "running",
    args: { path: "/vercel/sandbox/repository/README.md" },
  },
  {
    type: "tool_call",
    ...IDS,
    call_id: "call-1",
    name: "read",
    status: "completed",
    args: { path: "/vercel/sandbox/repository/README.md" },
    result: { status: "success", value: { content: "# scratch\n", totalLines: 2, fileSize: 10 } },
  },
  {
    type: "assistant",
    ...IDS,
    message: { role: "assistant", content: [{ type: "text", text: "I" }] },
  },
  {
    type: "usage",
    ...IDS,
    usage: {
      inputTokens: 24726,
      outputTokens: 408,
      cacheReadTokens: 20096,
      cacheWriteTokens: 0,
      totalTokens: 25134,
    },
  },
];

/** A summary the conversation was cut to, as `agent.summarize()` streams it. */
const SUMMARY: readonly SDKMessage[] = [
  { type: "summary", ...IDS, status: "running" },
  { type: "summary", ...IDS, status: "completed" },
];

/** The fake events route these launches post to, which settles `seen` once a message applied holds `watchFor`, and answers its posts as `answers` says. */
function fakeService(watchFor?: string, answers?: readonly Answer[]) {
  return makeFakeService({ url: EVENTS_URL, firstSequence: FIRST_SEQUENCE, watchFor, answers });
}

/** Our MCP server as the service answers it: one tool, each call's body and bearer kept, and `called` settled once a tool is called; a tool call never answered where `silent`. */
function fakeMcpRoute(silent: boolean) {
  const calls: {
    readonly authorization: string | null;
    readonly body: { readonly method: string; readonly params?: unknown };
  }[] = [];

  const called = Deferred.makeUnsafe<void>();

  const respond = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ authorization: new Headers(init.headers).get("authorization"), body });

    if (body.method === "tools/call") Deferred.doneUnsafe(called, Exit.void);

    if (silent && body.method === "tools/call") return new Promise<Response>(() => {});

    const result = Match.value(body.method).pipe(
      Match.when("initialize", () => ({ protocolVersion: "2025-06-18", capabilities: {} })),
      Match.when("tools/list", () => ({
        tools: [
          {
            name: "post_thread",
            description: "Post on a thread in the inbox.",
            inputSchema: { type: "object", properties: { body: { type: "string" } } },
          },
        ],
      })),
      Match.orElse(() => ({ content: [{ type: "text", text: "Posted." }], isError: false })),
    );

    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  };

  return { calls, called: Deferred.await(called), respond };
}

/** One launch over stdin lines the test writes, against a fake SDK, a fake MCP route, and a fake service. */
function launch(
  runs: readonly FakeRun[],
  service: ReturnType<typeof fakeService>,
  env: Record<string, string> = ENV,
  machine: { readonly signedIn?: boolean; readonly silentTools?: boolean } = {},
) {
  return Effect.gen(function* () {
    const cursor = fakeCursor(runs, { ...machine, env });
    const mcp = fakeMcpRoute(machine.silentTools === true);
    const cli = yield* fakeClaudeCode([]);
    const stdin = yield* Queue.unbounded<string, Cause.Done>();
    const write = (line: CursorConfig | InputLine) => Queue.offer(stdin, JSON.stringify(line));

    const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          cursor.layer,
          cli.layer,
          fakeHttpClientLayer((url, init) =>
            url === MCP_URL ? mcp.respond(url, init) : service.respond(url, init),
          ),
          fakeAppServer([]).layer,
          fakeProbe().layer,
          fakeCheckoutSnapshots().layer,
        ),
      ),
      Effect.forkScoped,
    );

    return {
      cursor: cursor.record,
      until: cursor.until,
      release: cursor.release,
      mcp,
      write,
      run,
    };
  });
}

/**
 * The launch's outcome, the test clock moved on until it ends, for a launch
 * that waits on its store's mirror, each try of which waits on the clock.
 */
const outcomeOf = Effect.fnUntraced(function* (run: Fiber.Fiber<RunnerEnd, unknown>) {
  for (let step = 0; step < 50 && run.pollUnsafe() === undefined; step += 1) {
    yield* TestClock.adjust(RUNNER_CONTROL.ANSWER_MS);
  }

  return yield* Fiber.join(run);
});

/** Each message applied, in order. */
function messagesOf(events: readonly RunnerEvent[]) {
  return events.map(({ message: posted }) => posted);
}

/** The most a call's body carries at the service, past which it refuses the call, as `runner-transcripts-app.ts` does. */
const TRANSCRIPTS_MAX_BODY_BYTES = 4.5 * 1024 * 1024;

/** The service's transcript store as `fetch` reaches it: every append kept but the first `refused`, which it fails, and a load answered with `held`. */
function fakeTranscripts(held: readonly unknown[] = [], refused = 0) {
  const appended: { readonly key: unknown; readonly entries: readonly unknown[] }[] = [];
  let appends = 0;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = String(init?.body);

    if (Buffer.byteLength(body) > TRANSCRIPTS_MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    const call = JSON.parse(body);

    if (call.call === RUNNER_TRANSCRIPTS.CALL.APPEND) {
      appends += 1;

      if (appends <= refused) return new Response(null, { status: 503 });
      appended.push({ key: call.key, entries: call.entries });
    }

    const answer =
      call.call === RUNNER_TRANSCRIPTS.CALL.LOAD_PAGE ? { entries: held, next: null } : {};

    return new Response(JSON.stringify(answer));
  });

  return appended;
}

it.effect(
  "makes the agent under the service's id on the launch's key, in its checkout on its model, and never posts the key",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], service);

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [made] = cursor.created;
      assert.equal(made?.agentId, SESSION);
      assert.equal(made?.apiKey, CURSOR_KEY);
      assert.deepEqual(made?.model, CONFIG.model);
      assert.equal(made?.local?.cwd, CONFIG.cwd);
      assert.deepEqual(made?.local?.settingSources, ["project"]);
      assert.ok(!service.bodies.join("").includes(CURSOR_KEY));
    }),
);

it.effect(
  "takes the bearer and every key out of the environment the agent's shell inherits, and hands it the image's tools",
  () =>
    Effect.gen(function* () {
      const env = { ...ENV, [RUNNER_ENV.OPENAI_API_KEY]: "openai-key-for-tests" };

      const { cursor, write, run } = yield* launch(
        [{ messages: RECORDED_TURN }],
        fakeService(),
        env,
      );

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.environment, {
        PATH: "/usr/bin",
        PLAYWRIGHT_BROWSERS_PATH: "0",
        NODE_PATH: "/usr/local/lib/node_modules",
      });
    }),
);

it.effect.each([
  ["Auto as Cursor's Auto-review", PERMISSION_MODE.AUTO, true],
  ["full access with no review", PERMISSION_MODE.FULL_ACCESS, undefined],
] as const)("runs %s, never in the SDK's sandbox", ([_case, permissionMode, autoReview]) =>
  Effect.gen(function* () {
    const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], fakeService());

    yield* write({ ...CONFIG, permissionMode });
    yield* write(message("Read the README.", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.equal(cursor.created[0]?.local?.autoReview, autoReview);
    assert.equal(cursor.created[0]?.local?.sandboxOptions, undefined);
  }),
);

it.effect(
  "leads a new agent's first message with our instructions, and posts every message Cursor streams between ACCEPTED and END",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], service);

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(
        cursor.sent.map(({ message: sent }) => sent.text),
        [
          "<coder_instructions>\nYou are a Vespin coding agent.\n</coder_instructions>\n\nRead the README.",
        ],
      );
      assert.deepEqual(messagesOf(service.applied), [
        {
          type: RUNNER_EVENT.ACCEPTED,
          uuid: LINE.FIRST,
          snapshot: fakeSnapshotOf(CONFIG.cwd, LINE.FIRST),
        },
        ...RECORDED_TURN,
        { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
      ]);
    }),
);

it.effect(
  "posts each model call Cursor hands the send alone as a message of its own, ahead of the message streamed after it",
  () =>
    Effect.gen(function* () {
      const service = fakeService();

      const usage = {
        first: { inputTokens: 12000, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
        last: {
          inputTokens: 12726,
          outputTokens: 368,
          cacheReadTokens: 10048,
          cacheWriteTokens: 0,
        },
      };

      const said = (modelCallId: string, ended: typeof usage.first): FakeDelta => ({
        delta: { type: "model-call-completed", modelCallId, usage: ended },
      });

      const posted = (model_call_id: string, ended: typeof usage.first) => ({
        type: CURSOR_MODEL_CALL,
        agent_id: SESSION,
        model_call_id,
        usage: ended,
      });

      // The first call ends once the read completes, and the last before the turn's usage.
      const turn = [
        ...RECORDED_TURN.slice(0, 5),
        said("model-call-1", usage.first),
        ...RECORDED_TURN.slice(5, 6),
        said("model-call-2", usage.last),
        ...RECORDED_TURN.slice(6),
      ];

      const { write, run } = yield* launch([{ messages: turn }], service);

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(messagesOf(service.applied).slice(1, -1), [
        ...RECORDED_TURN.slice(0, 5),
        posted("model-call-1", usage.first),
        ...RECORDED_TURN.slice(5, 6),
        posted("model-call-2", usage.last),
        ...RECORDED_TURN.slice(6),
      ]);
    }),
);

it.effect(
  "resumes the agent in another checkout from what an earlier launch mirrored, its message not led by the instructions again, and mirrors what the run wrote",
  () =>
    Effect.gen(function* () {
      // The first launch makes the agent, and mirrors its row and its run's checkpoint.
      const mirrored = fakeTranscripts();
      const first = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* first.write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* first.write(message("Read the README.", LINE.FIRST));
      assert.equal(yield* Fiber.join(first.run), RUNNER_END.TURN_ENDED);
      const held = mirrored.flatMap(({ entries }) => entries);
      assert.deepEqual(
        mirrored.map(({ key }) => key),
        [{ projectKey: RUNNER_TRANSCRIPTS.CURSOR_PROJECT, sessionId: SESSION }],
      );

      // A sandbox made anew holds the checkout at another path, and the store at the service alone.
      const appended = fakeTranscripts(held);
      const moved = "/vercel/sandbox/elsewhere";
      const second = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* second.write({ ...CONFIG, cwd: moved, transcriptsUrl: TRANSCRIPTS_URL });
      yield* second.write(message("And the second line?", LINE.SECOND));

      assert.equal(yield* Fiber.join(second.run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(second.cursor.created, []);
      assert.deepEqual(
        second.cursor.resumed.map(({ agentId }) => agentId),
        [SESSION],
      );
      assert.deepEqual(
        second.cursor.sent.map(({ message: sent }) => sent.text),
        ["And the second line?"],
      );
      const blob = fakeBlobOf(1);
      assert.ok(
        appended
          .flatMap(({ entries }) => entries)
          .some(
            (entry) =>
              JSON.stringify(entry) ===
              JSON.stringify({
                type: "checkpoint",
                agentId: SESSION,
                blobId: blob.blobId,
                data: Buffer.from(blob.data).toString("base64"),
              }),
          ),
      );
    }),
);

/** What the service holds of an agent that ran two turns, the second's line marked after the first's checkpoint. */
const TWO_TURNS_HELD = [
  {
    type: "agent",
    agent: {
      agentId: SESSION,
      cwd: CONFIG.cwd,
      status: "idle",
      createdAt: 0,
      updatedAt: 0,
      latestCheckpoint: { schemaVersion: 1, rootBlobId: "blob-second" },
    },
  },
  { type: "cut", agentId: SESSION, before: LINE.FIRST, root: null },
  { type: "checkpoint", agentId: SESSION, blobId: "blob-first", data: "Zmlyc3Q=" },
  { type: "cut", agentId: SESSION, before: LINE.SECOND, root: "blob-first" },
  { type: "checkpoint", agentId: SESSION, blobId: "blob-second", data: "c2Vjb25k" },
];

const LINE_AFTER_REWIND = "10000000-0000-4000-8000-000000000003";
const LINE_AFTER_SUMMARY = "10000000-0000-4000-8000-000000000004";

/** An agent row mirrored, read for the checkpoint it names alone. */
const readRowCheckpoint = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("agent"),
    agent: Schema.Struct({ latestCheckpoint: Schema.Struct({ rootBlobId: Schema.String }) }),
  }),
);

it.effect(
  "resumes a rewound agent from the checkpoint marked before the line dropped, and marks the line it sends next at that checkpoint",
  () =>
    Effect.gen(function* () {
      const appended = fakeTranscripts(TWO_TURNS_HELD);
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL, rewindBefore: LINE.SECOND });
      yield* write(message("Try it another way.", LINE_AFTER_REWIND));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(
        cursor.resumed.map(({ agentId }) => agentId),
        [SESSION],
      );
      const entries = appended.flatMap(({ entries: each }) => each);
      const [firstRow] = entries.flatMap((entry) => Option.toArray(readRowCheckpoint(entry)));
      // The row the cut wrote goes first, ahead of the one the run's end writes.
      assert.equal(firstRow?.agent.latestCheckpoint.rootBlobId, "blob-first");
      assert.ok(
        entries.some(
          (entry) =>
            JSON.stringify(entry) ===
            JSON.stringify({
              type: "cut",
              agentId: SESSION,
              before: LINE_AFTER_REWIND,
              root: "blob-first",
            }),
        ),
      );
    }),
);

it.effect(
  "resumes a fork's source agent as one of its own, under an id it mints, every entry mirrored under that id, its first message led by the fork's own instructions",
  () =>
    Effect.gen(function* () {
      const appended = fakeTranscripts(TWO_TURNS_HELD);
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      const instructions = "You are the forked Vespin coding agent.";
      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL, fork: true, instructions });
      yield* write(message("Carry on from here.", LINE_AFTER_REWIND));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [resumed] = cursor.resumed.map(({ agentId }) => agentId);
      assert.ok(resumed !== undefined && resumed !== SESSION);
      // Note that the source's conversation holds the source's instructions, so the fork's lead its first message.
      assert.deepEqual(
        cursor.sent.map(({ message: sent }) => sent.text),
        [
          "<coder_instructions>\nYou are the forked Vespin coding agent.\n</coder_instructions>\n\nCarry on from here.",
        ],
      );
      assert.deepEqual(
        [...new Set(appended.map(({ key }) => JSON.stringify(key)))],
        [JSON.stringify({ projectKey: RUNNER_TRANSCRIPTS.CURSOR_PROJECT, sessionId: resumed })],
      );
      const entries = appended.flatMap(({ entries: each }) => each);
      assert.ok(
        entries.some(
          (entry) =>
            JSON.stringify(entry) ===
            JSON.stringify({
              type: "checkpoint",
              agentId: resumed,
              blobId: "blob-first",
              data: "Zmlyc3Q=",
            }),
        ),
      );
    }),
);

it.effect(
  "makes the agent anew, led by our instructions, where the line a rewind dropped was its first",
  () =>
    Effect.gen(function* () {
      fakeTranscripts(TWO_TURNS_HELD);
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL, rewindBefore: LINE.FIRST });
      yield* write(message("Start over.", LINE_AFTER_REWIND));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.resumed, []);
      assert.deepEqual(
        cursor.created.map(({ agentId }) => agentId),
        [SESSION],
      );
      assert.deepEqual(
        cursor.sent.map(({ message: sent }) => sent.text),
        [
          "<coder_instructions>\nYou are a Vespin coding agent.\n</coder_instructions>\n\nStart over.",
        ],
      );
    }),
);

it.effect(
  "ends the launch failed where the service never takes the agent's store, so a turn the next launch cannot resume is never said kept",
  () =>
    Effect.gen(function* () {
      fakeTranscripts([], Number.POSITIVE_INFINITY);
      const service = fakeService();
      const { write, run } = yield* launch([{ messages: RECORDED_TURN }], service);
      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* outcomeOf(run), RUNNER_END.FAILED);
      assert.deepEqual(messagesOf(service.applied).at(-1), {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: "the agent's Cursor store could not be kept at the service",
      });
    }),
);

it.effect(
  "says the turn kept where the service takes the agent's store on a later try at the launch's end",
  () =>
    Effect.gen(function* () {
      // The service fails the mirror at the run's end and the launch's first try, then takes the next.
      const appended = fakeTranscripts([], 2);
      const { write, run } = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* outcomeOf(run), RUNNER_END.TURN_ENDED);
      assert.ok(
        appended
          .flatMap(({ entries }) => entries)
          .some((entry) => JSON.stringify(entry).includes(fakeBlobOf(1).blobId)),
      );
    }),
);

it.effect(
  "keeps a checkpoint larger than one call to the service can carry, and resumes the agent from it",
  () =>
    Effect.gen(function* () {
      const bytes = 4 * 1024 * 1024;
      const mirrored = fakeTranscripts();

      const first = yield* launch(
        [{ messages: RECORDED_TURN, checkpointBytes: bytes }],
        fakeService(),
      );

      yield* first.write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* first.write(message("Read the README.", LINE.FIRST));
      assert.equal(yield* Fiber.join(first.run), RUNNER_END.TURN_ENDED);

      fakeTranscripts(mirrored.flatMap(({ entries }) => entries));
      const second = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* second.write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* second.write(message("And the second line?", LINE.SECOND));

      assert.equal(yield* Fiber.join(second.run), RUNNER_END.TURN_ENDED);
      const checkpoint = second.cursor.resumed[0]?.checkpoint;
      assert.ok(checkpoint != null && Buffer.from(checkpoint).equals(fakeBlobOf(1, bytes).data));
    }),
);

it.effect("sends the next run while a mirror of the store the service has not answered waits", () =>
  Effect.gen(function* () {
    let appends = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const call = JSON.parse(String(init?.body));

      if (call.call !== RUNNER_TRANSCRIPTS.CALL.APPEND) {
        return Promise.resolve(new Response(JSON.stringify({ entries: [], next: null })));
      }

      appends += 1;

      // The first mirror the service never answers.
      return appends === 1 ? new Promise<Response>(() => {}) : Promise.resolve(new Response("{}"));
    });

    const service = fakeService("I");

    const { until, release, write, run } = yield* launch(
      [
        { messages: RECORDED_TURN, held: true, steered: "revert_to_followup" },
        { messages: RECORDED_TURN },
      ],
      service,
    );

    yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
    yield* write(message("Read the README.", LINE.FIRST));
    yield* service.seen;
    yield* write(message("And the second line?", LINE.SECOND));

    yield* until((seen) => seen.steers.length === 1);
    release();

    // The next run is sent before the clock moves, while the first mirror still waits.
    yield* until((seen) => seen.sent.length === 2);

    // The mirror the service never answered gives up, and the launch's last one keeps the store.
    assert.equal(yield* outcomeOf(run), RUNNER_END.TURN_ENDED);
  }),
);

it.effect(
  "steers a message into the run going, sends one Cursor hands back as a follow-up as the next run on the model a model line chose, and ends the turn after it",
  () =>
    Effect.gen(function* () {
      const service = fakeService("I");

      const { cursor, until, release, write, run } = yield* launch(
        [
          { messages: RECORDED_TURN, held: true, steered: "revert_to_followup" },
          { messages: RECORDED_TURN },
        ],
        service,
      );

      const fast = { id: "composer-2.5", params: [{ id: "fast", value: "true" }] };
      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));
      yield* service.seen;
      yield* write({ type: INPUT_LINE.MODEL, selection: fast });
      yield* write(message("And the second line?", LINE.SECOND));
      yield* until((seen) => seen.steers.length === 1);
      release();

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.steers, ["And the second line?"]);
      assert.deepEqual(
        cursor.sent.map(({ message: sent, options }) => [
          sent.text.endsWith("README."),
          options.model,
        ]),
        [
          [true, CONFIG.model],
          [false, fast],
        ],
      );
      assert.equal(cursor.sent[1]?.message.text, "And the second line?");
      assert.deepEqual(
        messagesOf(service.applied).flatMap((posted) =>
          "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED ? [posted.uuid] : [],
        ),
        [LINE.FIRST, LINE.SECOND],
      );
    }),
);

/** A launch on a host its member added, whose runner was somehow started holding a key, which a host's launch never reads. */
const ON_HOST = { ...ENV, [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST };

it.effect(
  "on a host, makes the agent on the machine's own Cursor sign-in, handing the SDK no key even where the runner holds one",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], service, ON_HOST);
      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [made] = cursor.created;
      assert.ok(made !== undefined);
      assert.equal("apiKey" in made, false);
    }),
);

it.effect(
  "on a host with no Cursor sign-in, makes no agent and ends the launch failed with words that say how to sign in",
  () =>
    Effect.gen(function* () {
      const service = fakeService();

      const { cursor, write, run } = yield* launch(
        [{ messages: RECORDED_TURN }],
        service,
        ON_HOST,
        {
          signedIn: false,
        },
      );

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.deepEqual(cursor.created, []);
      assert.deepEqual(messagesOf(service.applied).at(-1), {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: CURSOR_SIGNED_OUT_DETAIL,
      });
    }),
);

it.effect("cancels the run going on a Stop, and ends the launch stopped", () =>
  Effect.gen(function* () {
    const service = fakeService("I");

    const { write, run } = yield* launch([{ messages: RECORDED_TURN, held: true }], service);

    yield* write(CONFIG);
    yield* write(message("Read the README.", LINE.FIRST));
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP, launch: FIRST_SEQUENCE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.deepEqual(messagesOf(service.applied).at(-1), {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect(
  "cancels a run that streams nothing for its silence limit, and ends the launch failed with words the member reads",
  () =>
    Effect.gen(function* () {
      const service = fakeService("I");

      const { write, run } = yield* launch([{ messages: RECORDED_TURN, held: true }], service);

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));
      yield* service.seen;

      yield* TestClock.adjust(RUNNER_UNANSWERED.SILENCE_MS - 1);
      assert.equal(run.pollUnsafe(), undefined);
      yield* TestClock.adjust(1);

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.deepEqual(messagesOf(service.applied).at(-1), {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail:
          "Cursor stopped answering for 5 minutes, so the turn was ended. Send a message to try again.",
      });
    }),
);

it.effect(
  "counts a run silent once the model wrote again after a tool call Cursor left running",
  () =>
    Effect.gen(function* () {
      const service = fakeService("I");

      const call = (id: string, status: "running" | "completed"): SDKMessage => ({
        type: "tool_call",
        ...IDS,
        call_id: id,
        name: "shell",
        status,
        args: { command: "rm -rf build" },
      });

      const { write, run } = yield* launch(
        [
          {
            messages: [
              { type: "status", ...IDS, status: "RUNNING" },
              // Auto-review refused the call, which Cursor leaves running while the model tries again.
              call("call-1", "running"),
              { type: "thinking", ...IDS, text: "Refused; trying another way." },
              call("call-2", "running"),
              call("call-2", "completed"),
              {
                type: "assistant",
                ...IDS,
                message: { role: "assistant", content: [{ type: "text", text: "I" }] },
              },
            ],
            held: true,
          },
        ],
        service,
      );

      yield* write(CONFIG);
      yield* write(message("Clean the build.", LINE.FIRST));
      yield* service.seen;
      yield* TestClock.adjust(RUNNER_UNANSWERED.SILENCE_MS);

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    }),
);

it.effect("never counts a run silent while one of its tool calls runs", () =>
  Effect.gen(function* () {
    const service = fakeService("npm test");

    const { release, write, run } = yield* launch(
      [
        {
          messages: [
            { type: "status", ...IDS, status: "RUNNING" },
            {
              type: "tool_call",
              ...IDS,
              call_id: "call-2",
              name: "shell",
              status: "running",
              args: { command: "npm test" },
            },
          ],
          held: true,
        },
      ],
      service,
    );

    yield* write(CONFIG);
    yield* write(message("Run the tests.", LINE.FIRST));
    yield* service.seen;

    yield* TestClock.adjust(RUNNER_UNANSWERED.SILENCE_MS * 3);
    assert.equal(run.pollUnsafe(), undefined);
    release();

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
  }),
);

it.effect(
  "summarizes the conversation for a compact line, and leads the next message with the instructions the summary dropped",
  () =>
    Effect.gen(function* () {
      fakeTranscripts(TWO_TURNS_HELD);
      const service = fakeService();

      const { cursor, write, run } = yield* launch(
        [{ messages: SUMMARY }, { messages: RECORDED_TURN }],
        service,
      );

      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* write({
        type: INPUT_LINE.MESSAGE,
        uuid: LINE_AFTER_REWIND,
        content: [],
        compact: true,
      });
      yield* write(message("Go on.", LINE_AFTER_SUMMARY));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.summaries, [0]);
      assert.deepEqual(
        cursor.sent.map(({ message: sent }) => sent.text),
        ["<coder_instructions>\nYou are a Vespin coding agent.\n</coder_instructions>\n\nGo on."],
      );
    }),
);

it.effect(
  "leads the first message of a later launch with the instructions a summary dropped where the launch that summarized ended first",
  () =>
    Effect.gen(function* () {
      const mirrored = fakeTranscripts(TWO_TURNS_HELD);
      const first = yield* launch([{ messages: SUMMARY }], fakeService());
      yield* first.write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* first.write({
        type: INPUT_LINE.MESSAGE,
        uuid: LINE_AFTER_REWIND,
        content: [],
        compact: true,
      });
      assert.equal(yield* Fiber.join(first.run), RUNNER_END.TURN_ENDED);

      fakeTranscripts([...TWO_TURNS_HELD, ...mirrored.flatMap(({ entries }) => entries)]);
      const second = yield* launch([{ messages: RECORDED_TURN }], fakeService());
      yield* second.write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* second.write(message("Go on.", LINE_AFTER_SUMMARY));

      assert.equal(yield* Fiber.join(second.run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(
        second.cursor.sent.map(({ message: sent }) => sent.text),
        ["<coder_instructions>\nYou are a Vespin coding agent.\n</coder_instructions>\n\nGo on."],
      );
    }),
);

it.effect(
  "ends the turn of a compact line on an agent with no conversation yet without asking Cursor, as Claude Code's does",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cursor, write, run } = yield* launch([], service);

      yield* write(CONFIG);
      yield* write({ type: INPUT_LINE.MESSAGE, uuid: LINE.FIRST, content: [], compact: true });

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.summaries, []);
      assert.deepEqual(messagesOf(service.applied), [
        { type: RUNNER_EVENT.ACCEPTED, uuid: LINE.FIRST },
        { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
      ]);
    }),
);

it.effect(
  "takes a compact line before asking Cursor to summarize, so a summary it refuses fails the turn with its words rather than as a lost runner",
  () =>
    Effect.gen(function* () {
      const refused = "Cursor could not summarize the conversation.";
      fakeTranscripts(TWO_TURNS_HELD);
      const service = fakeService();
      const { write, run } = yield* launch([{ messages: [], refused }], service);

      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* write({
        type: INPUT_LINE.MESSAGE,
        uuid: LINE_AFTER_SUMMARY,
        content: [],
        compact: true,
      });

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.deepEqual(messagesOf(service.applied), [
        { type: RUNNER_EVENT.ACCEPTED, uuid: LINE_AFTER_SUMMARY },
        { type: RUNNER_EVENT.END, reason: RUNNER_END.FAILED, detail: refused },
      ]);
    }),
);

it.effect(
  "hands our server's tools to Cursor under the names Claude Code knows them by, and runs each call at the service under the runner's bearer",
  () =>
    Effect.gen(function* () {
      const { cursor, until, mcp, write, run } = yield* launch([], fakeService());

      yield* write(CONFIG);
      yield* until((seen) => seen.created.length === 1);

      const tools = cursor.created[0]?.local?.customTools ?? {};
      assert.deepEqual(Object.keys(tools), ["mcp__team__post_thread"]);

      const answer = yield* Effect.promise(async () =>
        tools.mcp__team__post_thread?.execute({ body: "Done." }, { toolCallId: "call-1" }),
      );

      yield* write({ type: INPUT_LINE.STOP });
      yield* Fiber.join(run);

      assert.deepEqual(answer, { content: [{ type: "text", text: "Posted." }], isError: false });
      assert.deepEqual(
        mcp.calls.map(({ body }) => body.method),
        ["initialize", "tools/list", "tools/call"],
      );
      assert.deepEqual(mcp.calls[2]?.body.params, {
        name: "post_thread",
        arguments: { body: "Done." },
      });
      assert.ok(mcp.calls.every(({ authorization }) => authorization === `Bearer ${BEARER}`));
    }),
);

it.effect(
  "answers a call of our tool the service never answers as the tool's error once the call's bound passes",
  () =>
    Effect.gen(function* () {
      const { cursor, until, mcp, write, run } = yield* launch([], fakeService(), ENV, {
        silentTools: true,
      });

      yield* write(CONFIG);
      yield* until((seen) => seen.created.length === 1);
      const tool = cursor.created[0]?.local?.customTools?.mcp__team__post_thread;
      assert.ok(tool !== undefined);

      const answering = yield* Effect.forkChild(
        Effect.promise(async () => tool.execute({ body: "Done." }, { toolCallId: "call-1" })),
      );

      yield* mcp.called;
      // Our tools' bound, `mcp-servers.ts`'s `MCP_TOOL_TIMEOUT_SECONDS`.
      yield* TestClock.adjust(Duration.seconds(800));

      assert.deepEqual(yield* Fiber.join(answering), {
        content: [{ type: "text", text: "post_thread could not be reached" }],
        isError: true,
      });
      yield* write({ type: INPUT_LINE.STOP });
      yield* Fiber.join(run);
    }),
);

it.effect.each([
  ["fails", "error", "Cursor's model refused the request."],
  ["is canceled by Cursor itself", "cancelled", "Cursor canceled the run."],
] as const)(
  "ends the launch failed with Cursor's words where its run %s",
  ([_case, status, error]) =>
    Effect.gen(function* () {
      const service = fakeService();
      const { write, run } = yield* launch([{ messages: RECORDED_TURN, status, error }], service);

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.deepEqual(messagesOf(service.applied).at(-1), {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: error,
      });
    }),
);

it.effect(
  "ends the launch, its run going let go, once the service refuses its events for good",
  () =>
    Effect.gen(function* () {
      const service = fakeService(undefined, [ANSWER.REFUSE]);

      const { write, run } = yield* launch([{ messages: RECORDED_TURN, held: true }], service);

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));

      const exit = yield* Fiber.await(run);
      assert.ok(Exit.isFailure(exit));
      assert.ok(Cause.squash(exit.cause) instanceof EventsUndelivered);
    }),
);

/** The IDLE a warm launch posts once its agent's turn is over, as it reaches the service. */
const IDLE_SEEN = `"type":"${RUNNER_EVENT.IDLE}"`;

it.effect("keeps a warm launch after its turn, posting IDLE, until a retire ends it as idled", () =>
  Effect.gen(function* () {
    const service = fakeService(IDLE_SEEN);
    const { write, run } = yield* launch([{ messages: RECORDED_TURN }], service);

    yield* write({ ...CONFIG, warm: true });
    yield* write(message("Read the README.", LINE.FIRST));
    yield* service.seen;
    assert.equal(run.pollUnsafe(), undefined);
    yield* write({ type: INPUT_LINE.RETIRE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
    assert.deepEqual(messagesOf(service.applied).slice(-2), [
      { type: RUNNER_EVENT.IDLE },
      { type: RUNNER_EVENT.END, reason: RUNNER_END.IDLED },
    ]);
  }),
);

it.effect("ends a warm launch as idled once its window passes with no message", () =>
  Effect.gen(function* () {
    const service = fakeService(IDLE_SEEN);
    const { write, run } = yield* launch([{ messages: RECORDED_TURN }], service);
    const warmForMs = 60_000;

    yield* write({ ...CONFIG, warm: true, warmForMs });
    yield* write(message("Read the README.", LINE.FIRST));
    yield* service.seen;
    yield* TestClock.adjust(warmForMs - 1);
    assert.equal(run.pollUnsafe(), undefined);
    yield* TestClock.adjust(1);

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
  }),
);

/** A message carrying a picture, as the service writes one. */
function pictureMessage(text: string, uuid: string): InputLine {
  return {
    type: INPUT_LINE.MESSAGE,
    uuid,
    content: [
      { type: "text", text },
      {
        type: "image",
        source: { type: "base64", media_type: IMAGE_MEDIA_TYPE.PNG, data: "iVBORw0K" },
      },
    ],
  };
}

it.effect(
  "never steers a message carrying a picture into the run going, and sends it as the next run with its picture",
  () =>
    Effect.gen(function* () {
      const service = fakeService("I");

      const { cursor, until, release, write, run } = yield* launch(
        [{ messages: RECORDED_TURN, held: true }, { messages: RECORDED_TURN }],
        service,
      );

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));
      yield* service.seen;
      yield* write(pictureMessage("What does this show?", LINE.SECOND));
      // Lines are taken in order, so once the next message is steered the picture's was taken.
      yield* write(message("And the second line?", LINE.THIRD));
      yield* until((seen) => seen.steers.length === 1);
      release();

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.steers, ["And the second line?"]);
      assert.deepEqual(cursor.sent[1]?.message, {
        text: "What does this show?",
        images: [{ data: "iVBORw0K", mimeType: IMAGE_MEDIA_TYPE.PNG }],
      });
    }),
);

it.effect(
  "summarizes for a compact line written while a run goes only once that run ends, since Cursor summarizes no agent at work",
  () =>
    Effect.gen(function* () {
      const service = fakeService("I");

      const { cursor, until, release, write, run } = yield* launch(
        [{ messages: RECORDED_TURN, held: true }, { messages: SUMMARY }],
        service,
      );

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));
      yield* service.seen;
      yield* write({ type: INPUT_LINE.MESSAGE, uuid: LINE.SECOND, content: [], compact: true });
      // Lines are taken in order, so once the next message is steered the compact line was taken.
      yield* write(message("And the second line?", LINE.THIRD));
      yield* until((seen) => seen.steers.length === 1);
      release();

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.summaries, [1]);
    }),
);
