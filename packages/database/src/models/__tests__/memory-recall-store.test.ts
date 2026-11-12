import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "../../testing/index.js";
import { logMemoryRecalls, tallyMemoryRecalls } from "../memory-recall-store.js";
import { type MemoryOutcome, rememberMemory } from "../memory-store.js";

/**
 * Each time a coding agent was handed a workspace's memories, over a real
 * dialect: a memory's recalls are counted over the last thirty days and its
 * latest is kept past them, and no workspace logs a recall of another's
 * memory or reads another's recalls.
 *
 * Synthetic accounts, workspaces, and words throughout.
 */

const DAY = Duration.days(1);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** The id of the memory a keep wrote. */
function keptId(outcome: MemoryOutcome): string {
  assert.ok("memory" in outcome, `nothing was written: ${outcome.kind}`);

  return outcome.memory.id;
}

/** A workspace of its own for a new account, an agent of theirs in it, and two memories kept there. */
const openRecalling = Effect.gen(function* () {
  const owner = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  const agentId = yield* openAgentOnOwnTask(owner, workspaceId);

  const deploys = keptId(
    yield* rememberMemory(workspaceId, owner, "Deployments go out from main.", undefined),
  );

  const tests = keptId(
    yield* rememberMemory(workspaceId, owner, "Store tests run on PGlite.", undefined),
  );

  return { owner, workspaceId, source: { agentId, messageId: randomUUID() }, deploys, tests };
});

it.layer(getTestDB())("a workspace's memory recalls", (it) => {
  it.effect(
    "a memory's recalls are counted over the last thirty days, and its latest is kept past them",
    () =>
      Effect.gen(function* () {
        const { workspaceId, source, deploys, tests } = yield* openRecalling;
        const never = randomUUID();
        const first = yield* Clock.currentTimeMillis;

        yield* logMemoryRecalls(workspaceId, [deploys, tests], source);
        yield* TestClock.adjust(Duration.times(DAY, 31));
        yield* logMemoryRecalls(workspaceId, [deploys], source);
        yield* TestClock.adjust(DAY);
        const tallies = yield* tallyMemoryRecalls(workspaceId, [deploys, tests, never]);

        // The second recall lands 31 days after the first, and the read a day after that.
        const second = first + Duration.toMillis(Duration.times(DAY, 31));
        assert.deepEqual(
          [...tallies],
          [
            [deploys, { recalls30d: 1, lastRecalledAt: second }],
            [tests, { recalls30d: 0, lastRecalledAt: first }],
            [never, { recalls30d: 0, lastRecalledAt: null }],
          ],
        );
      }),
  );

  it.effect("no workspace logs a recall of another's memory, nor reads another's recalls", () =>
    Effect.gen(function* () {
      const { owner, workspaceId, source, deploys } = yield* openRecalling;
      // The same account's second workspace still reaches none of the first's memories.
      const elsewhere = yield* openWorkspace(owner);

      yield* logMemoryRecalls(elsewhere, [deploys], source);
      const beforeOwn = yield* tallyMemoryRecalls(workspaceId, [deploys]);
      yield* logMemoryRecalls(workspaceId, [deploys], source);
      const recalledAt = yield* Clock.currentTimeMillis;
      const fromElsewhere = yield* tallyMemoryRecalls(elsewhere, [deploys]);

      assert.deepEqual(beforeOwn.get(deploys), { recalls30d: 0, lastRecalledAt: null });
      assert.deepEqual(fromElsewhere.get(deploys), { recalls30d: 0, lastRecalledAt: null });
      assert.deepEqual((yield* tallyMemoryRecalls(workspaceId, [deploys])).get(deploys), {
        recalls30d: 1,
        lastRecalledAt: recalledAt,
      });
    }),
  );
});
