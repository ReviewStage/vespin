import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { SANDBOX_CALL, SANDBOX_STATUS, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";

/**
 * A session's sandboxes deleted through `Sandbox` as an archive deletes
 * them: every sandbox carrying the session's tag goes, with the drive it
 * owns where it owns one, one from before drives as well, and a delete the
 * sandbox refused fails as it answered.
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
