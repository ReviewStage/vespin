import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { AGENT_SANDBOX_STATE, agentSandboxTable } from "../../schemas/agent-sandbox.js";
import { user } from "../../schemas/auth.js";
import { turns } from "../../schemas/storage.js";
import { getTestDB, openTaskAgent, startTask } from "../../testing/index.js";
import {
  markAgentSandboxReleasing,
  recordAgentSandboxBooting,
  recordAgentSandboxDiscarded,
  recordAgentSandboxOpen,
  recordAgentSandboxUse,
  releasableAgentSandboxes,
  settleAgentSandboxRelease,
} from "../agent-sandboxes.js";

/**
 * When each cloud agent's sandbox was last used, over a real dialect: an
 * open records the sandbox LIVE, a touch moves its last use on only once
 * the row is older than the cutoff, a touch of a sandbox no open recorded
 * writes nothing, and an open of one recorded RELEASED writes it LIVE again
 * inside the cutoff, and a sweep leaves a sandbox booting alone. Synthetic
 * accounts, agents, and sandbox names throughout.
 */

const OPENED = new Date("2026-11-10T12:00:00Z");
const SECONDS_LATER = new Date("2026-11-10T12:00:30Z");
const MINUTES_LATER = new Date("2026-11-10T12:02:00Z");

/** A use at `at`, its cutoff a minute before it. */
const useAt = (sandboxName: string, at: Date) => ({
  sandboxName,
  at,
  writtenBefore: new Date(at.getTime() - 60_000),
});

const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });
  return yield* openTaskAgent(userId, task.workspaceId, task.id);
});

const rowOf = (sandboxName: string) =>
  Effect.flatMap(Database, (db) =>
    db
      .select({ usedAt: agentSandboxTable.usedAt, state: agentSandboxTable.state })
      .from(agentSandboxTable)
      .where(eq(agentSandboxTable.sandboxName, sandboxName)),
  );

/** A settled turn of the agent's conversation holding the checkout its runner recorded; answers the turn's id. */
const turnWithSnapshot = (agentId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [agent] = yield* db
      .select({ userId: agentTable.userId, conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));
    assert.ok(agent !== undefined);
    const id = randomUUID();
    yield* db.insert(turns).values({
      id,
      userId: agent.userId,
      conversationId: agent.conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      snapshotCommit: "0123456789abcdef0123456789abcdef01234567",
      snapshotHead: "89abcdef0123456789abcdef0123456789abcdef",
      snapshotBranch: "main",
    });
    return id;
  });

/** Whether the turn still holds its snapshot. */
const holdsSnapshot = (turnId: string) =>
  Effect.map(
    Effect.flatMap(Database, (db) =>
      db.select({ commit: turns.snapshotCommit }).from(turns).where(eq(turns.id, turnId)),
    ),
    ([row]) => row?.commit !== null,
  );

