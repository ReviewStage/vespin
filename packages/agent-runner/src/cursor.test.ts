/**
 * cursor.test.ts -- one Cursor launch of the runner against a scripted SDK playing the spike's recorded messages and a fake service: the agent made or resumed on the launch's key and mode, its store mirrored and read back, messages as runs and steers, Stop as a cancel, a summary's instructions, our tools as custom tools, and every message out in order.
 */

import assert from "node:assert/strict";
import type { SDKMessage } from "@cursor/sdk";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { type Cause, Effect, Fiber, Layer, Match, Option, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import {
  CURSOR_SIGNED_OUT_DETAIL,
  type CursorConfig,
  INPUT_LINE,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_PLACE,
  RUNNER_TRANSCRIPTS,
  RUNNER_UNANSWERED,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import { fakeAppServer } from "./testing/fake-app-server.js";
import { fakeCheckoutSnapshots, fakeSnapshotOf } from "./testing/fake-checkout-snapshots.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { type FakeRun, fakeBlobOf, fakeCursor } from "./testing/fake-cursor.js";
import { fakeProbe } from "./testing/fake-probe.js";
import { makeFakeService } from "./testing/fake-service.js";

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

/** The fake events route these launches post to, which settles `seen` once a message applied holds `watchFor`. */
function fakeService(watchFor?: string) {
  return makeFakeService({ url: EVENTS_URL, firstSequence: FIRST_SEQUENCE, watchFor });
}

/** Our MCP server as the service answers it: one tool, and each call's body and bearer kept. */
function fakeMcpRoute() {
  const calls: {
    readonly authorization: string | null;
    readonly body: { readonly method: string; readonly params?: unknown };
  }[] = [];

  const respond = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ authorization: new Headers(init.headers).get("authorization"), body });

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

  return { calls, respond };
}

/** One launch over stdin lines the test writes, against a fake SDK, a fake MCP route, and a fake service. */
function launch(
  runs: readonly FakeRun[],
  service: ReturnType<typeof fakeService>,
  env: Record<string, string> = ENV,
  machine: { readonly signedIn?: boolean } = {},
) {
  return Effect.gen(function* () {
    const cursor = fakeCursor(runs, machine);
    const mcp = fakeMcpRoute();
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

    return { cursor: cursor.record, release: cursor.release, mcp, write, run };
  });
}

/** Each message applied, in order. */
function messagesOf(events: readonly RunnerEvent[]) {
  return events.map(({ message: posted }) => posted);
}

/** The service's transcript store as `fetch` reaches it: every append kept, and a load answered with `held`. */
function fakeTranscripts(held: readonly unknown[] = []) {
  const appended: { readonly key: unknown; readonly entries: readonly unknown[] }[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const call = JSON.parse(String(init?.body));

    if (call.call === RUNNER_TRANSCRIPTS.CALL.APPEND) {
      appended.push({ key: call.key, entries: call.entries });
    }

    const answer =
      call.call === RUNNER_TRANSCRIPTS.CALL.LOAD_PAGE ? { entries: held, next: null } : {};

    return new Response(JSON.stringify(answer));
  });

  return appended;
}

