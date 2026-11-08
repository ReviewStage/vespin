import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { SANDBOX_CALL, SANDBOX_STATUS, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";

/**
 * A session's sandboxes stopped through `Sandbox`: the sandboxes carrying
 * the session's tag are listed, the one up has its run stopped, one already
 * stopped is left, and a stop the sandbox refused fails as it answered.
 */

const SESSION = "wrun_fixture";

/** The session's sandboxes as the memory has them, a call refused where the test names one. */
function standing(refused?: (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL]) {
  const sandbox = memorySandbox({
    fail: (call) => (call === refused ? new SandboxUnavailable({ call }) : undefined),
  });
  const up = sandbox.stand({
    name: "agent-sandbox-up",
    tags: { sessionId: SESSION },
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
