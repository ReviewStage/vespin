/**
 * vercel-sandbox-session.test.ts -- what a sandbox session's calls through `@vercel/sandbox` answer against the runner's fake of Vercel: a session its sandbox no longer runs, or that stopped under it, reads as ended, a command's exit reads as a read that waits for it answers, and a dead command is said by its stderr's tail, redacted.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { COMMAND_GONE, vercelSandboxApi } from "@repo/sandbox";
import { fixtureToken } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { runnerSandboxApi } from "../testing/runner-sandbox-fake.js";

/** A create of the fixture's sandbox. */
const CREATE_ASK = {
  name: "luke-native-fixture",
  from: { image: "agent-image:fixture" },
  tags: {},
  timeoutMs: 60_000,
  vcpus: 2,
  keepLastSnapshots: { count: 1, expiration: 0, deleteEvicted: true },
  env: {},
} as const;

/** A sandbox opened in the runner's fake, and its session held, with a detached command started in it. */
const commandStarted = Effect.gen(function* () {
  const fake = runnerSandboxApi();
  const api = yield* vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(fake.layer));
  const opened = yield* api.create(CREATE_ASK);
  const ref = { name: opened.name, sessionId: opened.currentSessionId };
  const session = yield* api.session(ref);
  const commandId = yield* session.start({ command: "node", args: ["runner.js"], sudo: false });
  const command = fake.commands.find((each) => each.id === commandId);
  assert.ok(command !== undefined);
  return { fake, api, ref, session, command };
});

it.effect(
  "a session its sandbox no longer runs answers as one Vercel no longer holds: a stop counts as stopped, a command reads as gone, and anything else is not found",
  () =>
    Effect.gen(function* () {
      const { fake, api, ref, command } = yield* commandStarted;
      const sandbox = fake.sandboxes[0];
      assert.ok(sandbox !== undefined);
      sandbox.status = "stopped";
      yield* api.resume(ref.name);

      const ended = yield* api.session(ref);

      yield* ended.stop();
      assert.equal(yield* ended.commandExit(command.id), COMMAND_GONE);
      yield* ended.kill(command.id);
      const ran = yield* Effect.flip(ended.run({ command: "true", args: [] }));
      assert.equal(ran.status, 404);
      assert.equal(sandbox.status, "running");
    }),
);

it.effect(
  "a session that stopped while its sandbox still names it, which Vercel answers 410 sandbox_stopped, reads as ended: its command is gone and a kill of it is done",
  () =>
    Effect.gen(function* () {
      const { fake, api, ref, command } = yield* commandStarted;
      const sandbox = fake.sandboxes[0];
      assert.ok(sandbox !== undefined);
      sandbox.status = "stopped";

      const stopped = yield* api.session(ref);

      assert.equal(yield* stopped.commandExit(command.id), COMMAND_GONE);
      yield* stopped.kill(command.id);
      const ran = yield* Effect.flip(stopped.run({ command: "true", args: [] }));
      assert.equal(ran.status, 410);
    }),
);

it.effect(
  "a command's exit reads as Vercel answers a read that waits for it: none while it runs, its code once it exited, and gone once Vercel no longer knows it",
  () =>
    Effect.gen(function* () {
      const { session, command } = yield* commandStarted;

      const running = yield* session.commandExit(command.id);
      command.exitCode = 0;
      const exited = yield* session.commandExit(command.id);

      assert.equal(running, null);
      assert.equal(exited, 0);
      assert.equal(yield* session.commandExit("cmd_unknown"), COMMAND_GONE);
    }),
);

it.effect(
  "a command that died is said by the tail of its stderr, every secret it was handed and every token-shaped run redacted, and one that printed nothing by none",
  () =>
    Effect.gen(function* () {
      const { session, command } = yield* commandStarted;
      command.exitCode = 1;
      command.stderr = `agent-runner: RunnerFailed: was sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123\nbearer was a/b+c\n`;
      const silent = yield* commandStarted;
      silent.command.exitCode = 1;

      assert.equal(
        yield* session.commandStderrTail(command.id, ["a/b+c"]),
        "agent-runner: RunnerFailed: was [redacted] bearer was [redacted]",
      );
      assert.equal(yield* silent.session.commandStderrTail(silent.command.id), undefined);
    }),
);
