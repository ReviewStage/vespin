/**
 * runner.test.ts -- one launch of the runner against a scripted CLI playing P00's recorded stream and a fake service: the config line in, messages in, Stop, every event out in order through failed posts, a heartbeat while the CLI says nothing, and the launch's end where the agent's turn ends.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { it } from "@effect/vitest";
import type { WireValue } from "@repo/wire";
import { type FakeResponder, fakeHttpClientLayer } from "@repo/wire/testing";
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { claudeCodeLive } from "./claude-code.js";
import { EventsUndelivered } from "./events.js";
import { RunnerFailed } from "./launch.js";
import {
  APPROVAL_BY,
  APPROVAL_DECISION,
  CONNECTION_LOST_DETAIL,
  connectionLostFailure,
  EFFORT,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HEARTBEAT,
  RUNNER_LINES,
  RUNNER_PLACE,
  RUNNER_RECONNECT,
  RUNNER_UNANSWERED,
  type RunnerConfig,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import { fakeAppServer } from "./testing/fake-app-server.js";
import {
  fakeCheckoutSnapshots,
  fakeFilesOf,
  fakeSnapshotOf,
} from "./testing/fake-checkout-snapshots.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { fakeProbe } from "./testing/fake-probe.js";
import { ANSWER, type Answer, makeFakeService } from "./testing/fake-service.js";
import {
  ASKED_COMMAND,
  ASKED_STOPPED_TURN,
  ASKED_THEN_MESSAGE,
  ASKED_TURN,
  BASH_ASK,
  CONNECTION_LOST_TURN,
  CONNECTION_LOST_TWICE,
  CREDENTIAL_REFUSED_TURN,
  FOLLOW_UP_TURNS,
  GOAL_CLEARED_TURN,
  SHORT_TURN,
  STOPPED_COMMAND,
  STOPPED_TURN,
  STRAY_RESULT,
  STRAY_RESULT_THEN_SILENCE,
  STRAY_RESULT_THEN_TURN,
  type Step,
  TURN_DONE,
  WAKEUP,
  WAKEUP_STOPPED_TURN,
  WAKEUP_WAIT,
  WARM_TURNS,
  WORKFLOW_TURN,
} from "./testing/recorded-stream.js";
import { ProfilerImport } from "./trace.js";

const BEARER = "runner-bearer-for-tests";

/**
 * What the CLI's credential variable holds, which the runner hands on and
 * takes out of every event alike: in a sandbox the launch's placeholder, on a
 * host the plan's token. Note the quote, the backslash, and the newline, which
 * a token's JSON spells escaped.
 */
const CLAUDE_TOKEN = 'plan-token-"for\\tests\n';
const EVENTS_URL = "https://app.test/runner/events";
const FIRST_SEQUENCE = 7;

const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  [RUNNER_ENV.CLAUDE_TOKEN]: CLAUDE_TOKEN,
  PATH: "/usr/bin",
};

const CONFIG: RunnerConfig = {
  cwd: "/workspace/repository",
  agentId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  executable: "/opt/claude/bin/claude",
  model: "claude-sonnet",
  effort: EFFORT.HIGH,
  append: "You are a Vespin coding agent.",
  resume: "00000000-0000-4000-8000-000000000001",
  firstSequence: FIRST_SEQUENCE,
  eventsUrl: EVENTS_URL,
  mcpUrl: "https://app.test/runner/mcp",
  integrations: [{ name: "linear", url: "https://app.test/runner/mcp/integrations/linear" }],
};

/** The integration server the config hands the agent. */
const LINEAR_SERVER = { name: "linear", url: "https://app.test/runner/mcp/integrations/linear" };

const FIRST_MESSAGE: InputLine = {
  type: INPUT_LINE.MESSAGE,
  content: [
    { type: "text", text: "Run Vespin's probe." },
    {
      type: "image",
      source: { type: "base64", media_type: IMAGE_MEDIA_TYPE.PNG, data: "iVBORw0K" },
    },
  ],
};

/** The fake events route these launches post to. */
function fakeService(answers: readonly Answer[] = [], watchFor?: string) {
  return makeFakeService({
    url: EVENTS_URL,
    firstSequence: FIRST_SEQUENCE,
    answers,
    watchFor,
  });
}

/** The events applied, less each ACCEPTED, which its own test follows, so a turn's shape reads alone. */
function withoutAccepted(events: readonly RunnerEvent[]): RunnerEvent[] {
  return events.filter(
    ({ message }) => !("type" in message && message.type === RUNNER_EVENT.ACCEPTED),
  );
}

/** The `type`, and `subtype` where it has one, of each message applied but an ACCEPTED, in order. */
function kinds(events: readonly RunnerEvent[]): string[] {
  return withoutAccepted(events).map(({ message }) => {
    if (!("type" in message)) return message.method;
    const subtype = "subtype" in message ? message.subtype : undefined;

    return subtype === undefined ? message.type : `${message.type}/${subtype}`;
  });
}

/** One launch over stdin lines the test writes, against a fake CLI and a fake service. */
function launch(
  steps: readonly Step[],
  service: ReturnType<typeof fakeService>,
  env: Record<string, string> = ENV,
  chain: readonly string[] | null = [],
  answering = true,
  probe = fakeProbe(),
  changed = false,
) {
  return Effect.gen(function* () {
    const cli = yield* fakeClaudeCode(steps, chain, answering);
    const stdin = yield* Queue.unbounded<string, Cause.Done>();
    const writeText = (text: string) => Queue.offer(stdin, text);
    const write = (line: RunnerConfig | InputLine) => writeText(JSON.stringify(line));

    const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          cli.layer,
          service.layer,
          fakeAppServer([]).layer,
          probe.layer,
          fakeCheckoutSnapshots(false, changed).layer,
        ),
      ),
      Effect.forkScoped,
    );

    return {
      cli: cli.record,
      prompted: cli.prompted,
      release: cli.release,
      write,
      writeText,
      run,
      probed: probe.record,
      closeStdin: Queue.end(stdin),
    };
  });
}

/** A launch's outcome, with the test clock moved on until it has one, for the retries' waits. */
function settled<A, E>(fiber: Fiber.Fiber<A, E>) {
  return Effect.gen(function* () {
    for (;;) {
      const exit = fiber.pollUnsafe();

      if (exit !== undefined) return exit;
      yield* TestClock.adjust("1 second");
    }
  });
}

it.effect("posts a waiting turn in order and ends the launch only once nothing is pending", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { cli, write, run } = yield* launch(WORKFLOW_TURN, service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.deepEqual(kinds(service.applied), [
      "system/init",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
      "assistant",
      "result/success",
      RUNNER_EVENT.WAITING,
      "stream_event",
      "stream_event",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
    assert.deepEqual(
      service.applied.map(({ sequence }) => sequence),
      service.applied.map((_, index) => FIRST_SEQUENCE + index),
    );
    const posted = withoutAccepted(service.applied);
    const waiting = posted[8]?.message;
    assert.ok(waiting !== undefined && "type" in waiting && waiting.type === RUNNER_EVENT.WAITING);
    assert.equal(waiting.background_tasks.length, 1);
    assert.equal(waiting.session_crons.length, 1);
    assert.ok(JSON.stringify(posted[11]?.message).includes(TURN_DONE.FIRST));
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.TURN_ENDED,
    });

    assert.deepEqual(cli.prompts[0]?.message, {
      role: "user",
      content: FIRST_MESSAGE.type === INPUT_LINE.MESSAGE ? FIRST_MESSAGE.content : [],
    });
    assert.equal(cli.prompts[0]?.priority, undefined);
    assert.equal(cli.closed, true);
    assert.ok(service.bearers.every((header) => header === `Bearer ${BEARER}`));
  }),
);

