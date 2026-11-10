import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_USER } from "@repo/agent-runner/pins";
import { getTestDB } from "@repo/database/testing";
import { SANDBOX_CALL, SANDBOX_STATUS, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { ARCHIVE_SCRIPT } from "./archive-script.js";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";

/**
 * A session's sandboxes deleted through `Sandbox` as an archive deletes
 * them: every sandbox carrying the session's tag goes, with the drive it
 * owns where it owns one, one from before drives as well, and a delete the
 * sandbox refused fails as it answered. An archive script runs in the
 * session's sandbox before that, as the agent's user, and is ended past its
 * bound.
 */

const SESSION = "wrun_fixture";

/** The session's sandboxes as the memory has them, one up on a drive of its own forked from a base and one stopped with none, a call refused where the test names one. */
function standing(refused?: (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL]) {
  const sandbox = memorySandbox({
    fail: (call) => (call === refused ? new SandboxUnavailable({ call }) : undefined),
  });
  sandbox.state.drives.set("base", { name: "base", forkedFrom: undefined });
  const run = <A, E>(call: (sandboxes: SessionSandboxes["Service"]) => Effect.Effect<A, E>) =>
    Effect.flatMap(SessionSandboxes, call).pipe(
      Effect.provide(sessionSandboxesLayer),
      Effect.provide(sandbox.layer),
      Effect.provide(getTestDB()),
    );
  return Effect.gen(function* () {
    yield* sandbox.service.create({
      name: "agent-sandbox-drive",
      from: { image: "agent-image" },
      drive: { fork: { base: "base" }, at: "/workspace" },
      tags: { sessionId: SESSION },
      env: {},
    });
    sandbox.stand({
      name: "agent-sandbox-before-drives",
      tags: { sessionId: SESSION },
      status: SANDBOX_STATUS.STOPPED,
    });
    return { sandbox, run };
  });
}

it.effect(
  "every sandbox of the session is deleted with the drive it owns, and the base drive is left",
  () =>
    Effect.gen(function* () {
      const { sandbox, run } = yield* standing();

      const deleted = yield* run((sandboxes) => sandboxes.deleteFor(SESSION));

      assert.equal(deleted, 2);
      assert.equal(sandbox.state.sandboxes.size, 0);
      assert.deepEqual([...sandbox.state.drives.keys()], ["base"]);
    }),
);

it.effect("a delete the sandbox refused fails as it answered", () =>
  Effect.gen(function* () {
    const { run } = yield* standing(SANDBOX_CALL.DELETE);

    const failure = yield* run((sandboxes) => sandboxes.deleteFor(SESSION)).pipe(Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.call, SANDBOX_CALL.DELETE);
  }),
);

/** The session's one sandbox, stopped as an idle one is, its archive script's commands ending as the suite says. */
function archiving(exitCode: number | null) {
  const sandbox = memorySandbox({
    start: (command) => {
      command.exit = exitCode;
    },
  });
  sandbox.stand({
    name: "agent-sandbox",
    tags: { sessionId: SESSION },
    status: SANDBOX_STATUS.STOPPED,
  });
  const archived = Effect.flatMap(SessionSandboxes, (sandboxes) =>
    sandboxes.archiveFor(SESSION, {
      script: "docker compose down",
      environment: { DATABASE_URL: "postgres://fixture" },
    }),
  ).pipe(Effect.provide(sessionSandboxesLayer), Effect.provide(sandbox.layer));
  return { sandbox, archived };
}

it.effect(
  "an archive script runs in the session's stopped sandbox, resumed, as the agent's user with the workspace's variables",
  () =>
    Effect.gen(function* () {
      const { sandbox, archived } = archiving(0);

      yield* archived;

      assert.deepEqual(
        sandbox.state.resumed.map((each) => each.name),
        ["agent-sandbox"],
      );
      const [written] = sandbox.state.files;
      assert.equal(new TextDecoder().decode(written?.file.contents), "docker compose down");
      const [command] = sandbox.state.commands;
      assert.ok(command !== undefined && "user" in command.ask);
      assert.equal(command.ask.user, AGENT_USER);
      assert.equal(command.ask.env?.DATABASE_URL, "postgres://fixture");
      assert.equal(sandbox.state.sandboxes.size, 1);
    }),
);

it.effect("an archive script that runs past its bound is ended", () =>
  Effect.gen(function* () {
    const { sandbox, archived } = archiving(null);

    const running = yield* Effect.forkChild(archived);
    yield* TestClock.adjust(Duration.sum(ARCHIVE_SCRIPT.RUN_TIMEOUT, Duration.seconds(1)));
    yield* Fiber.join(running);

    assert.deepEqual(
      sandbox.state.commands.map((each) => each.exit),
      [143],
    );
  }),
);
