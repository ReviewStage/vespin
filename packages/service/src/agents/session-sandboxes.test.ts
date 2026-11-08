import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { SANDBOX_CALL, SANDBOX_STATUS, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { CODER } from "./coder-host/bounds.js";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";

/**
 * A session's sandboxes stopped through `Sandbox`: the sandboxes carrying
 * the session's tag are listed, the one up has its run stopped, one already
 * stopped is left, and a stop the sandbox refused fails as it answered. A
 * running sandbox is kept alive by the timeout from now on the test clock,
 * from the end its listing names, never resumed.
 */

const SESSION = "wrun_fixture";

const MINUTE = 60_000;

/** The session's sandboxes as the memory has them, a call refused where the test names one. */
function standing(refused?: (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL]) {
  const sandbox = memorySandbox({
    fail: (call) => (call === refused ? new SandboxUnavailable({ call }) : undefined),
  });
  const up = sandbox.stand({
    name: "agent-sandbox-up",
    tags: { sessionId: SESSION },
    expiresAt: CODER.SANDBOX_TIMEOUT_MS,
  });
  const down = sandbox.stand({
    name: "agent-sandbox-down",
    tags: { sessionId: SESSION },
    status: SANDBOX_STATUS.STOPPED,
  });
  const run = <A, E>(call: (sandboxes: SessionSandboxes["Service"]) => Effect.Effect<A, E>) =>
    Effect.flatMap(SessionSandboxes, call).pipe(
      Effect.provide(sessionSandboxesLayer),
      Effect.provide(sandbox.layer),
      Effect.provide(getTestDB()),
    );
  return { sandbox, up, down, run };
}

it.effect(
  "the session's sandbox that is up has its run stopped, and one already stopped is left",
  () =>
    Effect.gen(function* () {
      const { sandbox, up, run } = standing();

      const stopped = yield* run((sandboxes) => sandboxes.stopFor(SESSION));

      assert.equal(stopped, 1);
      assert.deepEqual(sandbox.state.stopped, [{ name: up.name, running: up.running }]);
    }),
);

it.effect("a stop the sandbox refused fails as it answered", () =>
  Effect.gen(function* () {
    const { run } = standing(SANDBOX_CALL.STOP);

    const failure = yield* run((sandboxes) => sandboxes.stopFor(SESSION)).pipe(Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.call, SANDBOX_CALL.STOP);
  }),
);

it.effect(
  "a running sandbox is extended to end the timeout from now, read from the list alone, and nothing is resumed",
  () =>
    Effect.gen(function* () {
      const { sandbox, up, run } = standing();
      yield* TestClock.adjust(Duration.minutes(25));

      const extended = yield* run((sandboxes) => sandboxes.keepAliveFor(SESSION));

      assert.equal(extended, 1);
      assert.equal(up.expiresAt, CODER.SANDBOX_TIMEOUT_MS + 25 * MINUTE);
      assert.deepEqual(sandbox.state.resumed, []);
    }),
);

it.effect(
  "a sandbox already ending within a keep-alive interval of the timeout from now is left as it is",
  () =>
    Effect.gen(function* () {
      const { up, run } = standing();
      yield* TestClock.adjust(
        Duration.subtract(CODER.SANDBOX_KEEP_ALIVE_EVERY, Duration.millis(1)),
      );

      const extended = yield* run((sandboxes) => sandboxes.keepAliveFor(SESSION));

      assert.equal(extended, 0);
      assert.equal(up.expiresAt, CODER.SANDBOX_TIMEOUT_MS);
    }),
);

it.effect("an extension the sandbox refused fails as it answered", () =>
  Effect.gen(function* () {
    const { up, run } = standing(SANDBOX_CALL.EXTEND);
    yield* TestClock.adjust(Duration.minutes(30));

    const failure = yield* run((sandboxes) => sandboxes.keepAliveFor(SESSION)).pipe(Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.call, SANDBOX_CALL.EXTEND);
    assert.equal(up.expiresAt, CODER.SANDBOX_TIMEOUT_MS);
  }),
);