it.effect(
  "hands a stop to the CLI during a long foreground command, and a message and a model change while the turn runs",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], STOPPED_COMMAND);
      const { cli, prompted, write, run } = yield* launch(STOPPED_TURN, service);
      yield* write(CONFIG);
      yield* write({
        type: INPUT_LINE.MESSAGE,
        content: [{ type: "text", text: "Run sleep 600." }],
      });
      yield* service.seen;

      yield* write({
        type: INPUT_LINE.MESSAGE,
        content: [{ type: "text", text: "And then stop." }],
      });
      yield* Queue.take(prompted);
      yield* Queue.take(prompted);
      yield* write({
        type: INPUT_LINE.MODEL,
        model: "claude-opus",
        effort: EFFORT.LOW,
        fast: true,
      });
      yield* write({ type: INPUT_LINE.MODEL, fast: false });
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      assert.equal(cli.interrupts, 1);
      assert.deepEqual(
        cli.prompts.map((prompt) => prompt.priority),
        [undefined, "next"],
      );
      assert.deepEqual(cli.models, ["claude-opus"]);
      assert.deepEqual(cli.efforts, [EFFORT.LOW]);
      assert.deepEqual(cli.fastModes, [true, false]);
      assert.deepEqual(kinds(service.applied).slice(-2), [
        "result/error_during_execution",
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.STOPPED,
      });
    }),
);

it.effect(
  "takes Vespin's later lines past a model change the CLI never answers, and ends on a Stop it never answers",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], STOPPED_COMMAND);
      const { cli, prompted, write, run } = yield* launch(STOPPED_TURN, service, ENV, [], false);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;
      yield* Queue.take(prompted);
      yield* write({ type: INPUT_LINE.MODEL, model: "claude-opus", effort: EFFORT.LOW });
      yield* write({
        type: INPUT_LINE.MESSAGE,
        content: [{ type: "text", text: "And then stop." }],
      });
      yield* write({ type: INPUT_LINE.STOP });

      assert.deepEqual(yield* settled(run), Exit.succeed(RUNNER_END.STOPPED));
      assert.deepEqual(cli.models, ["claude-opus"]);
      assert.equal(cli.prompts.length, 2);
      assert.equal(cli.interrupts, 1);
      assert.equal(cli.closed, true);
    }),
);

it.effect(
  "a /goal line sent mid-turn, a clear or a new goal, interrupts the turn a goal holds open, and the launch goes on until the CLI runs it as a turn of its own",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], "Working toward the goal.");
      const { prompted, write, run } = yield* launch(GOAL_CLEARED_TURN, service);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;
      yield* Queue.take(prompted);
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "/goal clear" }] });

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      // The cut-off turn's result, then the clear's own, before the launch's end.
      assert.deepEqual(kinds(service.applied).slice(-3), [
        "result/error_during_execution",
        "result/success",
        RUNNER_EVENT.END,
      ]);
    }),
);

it.effect(
  "fails a launch whose CLI never answers the interrupt a mid-turn /goal line needs, rather than queue the command behind the turn",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], "Working toward the goal.");
      const { prompted, write, run } = yield* launch(GOAL_CLEARED_TURN, service, ENV, [], false);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;
      yield* Queue.take(prompted);
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "/goal clear" }] });

      assert.deepEqual(yield* settled(run), Exit.succeed(RUNNER_END.FAILED));
    }),
);

it.effect("skips a stop meant for another launch's turn, and takes the one naming its own", () =>
  Effect.gen(function* () {
    const service = fakeService([], STOPPED_COMMAND);
    const { cli, write, run } = yield* launch(STOPPED_TURN, service);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Run sleep 600." }] });
    yield* service.seen;

    // A Stop of the launch before this one, delayed past it: its turn is not this launch's.
    yield* write({ type: INPUT_LINE.STOP, launch: FIRST_SEQUENCE - 7 });
    yield* write({ type: INPUT_LINE.STOP, launch: FIRST_SEQUENCE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 1);
  }),
);

it.effect("keeps the CLI up for a message sent during a turn until a turn answers it", () =>
  Effect.gen(function* () {
    const service = fakeService([], "Working on the first message.");
    const { cli, prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* service.seen;
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
    yield* Queue.take(prompted);
    yield* Queue.take(prompted);
    yield* release;

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.deepEqual(
      cli.prompts.map((prompt) => prompt.priority),
      [undefined, "next"],
    );
    assert.deepEqual(kinds(service.applied), [
      "system/init",
      "assistant",
      "result/success",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
  }),
);

it.effect(
  "keeps the CLI up past a result that names no prompt until the turn that answers Vespin's message",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { write, run } = yield* launch(STRAY_RESULT_THEN_TURN, service);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(kinds(service.applied), [
        "system/init",
        "result/success",
        "assistant",
        "result/success",
        RUNNER_EVENT.END,
      ]);
    }),
);

it.effect(
  "ends as failed, saying why, a launch whose CLI says nothing of the message a stray result left, once its bound passes",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], STRAY_RESULT.uuid);
      const { cli, write, run } = yield* launch(STRAY_RESULT_THEN_SILENCE, service);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;

      yield* TestClock.adjust(RUNNER_UNANSWERED.SILENCE_MS - 1);
      assert.equal(run.pollUnsafe(), undefined);
      yield* TestClock.adjust(1);
      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.equal(cli.closed, true);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: "the CLI never took up a message a result left",
      });
    }),
);

/** The API's host the connection-lost turns probe for, as the CLI reaches it with no base URL set. */
const ANTHROPIC_HOST = "api.anthropic.com";

/** The carry-on line the service sends once the host answers, as a message line. */
const CARRY_ON_LINE: InputLine = {
  type: INPUT_LINE.MESSAGE,
  uuid: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e11",
  content: [{ type: "text", text: "Your previous turn was interrupted; carry on." }],
};

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
  "keeps the launch up when the CLI loses the API, probes the host on a doubling wait, and asks for a carry-on once it answers",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const probe = fakeProbe(2);

      const { cli, write, run, probed } = yield* launch(
        CONNECTION_LOST_TURN,
        service,
        ENV,
        [],
        true,
        probe,
      );

      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_LOST);
      assert.equal(run.pollUnsafe(), undefined, "the launch stays up");
      assert.deepEqual(probed.targets[0], { host: ANTHROPIC_HOST, port: 443 });

      // Refused at once and after the first wait; answered after the doubled one.
      yield* TestClock.adjust(RUNNER_RECONNECT.FIRST_WAIT_MS);
      assert.equal(probed.targets.length, 2);
      yield* TestClock.adjust(RUNNER_RECONNECT.FIRST_WAIT_MS * 2 - 1);
      assert.equal(probed.targets.length, 2);
      yield* TestClock.adjust(1);
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_RESTORED);
      assert.equal(probed.targets.length, 3);

      // The service's carry-on line runs as the CLI's next turn, which ends the launch as any turn does.
      yield* write(CARRY_ON_LINE);
      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(kinds(service.applied), [
        "system/init",
        "assistant",
        "result/success",
        RUNNER_EVENT.CONNECTION_LOST,
        RUNNER_EVENT.CONNECTION_RESTORED,
        "assistant",
        "result/success",
        RUNNER_EVENT.END,
      ]);

      const restored = service.applied.find(
        ({ message }) => "type" in message && message.type === RUNNER_EVENT.CONNECTION_RESTORED,
      )?.message;

      assert.deepEqual(restored, {
        type: RUNNER_EVENT.CONNECTION_RESTORED,
        host: ANTHROPIC_HOST,
        carryOn: true,
      });
      assert.equal(cli.prompts.length, 2);
      assert.equal(
        cli.prompts[1]?.uuid,
        CARRY_ON_LINE.type === INPUT_LINE.MESSAGE ? CARRY_ON_LINE.uuid : "",
      );
    }),
);

it.effect(
  "hands a message sent while the host is probed to the CLI once it answers, in place of a carry-on",
  () =>
    Effect.gen(function* () {
      const service = fakeService();

      const { cli, write, run } = yield* launch(
        CONNECTION_LOST_TURN,
        service,
        ENV,
        [],
        true,
        fakeProbe(1),
      );

      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_LOST);
      yield* write(CARRY_ON_LINE);
      yield* Effect.yieldNow;
      assert.equal(cli.prompts.length, 1, "the message waits for the host");

      yield* TestClock.adjust(RUNNER_RECONNECT.FIRST_WAIT_MS);
      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);

      const restored = service.applied.find(
        ({ message }) => "type" in message && message.type === RUNNER_EVENT.CONNECTION_RESTORED,
      )?.message;

      assert.deepEqual(restored, {
        type: RUNNER_EVENT.CONNECTION_RESTORED,
        host: ANTHROPIC_HOST,
        carryOn: false,
      });
      assert.equal(cli.prompts.length, 2);
    }),
);