it.effect(
  "makes the agent under the service's id on its key alone, keeps the key and the bearer from its shell, runs Auto as Auto-review with no sandbox, leads the first message with our instructions, and posts every message Cursor streams between ACCEPTED and END",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cursor, write, run } = yield* launch([{ messages: RECORDED_TURN }], service);

      yield* write({ ...CONFIG, permissionMode: PERMISSION_MODE.AUTO });
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [made] = cursor.created;
      assert.equal(made?.agentId, SESSION);
      assert.equal(made?.apiKey, CURSOR_KEY);
      assert.deepEqual(made?.model, CONFIG.model);
      assert.equal(made?.local?.cwd, CONFIG.cwd);
      assert.deepEqual(made?.local?.settingSources, ["project"]);
      assert.equal(made?.local?.autoReview, true);
      assert.equal(made?.local?.sandboxOptions, undefined);
      assert.equal(made?.mcpServers, undefined);
      // Note that the shell runs from the runner's own process, so the runner takes its secrets out of it first.
      assert.deepEqual(cursor.environment, [
        {
          PLAYWRIGHT_BROWSERS_PATH: "0",
          NODE_PATH: "/usr/local/lib/node_modules",
          [RUNNER_ENV.BEARER]: undefined,
          [RUNNER_ENV.CLAUDE_TOKEN]: undefined,
          [RUNNER_ENV.API_KEY]: undefined,
          [RUNNER_ENV.OPENAI_API_KEY]: undefined,
          [RUNNER_ENV.CURSOR_API_KEY]: undefined,
        },
      ]);
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
      assert.ok(cursor.closed);
      assert.ok(!service.bodies.join("").includes(CURSOR_KEY));
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
      vi.restoreAllMocks();
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
      vi.restoreAllMocks();
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
      vi.restoreAllMocks();
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
      vi.restoreAllMocks();
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
      vi.restoreAllMocks();
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
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const call = JSON.parse(String(init?.body));

        return call.call === RUNNER_TRANSCRIPTS.CALL.APPEND
          ? new Response(null, { status: 503 })
          : new Response(JSON.stringify({ entries: [], next: null }));
      });

      const service = fakeService();
      const { write, run } = yield* launch([{ messages: RECORDED_TURN }], service);
      yield* write({ ...CONFIG, transcriptsUrl: TRANSCRIPTS_URL });
      yield* write(message("Read the README.", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      vi.restoreAllMocks();
      assert.deepEqual(messagesOf(service.applied).at(-1), {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: "the agent's Cursor store could not be kept at the service",
      });
    }),
);

it.effect(
  "steers a message into the run going, sends one Cursor hands back as a follow-up as the next run on the model a model line chose, and ends the turn after it",
  () =>
    Effect.gen(function* () {
      const service = fakeService("I");

      const { cursor, release, write, run } = yield* launch(
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

      for (let step = 0; step < 500 && cursor.steers.length === 0; step += 1) {
        yield* Effect.yieldNow;
      }

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

    const { cursor, write, run } = yield* launch(
      [{ messages: RECORDED_TURN, held: true }],
      service,
    );

    yield* write(CONFIG);
    yield* write(message("Read the README.", LINE.FIRST));
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP, launch: FIRST_SEQUENCE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cursor.cancels, 1);
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

      const { cursor, write, run } = yield* launch(
        [{ messages: RECORDED_TURN, held: true }],
        service,
      );

      yield* write(CONFIG);
      yield* write(message("Read the README.", LINE.FIRST));
      yield* service.seen;

      yield* TestClock.adjust(RUNNER_UNANSWERED.SILENCE_MS - 1);
      assert.equal(run.pollUnsafe(), undefined);
      yield* TestClock.adjust(1);

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.equal(cursor.cancels, 1);
      assert.deepEqual(messagesOf(service.applied).at(-1), {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail:
          "Cursor stopped answering for 5 minutes, so the turn was ended. Send a message to try again.",
      });
    }),
);

it.effect("never counts a run silent while one of its tool calls runs", () =>
  Effect.gen(function* () {
    const service = fakeService("npm test");

    const { cursor, release, write, run } = yield* launch(
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
    assert.equal(cursor.cancels, 0);
    release();

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
  }),
);

it.effect(
  "summarizes the conversation for a compact line, and leads the next message with the instructions the summary dropped",
  () =>
    Effect.gen(function* () {
      const service = fakeService();

      const { cursor, write, run } = yield* launch(
        [{ messages: SUMMARY }, { messages: RECORDED_TURN }],
        service,
      );

      yield* write(CONFIG);
      yield* write({ type: INPUT_LINE.MESSAGE, uuid: LINE.FIRST, content: [], compact: true });
      yield* write(message("Go on.", LINE.SECOND));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cursor.summaries, [0]);
      assert.deepEqual(
        cursor.sent.map(({ message: sent }) => sent.text),
        ["<coder_instructions>\nYou are a Vespin coding agent.\n</coder_instructions>\n\nGo on."],
      );
    }),
);

it.effect(
  "hands our server's tools to Cursor under the names Claude Code knows them by, and runs each call at the service under the runner's bearer",
  () =>
    Effect.gen(function* () {
      const { cursor, mcp, write, run } = yield* launch([], fakeService());

      yield* write(CONFIG);

      for (let step = 0; step < 500 && cursor.created.length === 0; step += 1) {
        yield* Effect.yieldNow;
      }

      const tools = cursor.created[0]?.local?.customTools ?? {};
      assert.deepEqual(Object.keys(tools), ["mcp__team__post_thread"]);
      assert.equal(cursor.created[0]?.local?.autoReview, undefined);

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
