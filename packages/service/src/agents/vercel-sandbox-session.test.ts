/**
 * vercel-sandbox-session.test.ts -- what `Sandbox`'s calls on one run answer through the Vercel adapter against the runner's fake of Vercel: a run its sandbox is no longer up in, or that stopped under it, reads as ended, a command's exit reads as a read that waits for it answers, and a dead command is said by its stderr's tail, redacted.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { COMMAND_GONE, SANDBOX_STATUS, Sandbox } from "@repo/sandbox";
import { Effect } from "effect";
import { runnerSandboxApi } from "../testing/runner-sandbox-fake.js";

/** A create of the fixture's sandbox. */
const CREATE_ASK = {
  name: "luke-native-fixture",
  from: { image: "agent-image:fixture" },
  tags: {},
  vcpus: 2,
  env: {},
} as const;

/** A sandbox opened in the runner's fake, and its run named, with a detached command started in it. */
const commandStarted = Effect.gen(function* () {
  const fake = runnerSandboxApi();
  const api = yield* Effect.provide(Effect.service(Sandbox), fake.layer);
  const opened = yield* api.create(CREATE_ASK);
  const ref = { name: opened.name, running: opened.running };
  const commandId = yield* api.start(ref, { command: "node", args: ["runner.js"], sudo: false });
  const command = fake.commands.find((each) => each.id === commandId);
  assert.ok(command !== undefined);

  return { fake, api, ref, command };
});

it.effect(
  "a run its sandbox is no longer up in answers as gone: a stop counts as stopped, a command reads as gone, and anything else is gone",
  () =>
    Effect.gen(function* () {
      const { fake, api, ref, command } = yield* commandStarted;
      const sandbox = fake.sandboxes[0];
      assert.ok(sandbox !== undefined);
      sandbox.status = "stopped";
      yield* api.resume(ref.name);

      yield* api.stop(ref);
      assert.equal(yield* api.commandExit(ref, command.id), COMMAND_GONE);
      yield* api.kill(ref, command.id);
      const ran = yield* Effect.flip(api.run(ref, { command: "true", args: [] }));
      assert.equal(ran._tag, "SandboxGone");
      assert.equal((yield* api.get(ref.name))?.status, SANDBOX_STATUS.RUNNING);
    }),
);

it.effect(
  "a run that stopped while its sandbox still names it, which Vercel answers 410 sandbox_stopped, reads as ended: its command is gone and a kill of it is done",
  () =>
    Effect.gen(function* () {
      const { fake, api, ref, command } = yield* commandStarted;
      const sandbox = fake.sandboxes[0];
      assert.ok(sandbox !== undefined);
      sandbox.status = "stopped";

      assert.equal(yield* api.commandExit(ref, command.id), COMMAND_GONE);
      yield* api.kill(ref, command.id);
      const ran = yield* Effect.flip(api.run(ref, { command: "true", args: [] }));
      assert.equal(ran._tag, "SandboxUnavailable");
    }),
);

it.effect(
  "a command's exit reads as Vercel answers a read that waits for it: none while it runs, its code once it exited, and gone once Vercel no longer knows it",
  () =>
    Effect.gen(function* () {
      const { api, ref, command } = yield* commandStarted;

      const running = yield* api.commandExit(ref, command.id);
      command.exitCode = 0;
      const exited = yield* api.commandExit(ref, command.id);

      assert.equal(running, null);
      assert.equal(exited, 0);
      assert.equal(yield* api.commandExit(ref, "cmd_unknown"), COMMAND_GONE);
    }),
);

it.effect(
  "a command that died is said by the tail of its stderr, every secret it was handed and every token-shaped run redacted, and one that printed nothing by none",
  () =>
    Effect.gen(function* () {
      const { api, ref, command } = yield* commandStarted;
      command.exitCode = 1;
      command.stderr = `agent-runner: RunnerFailed: was sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123\nbearer was a/b+c\n`;
      const silent = yield* commandStarted;
      silent.command.exitCode = 1;

      assert.equal(
        yield* api.commandStderrTail(ref, command.id, ["a/b+c"]),
        "agent-runner: RunnerFailed: was [redacted] bearer was [redacted]",
      );
      assert.equal(yield* silent.api.commandStderrTail(silent.ref, silent.command.id), undefined);
    }),
);