it.effect("ends the launch failed, saying why, once the host stays silent past the wait", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const { cli, write, run } = yield* launch(
      CONNECTION_LOST_TURN,
      service,
      ENV,
      [],
      true,
      fakeProbe(Number.POSITIVE_INFINITY),
    );

    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* untilPosted(service, RUNNER_EVENT.CONNECTION_LOST);
    const lostAt = yield* Clock.currentTimeMillis;

    const exit = yield* settled(run);
    assert.deepEqual(exit, Exit.succeed(RUNNER_END.FAILED));
    const gaveUpAfter = (yield* Clock.currentTimeMillis) - lostAt;
    assert.ok(gaveUpAfter >= RUNNER_RECONNECT.GIVE_UP_MS, `gave up after ${gaveUpAfter}ms`);
    assert.ok(
      gaveUpAfter < RUNNER_RECONNECT.GIVE_UP_MS + RUNNER_RECONNECT.LONGEST_WAIT_MS * 2,
      `gave up after ${gaveUpAfter}ms`,
    );
    assert.equal(cli.closed, true);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: connectionLostFailure(ANTHROPIC_HOST, CONNECTION_LOST_DETAIL.GAVE_UP),
    });
  }),
);

it.effect(
  "ends the launch failed where the connection is lost again before the model answered, rather than probing again",
  () =>
    Effect.gen(function* () {
      const service = fakeService();

      const { write, run, probed } = yield* launch(
        CONNECTION_LOST_TWICE,
        service,
        ENV,
        [],
        true,
        fakeProbe(),
      );

      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* untilPosted(service, RUNNER_EVENT.CONNECTION_RESTORED);
      yield* write(CARRY_ON_LINE);

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.equal(probed.targets.length, 1);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: connectionLostFailure(ANTHROPIC_HOST, CONNECTION_LOST_DETAIL.LOST_AGAIN),
      });
    }),
);

it.effect("ends a stopped launch at once while the host is probed", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const { write, run } = yield* launch(
      CONNECTION_LOST_TURN,
      service,
      ENV,
      [],
      true,
      fakeProbe(Number.POSITIVE_INFINITY),
    );

    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* untilPosted(service, RUNNER_EVENT.CONNECTION_LOST);
    yield* write({ type: INPUT_LINE.STOP });
    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
  }),
);

it.effect("ends the turn as before on a model call the API refused, probing nothing", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { write, run, probed } = yield* launch(CREDENTIAL_REFUSED_TURN, service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.equal(probed.targets.length, 0);
    assert.deepEqual(kinds(service.applied), ["system/init", "result/success", RUNNER_EVENT.END]);
  }),
);

/** The probe's target: the proxy the CLI goes through where one is set, the host where the proxy value names no host, and a gateway's own port where the base URL names one. */
it.effect.each([
  {
    env: { HTTPS_PROXY: "http://proxy.corp.test:3128" },
    target: { host: "proxy.corp.test", port: 3128 },
  },
  { env: { HTTPS_PROXY: "proxy.corp.test:3128" }, target: { host: ANTHROPIC_HOST, port: 443 } },
  {
    env: { ANTHROPIC_BASE_URL: "http://gateway.internal:8080/v1" },
    target: { host: "gateway.internal", port: 8080 },
  },
])("probes where the CLI reaches the API, given $env", ({ env, target }) =>
  Effect.gen(function* () {
    const service = fakeService();

    const { write, run, probed } = yield* launch(
      CONNECTION_LOST_TURN,
      service,
      { ...ENV, ...env },
      [],
      true,
      fakeProbe(),
    );

    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* untilPosted(service, RUNNER_EVENT.CONNECTION_RESTORED);
    assert.deepEqual(probed.targets, [target]);
    yield* write(CARRY_ON_LINE);
    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
  }),
);

/** How many IDLE events the service has taken. */
function idles(service: ReturnType<typeof fakeService>): number {
  return service.applied.filter(
    ({ message }) => "type" in message && message.type === RUNNER_EVENT.IDLE,
  ).length;
}

/** Waits, without moving the clock, until the service has taken the IDLE events given. */
function untilIdles(service: ReturnType<typeof fakeService>, count: number) {
  return Effect.gen(function* () {
    for (let step = 0; step < 5_000 && idles(service) < count; step += 1) yield* Effect.yieldNow;
    assert.equal(idles(service), count);
  });
}

const WARM_CONFIG: RunnerConfig = { ...CONFIG, warm: true };

it.effect(
  "keeps a warm launch up past its turn, posting IDLE, takes the next message as a fresh turn of the same CLI, and ends as idled when Vespin retires it",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cli, write, run } = yield* launch(WARM_TURNS, service);
      yield* write(WARM_CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* untilIdles(service, 1);
      assert.equal(run.pollUnsafe(), undefined, "the launch stays up past its turn");

      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "And this." }] });
      yield* untilIdles(service, 2);
      yield* write({ type: INPUT_LINE.RETIRE });

      assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
      assert.deepEqual(kinds(service.applied), [
        "system/init",
        "assistant",
        "result/success",
        RUNNER_EVENT.IDLE,
        "assistant",
        "result/success",
        RUNNER_EVENT.IDLE,
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.IDLED,
      });
      // The second message found no turn running, so it is no follow-up queued behind one.
      assert.deepEqual(
        cli.prompts.map((prompt) => prompt.priority),
        [undefined, undefined],
      );
      assert.equal(cli.closed, true);
    }),
);

it.effect(
  "a message taken while the turn waits on a wakeup joins that turn, whose IDLE counts its files from the snapshot its first message opened on",
  () =>
    Effect.gen(function* () {
      const service = fakeService();

      const { write, run } = yield* launch(
        [...WAKEUP_WAIT.slice(0, -1), ...WARM_TURNS.slice(-4)],
        service,
        ENV,
        [],
        true,
        fakeProbe(),
        true,
      );

      const first = "6f1c2a4e-3b7d-4c8e-9a0b-1d2e3f405162";
      yield* write(WARM_CONFIG);
      yield* write({ ...FIRST_MESSAGE, uuid: first });

      for (let step = 0; step < 5_000; step += 1) {
        if (kinds(service.applied).includes(RUNNER_EVENT.WAITING)) break;
        yield* Effect.yieldNow;
      }

      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "And this." }] });
      yield* untilIdles(service, 1);
      yield* write({ type: INPUT_LINE.RETIRE });

      assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
      assert.deepEqual(
        service.applied.find(
          ({ message }) => "type" in message && message.type === RUNNER_EVENT.IDLE,
        )?.message,
        { type: RUNNER_EVENT.IDLE, files: fakeFilesOf(fakeSnapshotOf(CONFIG.cwd, first).commit) },
      );
    }),
);

it.effect("a retire written behind a message is skipped, and the message's turn runs", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { write, run } = yield* launch(WARM_TURNS, service);
    yield* write(WARM_CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* untilIdles(service, 1);

    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "And this." }] });
    yield* write({ type: INPUT_LINE.RETIRE });
    yield* untilIdles(service, 2);
    assert.equal(run.pollUnsafe(), undefined, "the retire behind the message ended nothing");
    yield* write({ type: INPUT_LINE.RETIRE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
  }),
);

it.effect(
  "takes Vespin's lines from the read its config names, past its cursor and its stdin's end",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const linesUrl = "https://app.test/runner/lines";
      const uuid = "00000000-0000-4000-8000-0000000000aa";
      const reads: { launch: string | null; after: string | null; bearer: string | null }[] = [];

      // The first read is answered the message; every later one is held until the launch lets it go.
      const respond: FakeResponder = (url, init) => {
        if (!url.startsWith(linesUrl)) return service.respond(url, init);
        const query = new URL(url).searchParams;
        reads.push({
          launch: query.get(RUNNER_LINES.QUERY.LAUNCH),
          after: query.get(RUNNER_LINES.QUERY.AFTER),
          bearer: new Headers(init.headers).get("authorization"),
        });

        if (reads.length > 1) {
          return new Promise<Response>((_, reject) =>
            init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          );
        }

        const lines = [{ seq: 12, text: JSON.stringify({ ...FIRST_MESSAGE, uuid }) }];

        return Response.json({ lines });
      };

      const { cli, write, run, closeStdin } = yield* launch(SHORT_TURN, {
        ...service,
        layer: fakeHttpClientLayer(respond),
      });

      yield* write({ ...CONFIG, linesUrl });
      yield* closeStdin;

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(reads, [
        { launch: String(FIRST_SEQUENCE), after: "0", bearer: `Bearer ${BEARER}` },
        { launch: String(FIRST_SEQUENCE), after: "12", bearer: `Bearer ${BEARER}` },
      ]);
      assert.equal(cli.prompts[0]?.uuid, uuid);
      assert.ok(
        service.applied.some(
          ({ message }) =>
            "type" in message && message.type === RUNNER_EVENT.ACCEPTED && message.uuid === uuid,
        ),
      );
    }),
);