it.layer(getTestDB())("when each cloud agent's sandbox was last used", (it) => {
  it.effect(
    "the snapshots an agent's turns hold go with its sandbox: forgotten as it is discarded, released, or opened anew, and kept across an open that resumed it",
    () =>
      Effect.gen(function* () {
        const agentId = yield* openAgent;
        const name = `agent-sandbox-${randomUUID()}`;
        yield* recordAgentSandboxOpen(agentId, useAt(name, OPENED));

        const resumed = yield* turnWithSnapshot(agentId);
        yield* recordAgentSandboxOpen(agentId, useAt(name, MINUTES_LATER));
        assert.equal(yield* holdsSnapshot(resumed), true, "a resume keeps the disk");

        yield* recordAgentSandboxDiscarded(name);
        assert.equal(yield* holdsSnapshot(resumed), false, "a discard loses it");
        assert.deepEqual(
          (yield* rowOf(name)).map((row) => row.state),
          [AGENT_SANDBOX_STATE.RELEASED],
        );

        const created = yield* turnWithSnapshot(agentId);
        yield* recordAgentSandboxOpen(agentId, useAt(name, MINUTES_LATER), true);
        assert.equal(yield* holdsSnapshot(created), false, "a sandbox made anew holds none");

        const released = yield* turnWithSnapshot(agentId);
        yield* Effect.flatMap(Database, (db) =>
          db
            .update(agentSandboxTable)
            .set({ state: AGENT_SANDBOX_STATE.RELEASING })
            .where(eq(agentSandboxTable.sandboxName, name)),
        );
        yield* settleAgentSandboxRelease(name, AGENT_SANDBOX_STATE.RELEASED);
        assert.equal(yield* holdsSnapshot(released), false, "a release deletes the disk");
      }),
  );

  it.effect("a touch moves the last use on only once the row is older than the cutoff", () =>
    Effect.gen(function* () {
      const agentId = yield* openAgent;
      const name = `agent-sandbox-${randomUUID()}`;
      yield* recordAgentSandboxOpen(agentId, useAt(name, OPENED));

      yield* recordAgentSandboxUse(useAt(name, SECONDS_LATER));
      assert.deepEqual(yield* rowOf(name), [{ usedAt: OPENED, state: AGENT_SANDBOX_STATE.LIVE }]);

      yield* recordAgentSandboxUse(useAt(name, MINUTES_LATER));
      assert.deepEqual(yield* rowOf(name), [
        { usedAt: MINUTES_LATER, state: AGENT_SANDBOX_STATE.LIVE },
      ]);
    }),
  );

  it.effect("a touch of a sandbox no open recorded writes nothing", () =>
    Effect.gen(function* () {
      const name = `agent-sandbox-${randomUUID()}`;
      yield* recordAgentSandboxUse(useAt(name, OPENED));
      assert.deepEqual(yield* rowOf(name), []);
    }),
  );

  it.effect("an open of a released sandbox writes it live again inside the cutoff", () =>
    Effect.gen(function* () {
      const agentId = yield* openAgent;
      const name = `agent-sandbox-${randomUUID()}`;
      yield* recordAgentSandboxOpen(agentId, useAt(name, OPENED));
      yield* Effect.flatMap(Database, (db) =>
        db
          .update(agentSandboxTable)
          .set({ state: AGENT_SANDBOX_STATE.RELEASED })
          .where(eq(agentSandboxTable.sandboxName, name)),
      );

      yield* recordAgentSandboxOpen(agentId, useAt(name, SECONDS_LATER));
      assert.deepEqual(yield* rowOf(name), [
        { usedAt: SECONDS_LATER, state: AGENT_SANDBOX_STATE.LIVE },
      ]);
    }),
  );

  it.effect("a sweep while the sandbox boots leaves it booting", () =>
    Effect.gen(function* () {
      const agentId = yield* openAgent;
      const name = `agent-sandbox-${randomUUID()}`;
      yield* recordAgentSandboxOpen(agentId, useAt(name, OPENED));
      yield* recordAgentSandboxBooting(agentId, name, MINUTES_LATER);

      // Note that the boot kept the last use it began from, which the sweep's cutoff passed.
      const releasable = yield* releasableAgentSandboxes(SECONDS_LATER, 10);
      assert.deepEqual(
        releasable.filter((row) => row.sandboxName === name),
        [],
      );
      assert.equal(yield* markAgentSandboxReleasing(name, SECONDS_LATER), false);
      assert.deepEqual(
        yield* Effect.flatMap(Database, (db) =>
          db
            .select({
              state: agentSandboxTable.state,
              bootingSince: agentSandboxTable.bootingSince,
            })
            .from(agentSandboxTable)
            .where(eq(agentSandboxTable.sandboxName, name)),
        ),
        [{ state: AGENT_SANDBOX_STATE.LIVE, bootingSince: MINUTES_LATER }],
      );
    }),
  );
});
