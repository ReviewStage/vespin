import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { AGENT_SANDBOX_STATE, agentSandboxTable } from "../../schemas/agent-sandbox.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openTaskAgent, startTask } from "../../testing/index.js";
import { recordAgentSandboxOpen, recordAgentSandboxUse } from "../agent-sandboxes.js";

/**
 * When each cloud agent's sandbox was last used, over a real dialect: an
 * open records the sandbox LIVE, a touch moves its last use on only once
 * the row is older than the cutoff, a touch of a sandbox no open recorded
 * writes nothing, and an open of one recorded RELEASED writes it LIVE again
 * inside the cutoff. Synthetic accounts, agents, and sandbox names
 * throughout.
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

it.layer(getTestDB())("when each cloud agent's sandbox was last used", (it) => {
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
});