it.effect("takes its line from the read on a traced launch whose profiler cannot load", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const linesUrl = "https://app.test/runner/lines";
    const uuid = "00000000-0000-4000-8000-0000000000ab";
    let read = false;

    // The first read is answered the message; every later one is held until the launch lets it go.
    const respond: FakeResponder = (url, init) => {
      if (!url.startsWith(linesUrl)) return service.respond(url, init);

      if (read) {
        return new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }

      read = true;

      return Response.json({
        lines: [{ seq: 12, text: JSON.stringify({ ...FIRST_MESSAGE, uuid }) }],
      });
    };

    // A sandbox whose disk predates the profiler's binary cannot load its module.
    const unloadable = Layer.succeed(ProfilerImport, () =>
      Promise.reject(
        new Error("Cannot find module './sentry_cpu_profiler-linux-x64-glibc-137.node'"),
      ),
    );

    const { cli, write, run, closeStdin } = yield* launch(SHORT_TURN, {
      ...service,
      layer: Layer.merge(fakeHttpClientLayer(respond), unloadable),
    });

    // Note that the trace names no DSN, so Sentry sends nothing from the test.
    const trace = {
      dsn: "",
      environment: "test",
      sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
    };

    yield* write({ ...CONFIG, linesUrl, trace });
    yield* closeStdin;

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.equal(cli.prompts[0]?.uuid, uuid);
  }),
);

it.effect("ends the launch as failed, saying why, when Vespin refuses its line read for good", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const linesUrl = "https://app.test/runner/lines";

    const respond: FakeResponder = (url, init) =>
      url.startsWith(linesUrl) ? new Response(null, { status: 401 }) : service.respond(url, init);

    const { cli, write, run, closeStdin } = yield* launch(SHORT_TURN, {
      ...service,
      layer: fakeHttpClientLayer(respond),
    });

    yield* write({ ...CONFIG, linesUrl });
    yield* closeStdin;

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    const end = service.applied.at(-1)?.message;
    assert.ok(end !== undefined && "type" in end && end.type === RUNNER_EVENT.END);
    assert.match(String("detail" in end ? end.detail : ""), /refused the launch's lines.*401/);
    assert.equal(cli.closed, true);
  }),
);

it.effect("a warm launch nobody retires ends as idled once the window it was handed passes", () =>
  Effect.gen(function* () {
    const warmForMs = 5 * 60 * 1_000;
    const service = fakeService();
    const { write, run } = yield* launch(SHORT_TURN, service);
    yield* write({ ...WARM_CONFIG, warmForMs });
    yield* write(FIRST_MESSAGE);
    yield* untilIdles(service, 1);
    yield* TestClock.adjust(Duration.millis(warmForMs - 1));
    assert.equal(run.pollUnsafe(), undefined);

    yield* TestClock.adjust(Duration.millis(1));

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
  }),
);

it.effect("a warm line runs a warm launch's window again from now", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { write, run } = yield* launch(SHORT_TURN, service);
    yield* write({ ...WARM_CONFIG, warmForMs: 60_000 });
    yield* write(FIRST_MESSAGE);
    yield* untilIdles(service, 1);
    yield* TestClock.adjust(Duration.seconds(50));
    yield* write({ type: INPUT_LINE.WARM });

    // The input loop's fiber takes the line, which leaves nothing to wait on but its turn to run.
    for (let step = 0; step < 50; step += 1) yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(50));

    const ended = () =>
      service.applied.some(({ message }) => "type" in message && message.type === RUNNER_EVENT.END);

    for (let step = 0; step < 500 && !ended(); step += 1) yield* Effect.yieldNow;
    assert.equal(ended(), false, "the warm line kept it past its first window");

    yield* TestClock.adjust(Duration.seconds(10));

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
  }),
);

it.effect("a warm launch handed no message yet ends as idled when Vespin retires it", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { cli, write, run } = yield* launch(SHORT_TURN, service);
    yield* write(WARM_CONFIG);
    yield* write({ type: INPUT_LINE.RETIRE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
    assert.equal(idles(service), 0);
    assert.deepEqual(cli.prompts, []);
  }),
);

it.effect(
  "a launch the config does not ask to stay warm ends at its turn's end and skips a retire",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { write, run } = yield* launch(SHORT_TURN, service);
      yield* write(CONFIG);
      yield* write({ type: INPUT_LINE.RETIRE });
      yield* write(FIRST_MESSAGE);

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.equal(idles(service), 0);
    }),
);

it.effect(
  "posts a heartbeat with no events every interval while the harness says nothing, and none once the launch ended",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], "Working on the first message.");
      const { prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, service);

      const heartbeats = () =>
        service.bodies.filter((body) => JSON.parse(body).events.length === 0).length;

      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;
      const beforeAny = heartbeats();

      // Each interval is let run out, and its heartbeat land, before the next begins.
      for (const beat of [1, 2]) {
        yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS));

        for (let step = 0; step < 500 && heartbeats() < beat; step += 1) yield* Effect.yieldNow;
      }

      const whileSilent = heartbeats();
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
      yield* Queue.take(prompted);
      yield* Queue.take(prompted);
      yield* release;
      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      yield* TestClock.adjust(Duration.millis(2 * RUNNER_HEARTBEAT.EVERY_MS));

      assert.equal(beforeAny, 0);
      assert.equal(whileSilent, 2);
      assert.equal(heartbeats(), 2, "a launch that ended posts no heartbeat");
      assert.ok(service.bearers.every((header) => header === `Bearer ${BEARER}`));
    }),
);

it.effect("lets a heartbeat Vespin never answers go, and posts the next one an interval on", () =>
  Effect.gen(function* () {
    const service = fakeService([], "Working on the first message.");
    let hung = 0;

    // The service holds the first heartbeat open, answering nothing until the runner lets it go.
    const stalling: typeof service = {
      ...service,
      layer: fakeHttpClientLayer((url, init) => {
        if (hung === 0 && JSON.parse(String(init.body)).events.length === 0) {
          hung += 1;

          return new Promise<Response>((_, reject) =>
            init.signal?.addEventListener("abort", () => reject(new Error("let go"))),
          );
        }

        return service.respond(url, init);
      }),
    };

    const { prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, stalling);

    const heartbeats = () =>
      service.bodies.filter((body) => JSON.parse(body).events.length === 0).length;

    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* service.seen;
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS));

    for (let step = 0; step < 500 && hung === 0; step += 1) yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.TIMEOUT_MS));
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS));

    for (let step = 0; step < 500 && heartbeats() === 0; step += 1) yield* Effect.yieldNow;
    const afterStall = heartbeats();
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
    yield* Queue.take(prompted);
    yield* Queue.take(prompted);
    yield* release;

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.equal(hung, 1);
    assert.equal(afterStall, 1, "the heartbeat after the one Vespin held went out");
  }),
);

const ASK_CONFIG: RunnerConfig = { ...CONFIG, permissionMode: PERMISSION_MODE.ASK };

/** The ask events the service took, in order. */
function asks(events: readonly RunnerEvent[]) {
  return events.flatMap(({ message }) =>
    "type" in message &&
    (message.type === RUNNER_EVENT.APPROVAL_REQUESTED ||
      message.type === RUNNER_EVENT.APPROVAL_RESOLVED)
      ? [message]
      : [],
  );
}

