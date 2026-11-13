import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { AGENT_SANDBOX_STATE, agentSandboxTable } from "@repo/database/schemas/agent-sandbox";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "@repo/database/testing";
import { SANDBOX_CALL, SANDBOX_STATUS, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { SANDBOX_RELEASE } from "./sandbox-release-bounds.js";
import { recordedSandboxOpen, touchAgentSandbox } from "./sandbox-use.js";
import {
  consumeSandboxRelease,
  releaseUnusedSandboxes,
  SANDBOX_RELEASE_OUTCOME,
  SandboxReleases,
  SessionSandboxes,
  sessionSandboxesLayer,
} from "./session-sandboxes.js";

/**
 * A session's sandboxes deleted through `Sandbox` as an archive deletes
 * them: every sandbox carrying the session's tag goes, with the drive it
 * owns where it owns one, one from before drives as well, and a delete the
 * sandbox refused fails as it answered. An
 * agent's sandbox unused for `SANDBOX_RELEASE.UNUSED_FOR` is released by the
 * sweep, deleted and recorded released, one touched after the sweep found
 * it due is left standing.
 * Synthetic accounts, agents, and sandbox names throughout.
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

/** An agent's sandbox standing in the memory and opened in the ledger now, with the memory it stands in and the account, workspace, and agent it was opened for. */
const openedSandbox = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const workspaceId = yield* openWorkspace(userId);
  const agentId = yield* openAgentOnOwnTask(userId, workspaceId);
  const name = `agent-sandbox-${randomUUID()}`;
  const sandbox = memorySandbox();
  sandbox.stand({ name, tags: { sessionId: SESSION }, status: SANDBOX_STATUS.STOPPED });
  yield* recordedSandboxOpen(agentId, name);

  return { name, sandbox, userId, workspaceId, agentId };
});

const stateOf = (name: string) =>
  Effect.map(
    Effect.flatMap(Database, (db) =>
      db
        .select({ state: agentSandboxTable.state })
        .from(agentSandboxTable)
        .where(eq(agentSandboxTable.sandboxName, name)),
    ),
    (rows) => rows.map((row) => row.state),
  );

/** The sweep run at the clock's now, answering the releases it published. */
const swept = () =>
  Effect.gen(function* () {
    const published: string[] = [];
    const now = yield* Clock.currentTimeMillis;
    yield* releaseUnusedSandboxes(now).pipe(
      Effect.provideService(SandboxReleases, {
        publish: (name) => Effect.sync(() => void published.push(name)),
      }),
    );

    return published;
  });

/** One release consumed. */
const consumed = (name: string) =>
  consumeSandboxRelease(name).pipe(
    Effect.provideService(SandboxReleases, { publish: () => Effect.void }),
  );

it.layer(getTestDB())("an unused sandbox's release", (it) => {
  it.effect("a sandbox unused for its keep is deleted by its release and recorded released", () =>
    Effect.gen(function* () {
      const { name, sandbox } = yield* openedSandbox;
      yield* TestClock.adjust(SANDBOX_RELEASE.UNUSED_FOR);

      const published = yield* swept().pipe(Effect.provide(sandbox.layer));
      const outcome = yield* consumed(name).pipe(Effect.provide(sandbox.layer));

      assert.ok(published.includes(name));
      assert.equal(outcome, SANDBOX_RELEASE_OUTCOME.RELEASED);
      assert.deepEqual(sandbox.state.deleted, [name]);
      assert.deepEqual(yield* stateOf(name), [AGENT_SANDBOX_STATE.RELEASED]);
    }),
  );

  it.effect("a sandbox touched after the sweep found it due is left standing and live", () =>
    Effect.gen(function* () {
      const { name, sandbox } = yield* openedSandbox;
      yield* TestClock.adjust(SANDBOX_RELEASE.UNUSED_FOR);

      const published = yield* swept().pipe(Effect.provide(sandbox.layer));
      yield* touchAgentSandbox(name).pipe(Effect.provide(sandbox.layer));
      const outcome = yield* consumed(name).pipe(Effect.provide(sandbox.layer));

      assert.ok(published.includes(name));
      assert.equal(outcome, SANDBOX_RELEASE_OUTCOME.USED_SINCE);
      assert.deepEqual(sandbox.state.deleted, []);
      assert.deepEqual(yield* stateOf(name), [AGENT_SANDBOX_STATE.LIVE]);
    }),
  );
});