it.effect.each([
  {
    decision: APPROVAL_DECISION.ALLOW,
    answer: { behavior: "allow", updatedInput: BASH_ASK.input },
  },
  {
    decision: APPROVAL_DECISION.ALLOW_FOR_AGENT,
    answer: {
      behavior: "allow",
      updatedInput: BASH_ASK.input,
      updatedPermissions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "cat:*" }],
          behavior: "allow",
          destination: "session",
        },
      ],
    },
  },
  {
    decision: APPROVAL_DECISION.DENY,
    answer: { behavior: "deny", message: "The member denied this." },
  },
])(
  "holds a shell command in a mode that asks until the member answers $decision, posting the ask and its answer",
  ({ decision, answer }) =>
    Effect.gen(function* () {
      const service = fakeService([], BASH_ASK.requestId);
      const { cli, write, run } = yield* launch(ASKED_TURN, service);
      yield* write(ASK_CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;

      for (let step = 0; step < 50; step += 1) yield* Effect.yieldNow;
      assert.deepEqual(cli.permissions, [], "the call waits on the member");
      assert.equal(run.pollUnsafe(), undefined);

      yield* write({ type: INPUT_LINE.APPROVAL, requestId: BASH_ASK.requestId, decision });

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cli.permissions, [answer]);
      const [requested, resolved, ...more] = asks(service.applied);
      assert.deepEqual(more, []);
      assert.deepEqual(resolved, {
        type: RUNNER_EVENT.APPROVAL_RESOLVED,
        requestId: BASH_ASK.requestId,
        decision,
        by: APPROVAL_BY.MEMBER,
      });
      assert.ok(requested?.type === RUNNER_EVENT.APPROVAL_REQUESTED);
      const { input, ...ask } = requested;
      assert.deepEqual(ask, {
        type: RUNNER_EVENT.APPROVAL_REQUESTED,
        requestId: BASH_ASK.requestId,
        toolUseId: "toolu_Bash",
        toolName: "Bash",
        title: BASH_ASK.title,
        // The CLI's suggested rule names a prefix, which the member's Always allow keeps past the launch.
        commandPrefix: ["cat"],
      });
      // The ask carries the start of a long command, while the CLI is handed it whole.
      const command = String(input.command);
      assert.ok(command.length < ASKED_COMMAND.length / 2);
      assert.ok(ASKED_COMMAND.startsWith(command.slice(0, -1)));
      assert.equal(input.description, BASH_ASK.input.description);
    }),
);

it.effect("denies a call waiting on the member when Vespin's stop withdraws its ask", () =>
  Effect.gen(function* () {
    const service = fakeService([], BASH_ASK.requestId);
    const { cli, write, run } = yield* launch(ASKED_STOPPED_TURN, service);
    yield* write(ASK_CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 1);
    assert.deepEqual(cli.permissions, [{ behavior: "deny", message: "The member denied this." }]);
    assert.deepEqual(asks(service.applied)[1], {
      type: RUNNER_EVENT.APPROVAL_RESOLVED,
      requestId: BASH_ASK.requestId,
      decision: APPROVAL_DECISION.DENY,
      by: APPROVAL_BY.ABORTED,
    });
    assert.deepEqual(kinds(service.applied).slice(-4), [
      RUNNER_EVENT.APPROVAL_REQUESTED,
      RUNNER_EVENT.APPROVAL_RESOLVED,
      "result/error_during_execution",
      RUNNER_EVENT.END,
    ]);
  }),
);

it.effect(
  "denies a call waiting on the member with the words of a message they send meanwhile, then hands the CLI the message",
  () =>
    Effect.gen(function* () {
      const words = "Use the repository's own script instead.";
      const service = fakeService([], BASH_ASK.requestId);
      const { cli, write, run } = yield* launch(ASKED_THEN_MESSAGE, service);
      yield* write(ASK_CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: words }] });

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(cli.permissions, [{ behavior: "deny", message: words }]);
      assert.deepEqual(cli.prompts[1]?.message.content, [{ type: "text", text: words }]);
      assert.equal(cli.prompts[1]?.priority, "next");
      assert.deepEqual(asks(service.applied)[1], {
        type: RUNNER_EVENT.APPROVAL_RESOLVED,
        requestId: BASH_ASK.requestId,
        decision: APPROVAL_DECISION.DENY,
        by: APPROVAL_BY.MESSAGE,
      });

      // The ask is resolved before the message that denied it is taken.
      const taken = service.applied.flatMap(({ message }) =>
        "type" in message &&
        (message.type === RUNNER_EVENT.ACCEPTED || message.type === RUNNER_EVENT.APPROVAL_RESOLVED)
          ? [message.type]
          : [],
      );

      assert.deepEqual(taken, [
        RUNNER_EVENT.ACCEPTED,
        RUNNER_EVENT.APPROVAL_RESOLVED,
        RUNNER_EVENT.ACCEPTED,
      ]);
    }),
);

it.effect.each([
  { mode: PERMISSION_MODE.FULL_ACCESS, cliMode: "bypassPermissions", asking: false },
  { mode: PERMISSION_MODE.ASK, cliMode: "default", asking: true },
  { mode: PERMISSION_MODE.AUTO, cliMode: "auto", asking: true },
])(
  "starts the CLI in $cliMode for $mode, asking the member only where the mode does, and never of a read, an MCP tool, or an always-allowed command",
  ({ mode, cliMode, asking }) =>
    Effect.gen(function* () {
      const { cli, write, run } = yield* launch(SHORT_TURN, fakeService());

      // The starter's always-allowed commands, one no plain prefix, which would widen its rule.
      const allowedCommands = [
        ["pnpm", "test"],
        ["git", "log;rm"],
      ];

      yield* write({ ...CONFIG, permissionMode: mode, allowedCommands });
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      const options = cli.options;
      assert.ok(options);
      assert.equal(options.permissionMode, cliMode);
      // Under full access nothing could call it.
      assert.equal(options.canUseTool !== undefined, asking);

      for (const unasked of ["Read", "WebFetch", "mcp__workspace", "mcp__linear"]) {
        assert.equal(options.allowedTools?.includes(unasked), asking, unasked);
      }

      for (const asked of ["Bash", "Edit", "Write", "NotebookEdit"]) {
        assert.ok(!options.allowedTools?.includes(asked), asked);
      }

      assert.deepEqual(
        options.allowedTools?.filter((rule) => rule.startsWith("Bash(")),
        asking ? ["Bash(pnpm test *)"] : [],
      );
    }),
);

it.effect("interrupts a turn a wakeup started when Vespin stops it", () =>
  Effect.gen(function* () {
    const service = fakeService([], STOPPED_COMMAND);
    const { cli, write, run } = yield* launch(WAKEUP_STOPPED_TURN, service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 1);
    assert.deepEqual(kinds(service.applied).slice(-4), [
      RUNNER_EVENT.WAITING,
      "assistant",
      "result/error_during_execution",
      RUNNER_EVENT.END,
    ]);
  }),
);

it.effect("takes the launch's secrets out of every event it posts", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const leak: Step = {
      emit: {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: `${CLAUDE_TOKEN} ${BEARER}` },
            { type: "text", text: "a literal \\n stays" },
          ],
        },
        parent_tool_use_id: null,
      },
    };

    const { write, run } = yield* launch([leak, ...SHORT_TURN], service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(withoutAccepted(service.applied)[0]?.message, {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "[redacted] [redacted]" },
          { type: "text", text: "a literal \\n stays" },
        ],
      },
      parent_tool_use_id: null,
    });
    const posted = JSON.stringify(service.applied);

    for (const secret of [CLAUDE_TOKEN, BEARER]) {
      assert.ok(!posted.includes(JSON.stringify(secret).slice(1, -1)));
    }
  }),
);

it.effect(
  "a launch on an Anthropic API key hands the key to the CLI and takes it out of every event",
  () =>
    Effect.gen(function* () {
      const apiKey = "account-api-key-for-tests";
      const service = fakeService();

      const leak: Step = {
        emit: {
          type: "assistant",
          message: { content: [{ type: "text", text: `key ${apiKey}` }] },
          parent_tool_use_id: null,
        },
      };

      const { cli, write, run } = yield* launch([leak, ...SHORT_TURN], service, {
        [RUNNER_ENV.BEARER]: BEARER,
        [RUNNER_ENV.API_KEY]: apiKey,
        PATH: "/usr/bin",
      });

      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      assert.equal(cli.options?.env?.[RUNNER_ENV.API_KEY], apiKey);
      assert.ok(!JSON.stringify(service.applied).includes(apiKey));
    }),
);

it.effect("leaves an escape that only looks like a secret's spelling as it was", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const said: Step = {
      emit: {
        type: "assistant",
        message: { content: [{ type: "text", text: "a literal \\n stays" }] },
        parent_tool_use_id: null,
      },
    };

    const { write, run } = yield* launch([said, ...SHORT_TURN], service, {
      ...ENV,
      [RUNNER_ENV.CLAUDE_TOKEN]: "\n",
    });

    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(withoutAccepted(service.applied)[0]?.message, said.emit);
  }),
);

it.effect("ends a waiting launch at once on a stop, with no turn to interrupt", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { cli, write, run } = yield* launch(SHORT_TURN, service);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 0);
    assert.equal(cli.closed, true);
    assert.deepEqual(kinds(service.applied), [RUNNER_EVENT.END]);
  }),
);

it.effect("posts each event once and in order through posts Vespin failed or never answered", () =>
  Effect.gen(function* () {
    const service = fakeService([ANSWER.SERVER_ERROR, ANSWER.UNREACHABLE, ANSWER.TAKE_THEN_FAIL]);
    const { write, run } = yield* launch(SHORT_TURN, service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    const exit = yield* settled(run);
    assert.ok(Exit.isSuccess(exit));
    assert.equal(exit.value, RUNNER_END.TURN_ENDED);
    assert.ok(service.posts() > 3);
    assert.deepEqual(kinds(service.applied), [
      "system/init",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
    assert.deepEqual(
      service.applied.map(({ sequence }) => sequence),
      service.applied.map((_, index) => FIRST_SEQUENCE + index),
    );
    assert.equal(service.applied.length, 5);
  }),
);

/** A fake service that answers nothing, as a network that is down does, until `isUp` says it is back. */
function downUntil(service: ReturnType<typeof fakeService>, isUp: () => boolean): typeof service {
  return {
    ...service,
    layer: fakeHttpClientLayer((url, init) => {
      if (!isUp()) return Promise.reject(new Error("network is down"));

      return service.respond(url, init);
    }),
  };
}

it.effect(
  "posts every event in order once Vespin is back from an outage far longer than ten minutes",
  () =>
    Effect.gen(function* () {
      let up = false;
      const service = fakeService();

      const { write, run } = yield* launch(
        SHORT_TURN,
        downUntil(service, () => up),
      );

      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);

      for (let second = 0; second < 30 * 60; second += 1) yield* TestClock.adjust("1 second");
      assert.equal(run.pollUnsafe(), undefined, "the launch holds its run through the outage");
      assert.equal(service.applied.length, 0);
      up = true;

      const exit = yield* settled(run);
      assert.ok(Exit.isSuccess(exit));
      assert.equal(exit.value, RUNNER_END.TURN_ENDED);
      assert.deepEqual(kinds(service.applied), [
        "system/init",
        "assistant",
        "result/success",
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(
        service.applied.map(({ sequence }) => sequence),
        service.applied.map((_, index) => FIRST_SEQUENCE + index),
      );
    }),
);

it.effect("lets a post Vespin never answers go after its bound, and posts it again", () =>
  Effect.gen(function* () {
    const service = fakeService();
    let hung = 0;

    // The first post is held open, answering nothing until the runner lets it go.
    const stalling: typeof service = {
      ...service,
      layer: fakeHttpClientLayer((url, init) => {
        if (hung === 0) {
          hung += 1;

          return new Promise<Response>((_, reject) =>
            init.signal?.addEventListener("abort", () => reject(new Error("let go"))),
          );
        }

        return service.respond(url, init);
      }),
    };

    const { write, run } = yield* launch(SHORT_TURN, stalling);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    for (let step = 0; step < 500 && hung === 0; step += 1) yield* Effect.yieldNow;
    assert.equal(hung, 1);
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.TIMEOUT_MS - 1));
    assert.equal(service.applied.length, 0, "the held post is not let go early");
    const exit = yield* settled(run);
    assert.ok(Exit.isSuccess(exit));
    assert.equal(hung, 1);
    assert.deepEqual(kinds(service.applied), [
      "system/init",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
  }),
);

it.effect("ends a stopped launch within one post's bound while Vespin is still unreachable", () =>
  Effect.gen(function* () {
    const service = fakeService();

    const { cli, write, run } = yield* launch(
      SHORT_TURN,
      downUntil(service, () => false),
    );

    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.STOP });

    const started = yield* Clock.currentTimeMillis;
    const exit = yield* settled(run);
    const waited = (yield* Clock.currentTimeMillis) - started;
    assert.ok(Exit.isSuccess(exit));
    assert.equal(exit.value, RUNNER_END.STOPPED);
    assert.ok(waited <= RUNNER_HEARTBEAT.TIMEOUT_MS + 1_000, `waited ${waited} ms`);
    assert.equal(cli.closed, true);
  }),
);

it.effect(
  "posts each message's uuid as accepted ahead of handing it to the CLI, which takes it as the prompt's own, and ends with the files the turn changed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], "Working on the first message.");

      const { cli, prompted, release, write, run } = yield* launch(
        FOLLOW_UP_TURNS,
        service,
        ENV,
        [],
        true,
        fakeProbe(),
        true,
      );

      const first = "6f1c2a4e-3b7d-4c8e-9a0b-1d2e3f405162";
      yield* write(CONFIG);
      yield* write({ ...FIRST_MESSAGE, uuid: first });
      yield* service.seen;
      // A line that names no uuid is still accepted, under one the runner minted.
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
      yield* Queue.take(prompted);
      yield* Queue.take(prompted);
      yield* release;

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);

      const accepted = service.applied.filter(
        ({ message }) => "type" in message && message.type === RUNNER_EVENT.ACCEPTED,
      );

      // The first message opens a turn, so its ACCEPTED carries the checkout as it stood before it; the second landed in that turn, so its carries none.
      assert.deepEqual(
        accepted.map(({ message }) => message),
        cli.prompts.map((prompt, index) => ({
          type: RUNNER_EVENT.ACCEPTED,
          uuid: prompt.uuid,
          ...(index === 0 ? { snapshot: fakeSnapshotOf(CONFIG.cwd, first) } : undefined),
        })),
      );
      assert.equal(cli.prompts[0]?.uuid, first);
      assert.notEqual(cli.prompts[1]?.uuid, undefined);
      assert.deepEqual(service.applied[0]?.message, accepted[0]?.message);
      // The turn the launch's end ended says what it changed since the snapshot its first message opened on.
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.TURN_ENDED,
        files: fakeFilesOf(fakeSnapshotOf(CONFIG.cwd, first).commit),
      });
    }),
);

it.effect("skips a message line whose uuid is not a UUID, handing the CLI nothing", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { cli, writeText, write, run } = yield* launch(SHORT_TURN, service);
    yield* write(CONFIG);
    yield* writeText(JSON.stringify({ type: INPUT_LINE.MESSAGE, uuid: "not-a-uuid", content: [] }));
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.deepEqual(cli.prompts, []);
    assert.deepEqual(kinds(service.applied), [RUNNER_EVENT.END]);
    assert.equal(service.applied.length, 1);
  }),
);

it.effect("ends the launch, closing the CLI, when Vespin refuses its bearer", () =>
  Effect.gen(function* () {
    const service = fakeService([ANSWER.REFUSE]);
    const { cli, write, run } = yield* launch(STOPPED_TURN, service);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    const exit = yield* Fiber.await(run);
    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof EventsUndelivered);
    assert.equal(error.transient, false);
    assert.equal(service.posts(), 1);
    assert.equal(cli.closed, true);
  }),
);

it.effect(
  "starts the CLI with the plan's options, Vespin's MCP server in process with no secret, and the bearer kept from the CLI and its commands",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cli, write, run } = yield* launch(SHORT_TURN, service);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      const options = cli.options;
      assert.ok(options);
      assert.equal(options.cwd, CONFIG.cwd);
      assert.equal(options.pathToClaudeCodeExecutable, CONFIG.executable);
      assert.equal(options.model, CONFIG.model);
      assert.equal(options.effort, CONFIG.effort);
      assert.equal(options.resume, CONFIG.resume);
      assert.deepEqual(options.systemPrompt, {
        type: "preset",
        preset: "claude_code",
        append: CONFIG.append,
      });
      assert.deepEqual(options.settingSources, ["project"]);
      assert.equal(options.permissionMode, "bypassPermissions");
      assert.equal(options.includePartialMessages, true);

      // The tools the prompt names that CLI 2.1.304 leaves out of its default set, and the built-ins beside our own.
      for (const tool of ["Glob", "Grep", "TaskCreate", "TaskUpdate"]) {
        assert.ok(options.allowedTools?.includes(tool), tool);
      }

      // The CLI's own wakeup among them, since it holds the sandbox up for the whole wait.
      for (const tool of [
        "ListAgents",
        "CronCreate",
        "PushNotification",
        "AskUserQuestion",
        "ScheduleWakeup",
      ]) {
        assert.ok(options.disallowedTools?.includes(tool), tool);
      }

      const worker = options.agents?.worker;

      for (const tool of ["Edit", "Write", "mcp__workspace"]) {
        assert.ok(worker?.disallowedTools?.includes(tool), tool);
      }

      const mcp = options.mcpServers?.workspace;
      assert.equal(mcp?.type, "sdk");
      assert.ok(!JSON.stringify(options).includes(BEARER));
      assert.equal(options.env?.[RUNNER_ENV.BEARER], undefined);
      assert.equal(options.env?.[RUNNER_ENV.CLAUDE_TOKEN], CLAUDE_TOKEN);
      // A command's Playwright looks for its browsers in its own package: the image's where it installed them, a repository's where the agent may install them.
      assert.equal(options.env?.PLAYWRIGHT_BROWSERS_PATH, "0");
      // The first turn waits on no server the CLI may connect in the background.
      assert.equal(options.env?.CLAUDE_CODE_MCP_STARTUP_WAIT_MS, "0");

      // The main conversation alone keeps its prompt cache for an hour, and only where the config asks for it,
      // whatever the runner's own environment holds.
      const inheritedEnv = {
        ...ENV,
        CLAUDE_CODE_PROMPT_CACHE_TTL: "1h",
        ENABLE_PROMPT_CACHING_1H: "1",
        FORCE_PROMPT_CACHING_5M: "1",
      };

      const cacheEnvOf = (config: RunnerConfig) =>
        Effect.gen(function* () {
          const launched = yield* launch(SHORT_TURN, fakeService(), inheritedEnv);
          yield* launched.write(config);
          yield* launched.write(FIRST_MESSAGE);
          yield* Fiber.join(launched.run);
          const env = launched.cli.options?.env;

          return [
            env?.CLAUDE_CODE_PROMPT_CACHE_TTL,
            env?.ENABLE_PROMPT_CACHING_1H,
            env?.FORCE_PROMPT_CACHING_5M,
          ];
        });

      assert.deepEqual(yield* cacheEnvOf(CONFIG), [undefined, undefined, "1"]);
      assert.deepEqual(yield* cacheEnvOf({ ...CONFIG, promptCacheHour: true }), [
        "1h",
        undefined,
        undefined,
      ]);
    }),
);

it.effect("denies the worker only the tools of ours the config names, and keeps it the rest", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { cli, write, run } = yield* launch(SHORT_TURN, service);
    yield* write({ ...CONFIG, workerDenied: ["post_thread"] });
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    const denied = cli.options?.agents?.worker?.disallowedTools;
    assert.ok(denied?.includes("mcp__workspace__post_thread"));
    assert.ok(!denied?.includes("mcp__workspace"));
  }),
);

/** What a launch hands the CLI that is not a function or a live server, less the place it ran in, which nothing may follow. */
function launchedAs(options: Options | undefined) {
  assert.ok(options);
  const { hooks: _hooks, mcpServers, env, ...rest } = options;
  const { [RUNNER_ENV.PLACE]: _place, ...environment } = env ?? {};

  return { ...rest, servers: Object.keys(mcpServers ?? {}), environment };
}

it.effect(
  "starts the CLI on a host as in the cloud's sandbox, with the same permission mode and tools and no command sandbox in either, but on the machine's own login and without the image's tool settings",
  () =>
    Effect.gen(function* () {
      const optionsIn = (env: Record<string, string>) =>
        Effect.gen(function* () {
          const { cli, write, run } = yield* launch(SHORT_TURN, fakeService(), env);
          yield* write(CONFIG);
          yield* write(FIRST_MESSAGE);
          yield* Fiber.join(run);

          return cli.options;
        });

      const sandbox = yield* optionsIn(ENV);
      const host = yield* optionsIn({ ...ENV, [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST });

      const {
        [RUNNER_ENV.CLAUDE_TOKEN]: token,
        PLAYWRIGHT_BROWSERS_PATH: browsers,
        ...shared
      } = launchedAs(sandbox).environment;

      assert.deepEqual(launchedAs(host), { ...launchedAs(sandbox), environment: shared });
      assert.equal(token, CLAUDE_TOKEN);
      assert.equal(browsers, "0");
      assert.equal(sandbox?.sandbox?.enabled, false);
    }),
);

it.effect(
  "loads the member's installed skills as a local plugin where Vespin wrote them, and none where it wrote none",
  () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), "installed-skills-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(folder, { recursive: true })));
      const missing = join(folder, "never-written");
      const installed = join(folder, "installed");
      mkdirSync(join(installed, ".claude-plugin"), { recursive: true });
      writeFileSync(join(installed, INSTALLED_SKILLS.MANIFEST), '{"name":"workspace"}\n');

      const optionsWith = (installedSkills: string) =>
        Effect.gen(function* () {
          const { cli, write, run } = yield* launch(SHORT_TURN, fakeService());
          yield* write({ ...CONFIG, installedSkills });
          yield* write(FIRST_MESSAGE);
          yield* Fiber.join(run);

          return cli.options;
        });

      const withSkills = yield* optionsWith(installed);
      const withNone = yield* optionsWith(missing);

      assert.deepEqual(withSkills?.plugins, [
        { type: "local", path: installed, skipMcpDiscovery: true },
      ]);
      // The checkout's own settings stay the only ones read.
      assert.deepEqual(withSkills?.settingSources, ["project"]);
      assert.equal(withNone?.plugins, undefined);
    }),
);

/** The MCP route of a fake service: answers each request as its server does, notifications with 202, and keeps what each post carried. */
function fakeMcpRoute(answer: "take" | "refuse" = "take") {
  const calls: { authorization: string | null; body: unknown }[] = [];

  const respond = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ authorization: new Headers(init.headers).get("authorization"), body });

    if (answer === "refuse") return new Response(null, { status: 401 });

    if (!("id" in body)) return new Response(null, { status: 202 });

    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
  };

  return { calls, respond };
}

/** The CLI's end of the control channel an SDK MCP server is connected to: what the server sent it, in order. */
function fakeCliTransport() {
  const sent: WireValue[] = [];
  const answered = Deferred.makeUnsafe<void>();

  const transport = {
    // SAFETY: the SDK sets the handler once it connects; nothing is set before.
    onmessage: undefined as
      | ((message: { jsonrpc: "2.0"; method: string; id?: number }) => void)
      | undefined,
    start: async () => {},
    close: async () => {},
    send: async (message: WireValue) => {
      sent.push(message);
      Deferred.doneUnsafe(answered, Exit.void);
    },
  };

  return { transport, sent, answered };
}

/** A launch whose fake service answers the MCP server's route as `mcp` does, and that SDK server the CLI was handed, connected to a fake channel; our own unless an integration's is named. */
function launchWithMcp(
  mcp: ReturnType<typeof fakeMcpRoute>,
  named: { readonly name: string; readonly url: string } = {
    name: "workspace",
    url: CONFIG.mcpUrl,
  },
) {
  return Effect.gen(function* () {
    const service = fakeService();

    const routed: typeof service = {
      ...service,
      layer: fakeHttpClientLayer((url, init) =>
        url === named.url ? mcp.respond(url, init) : service.respond(url, init),
      ),
    };

    const launched = yield* launch(SHORT_TURN, routed);
    yield* launched.write(CONFIG);

    for (let step = 0; step < 500 && launched.cli.options === undefined; step += 1) {
      yield* Effect.yieldNow;
    }

    const server = launched.cli.options?.mcpServers?.[named.name];
    assert.ok(server?.type === "sdk" && "instance" in server);
    const cli = fakeCliTransport();
    // @ts-expect-error -- the fake stands in for the SDK's own control-channel transport.
    yield* Effect.promise(() => server.instance.connect(cli.transport));

    return { ...launched, channel: cli };
  });
}

it.effect("relays the CLI's MCP messages to Vespin under the runner's bearer, over no socket", () =>
  Effect.gen(function* () {
    const mcp = fakeMcpRoute();
    const { channel, write, run } = yield* launchWithMcp(mcp);

    channel.transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    channel.transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    yield* Deferred.await(channel.answered);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(channel.sent, [{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]);
    assert.deepEqual(
      mcp.calls.map(({ authorization }) => authorization),
      [`Bearer ${BEARER}`, `Bearer ${BEARER}`],
    );
    assert.deepEqual(
      mcp.calls.map(({ body }) => body),
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
      ],
    );
  }),
);

it.effect(
  "hands the CLI each integration as a server of its own, relayed to its endpoint under the runner's bearer",
  () =>
    Effect.gen(function* () {
      const mcp = fakeMcpRoute();
      const { channel, write, run, cli } = yield* launchWithMcp(mcp, LINEAR_SERVER);

      channel.transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      yield* Deferred.await(channel.answered);
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      assert.deepEqual(Object.keys(cli.options?.mcpServers ?? {}), ["workspace", "linear"]);
      assert.deepEqual(channel.sent, [{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]);
      assert.deepEqual(
        mcp.calls.map(({ authorization, body }) => ({ authorization, body })),
        [
          {
            authorization: `Bearer ${BEARER}`,
            body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
          },
        ],
      );
    }),
);

it.effect("answers the CLI's MCP request with a JSON-RPC error where Vespin refuses it", () =>
  Effect.gen(function* () {
    const { channel, write, run } = yield* launchWithMcp(fakeMcpRoute("refuse"));

    channel.transport.onmessage?.({ jsonrpc: "2.0", id: 7, method: "tools/call" });
    yield* Deferred.await(channel.answered);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(channel.sent, [
      { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "The service answered 401" } },
    ]);
  }),
);

it.effect(
  "starts the claude process with no bearer or MCP address in its argv, listens on no port, and ends failed where it exits before it initializes",
  () =>
    Effect.gen(function* () {
      const directory = mkdtempSync(join(tmpdir(), "agent-runner-argv-"));
      const argvFile = join(directory, "argv");
      const executable = join(directory, "claude");
      // A CLI that writes down the argv it was started with and exits.
      writeFileSync(executable, `#!/bin/sh\nprintf '%s\\0' "$@" > '${argvFile}'\n`);
      chmodSync(executable, 0o755);
      const listen = vi.spyOn(Server.prototype, "listen");
      const service = fakeService();
      const stdin = yield* Queue.unbounded<string, Cause.Done>();

      const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env: ENV }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            claudeCodeLive,
            service.layer,
            fakeAppServer([]).layer,
            fakeProbe().layer,
            fakeCheckoutSnapshots().layer,
          ),
        ),
        Effect.forkScoped,
      );

      yield* Queue.offer(stdin, JSON.stringify({ ...CONFIG, executable, cwd: directory }));
      const ended = yield* Fiber.join(run);
      const listened = listen.mock.calls.length;
      vi.restoreAllMocks();

      const argv = readFileSync(argvFile, "utf8").split("\0");
      rmSync(directory, { recursive: true });
      assert.ok(argv.includes("--input-format"), "the stub CLI was started");
      assert.ok(argv.every((argument) => !argument.includes(BEARER)));
      assert.ok(argv.every((argument) => !argument.includes(CONFIG.mcpUrl)));
      assert.ok(argv.every((argument) => !argument.includes(LINEAR_SERVER.url)));
      assert.ok(!argv.includes("--mcp-config"));
      assert.equal(listened, 0, "the launch opened no listening socket");
      assert.equal(ended, RUNNER_END.FAILED);
      const last = service.applied.at(-1)?.message;
      assert.ok(last !== undefined && "reason" in last);
      assert.equal(last.reason, RUNNER_END.FAILED);
    }),
);

it.effect(
  "starts the CLI with its file memory off, and its own fast mode opted in where the config asks for it and off otherwise",
  () =>
    Effect.gen(function* () {
      const fast = yield* launch(SHORT_TURN, fakeService());
      yield* fast.write({ ...CONFIG, fast: true });
      yield* fast.write(FIRST_MESSAGE);
      yield* Fiber.join(fast.run);
      assert.deepEqual(fast.cli.options?.settings, { autoMemoryEnabled: false, fastMode: true });

      const standard = yield* launch(SHORT_TURN, fakeService());
      yield* standard.write(CONFIG);
      yield* standard.write(FIRST_MESSAGE);
      yield* Fiber.join(standard.run);
      assert.deepEqual(standard.cli.options?.settings, { autoMemoryEnabled: false });
    }),
);

it.effect(
  "never starts the CLI without its bearer or a config line it can read, sequence numbers safe",
  () =>
    Effect.gen(function* () {
      const unsigned = yield* launch(SHORT_TURN, fakeService(), { PATH: "/usr/bin" });
      yield* unsigned.write(CONFIG);
      const withoutBearer = yield* Fiber.await(unsigned.run);

      const unreadable = yield* launch(SHORT_TURN, fakeService());
      yield* unreadable.writeText(JSON.stringify({ ...CONFIG, eventsUrl: undefined }));
      const withoutConfig = yield* Fiber.await(unreadable.run);

      const unsafe = yield* launch(SHORT_TURN, fakeService());
      yield* unsafe.write({ ...CONFIG, firstSequence: 2 ** 53 });
      const unsafeSequence = yield* Fiber.await(unsafe.run);

      for (const [exit, cli] of [
        [withoutBearer, unsigned.cli],
        [withoutConfig, unreadable.cli],
        [unsafeSequence, unsafe.cli],
      ] as const) {
        assert.ok(Exit.isFailure(exit));
        assert.ok(Cause.squash(exit.cause) instanceof RunnerFailed);
        assert.equal(cli.options, undefined);
      }
    }),
);

it.effect(
  "keeps a launch waiting on a wakeup up for as long as it waits, for the CLI to fire it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([], WAKEUP.prompt);
      const { cli, write, run } = yield* launch(WAKEUP_WAIT, service);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* service.seen;

      yield* TestClock.adjust(Duration.days(1));
      assert.equal(run.pollUnsafe(), undefined);
      assert.equal(cli.closed, false);
      yield* write({ type: INPUT_LINE.STOP });
      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    }),
);

/** The stored session a rewind cuts: two answered prompts, each followed by the answer's entries. */
const REWOUND_CHAIN = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
];

it.effect.each([
  {
    case: "cut just before the prompt the rewind dropped",
    rewindBefore: "10000000-0000-4000-8000-000000000003",
    resume: CONFIG.resume,
    at: "10000000-0000-4000-8000-000000000002",
  },
  {
    case: "started afresh where the dropped prompt was the session's first",
    rewindBefore: "10000000-0000-4000-8000-000000000001",
    resume: undefined,
    at: undefined,
  },
  {
    case: "resumed whole where the session never held the prompt",
    rewindBefore: "10000000-0000-4000-8000-000000000009",
    resume: CONFIG.resume,
    at: undefined,
  },
])("resumes a rewound session $case", ({ rewindBefore, resume, at }) =>
  Effect.gen(function* () {
    const service = fakeService();
    const { cli, write, run } = yield* launch(SHORT_TURN, service, ENV, REWOUND_CHAIN);
    yield* write({ ...CONFIG, rewindBefore });
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.equal(cli.options?.resume, resume);
    assert.equal(cli.options?.resumeSessionAt, at);
  }),
);

it.effect(
  "hands the CLI a message resent to a session that holds it under a uuid of its own, which the CLI answers",
  () =>
    Effect.gen(function* () {
      const line = "20000000-0000-4000-8000-000000000001";
      const service = fakeService();
      const { cli, write, run } = yield* launch(SHORT_TURN, service, ENV, [line]);
      yield* write(CONFIG);
      yield* write({ ...FIRST_MESSAGE, uuid: line, resent: true });

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);

      const accepted = service.applied.flatMap(({ message }) =>
        "type" in message && message.type === RUNNER_EVENT.ACCEPTED ? [message.uuid] : [],
      );

      assert.deepEqual([accepted, cli.prompts.length], [[line], 1]);
    }),
);

it.effect(
  "fails a launch whose session to cut the service's store does not answer, rather than resume it whole",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { cli, write, run } = yield* launch(SHORT_TURN, service, ENV, null);
      yield* write({
        ...CONFIG,
        rewindBefore: "10000000-0000-4000-8000-000000000003",
        transcriptsUrl: "https://app.test/runner/transcripts",
      });

      assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
      assert.equal(cli.options, undefined, "the CLI never started");
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.FAILED,
        detail: "the session to cut could not be read from the service",
      });
    }),
);
