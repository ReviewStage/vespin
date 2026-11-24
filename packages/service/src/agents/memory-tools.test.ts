import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { tallyMemoryRecalls } from "@repo/database/models/memory-recall-store";
import { listMemories, MEMORY_OUTCOME } from "@repo/database/models/memory-store";
import { user } from "@repo/database/schemas/auth";
import { memory } from "@repo/database/schemas/memory";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "@repo/database/testing";
import { noDatabase } from "@repo/database/testing/no-database";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { MEMORY_BOUNDS } from "@repo/features/memory-wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "../core.js";
import { type MemoryCall, runRecall, runRemember } from "./memory-tools.js";

/**
 * The coding agent's `remember` and `recall` through their public
 * functions, over a real dialect: a memory kept is recalled by the words it
 * holds, best match first, a correction leaves only the corrected words to
 * recall, words that look like a credential are never kept, an input that
 * does not read keeps and recalls nothing, a coding agent's search logs
 * each memory it answers as recalled where a member's logs none, a recall
 * that cannot be logged still answers, a Manager keeps and recalls
 * memories of its own that no other caller reads, and a store that cannot
 * be reached answers the model rather than failing the turn.
 *
 * Synthetic accounts, workspaces, and words throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return userId;
});

/** A call in a workspace of its own, as the member who owns it. */
const openCall = Effect.gen(function* () {
  const userId = yield* openAccount;

  const call: MemoryCall = {
    workspaceId: yield* openWorkspace(userId),
    userId,
  };

  return call;
});

/** A Manager of the call's member in its workspace, on no task; its id. */
const openManager = (call: MemoryCall) =>
  Effect.gen(function* () {
    const started = yield* createAgent(call.userId, {
      taskId: null,
      workspaceId: call.workspaceId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      descriptionSnapshot: null,
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      kind: AGENT_KIND.MANAGER,
    });

    return Option.getOrThrow(started).agent.id;
  });

const TESTS_RUN = "The web server's store tests run on PGlite through test:store.";
const DEPLOYS = "Deployments go out from the main branch through Vercel.";
const DEPLOYS_CORRECTED = "Deployments go out from the release branch through Vercel.";

/** A recall's answer, the memories it names by their words. */
function recalledWords(answer: WireRecord): readonly unknown[] {
  assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.ok(Array.isArray(answer.memories));

  return answer.memories.map((memory) => (isRecord(memory) ? memory.text : memory));
}

/** How often each memory named was recalled in the call's workspace, in order. */
const recallsOf = (call: MemoryCall, ids: readonly string[]) =>
  Effect.map(tallyMemoryRecalls(call.workspaceId, ids), (tallies) =>
    ids.map((id) => tallies.get(id)?.recalls30d),
  );

/** The id of the memory a remember answer kept. */
function keptId(answer: WireRecord): string {
  assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
  const kept = answer.memory;
  assert.ok(isRecord(kept) && isWireString(kept.id));

  return kept.id;
}

it.layer(getTestDB())("the coding agent's memory tools", (it) => {
  it.effect(
    "a memory kept is recalled by the words it holds, and a query that finds nothing answers none",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;

        assert.equal((yield* runRemember(call, { text: TESTS_RUN })).outcome, MEMORY_OUTCOME.KEPT);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* runRemember(call, { text: DEPLOYS });

        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "how do tests run" })), [
          TESTS_RUN,
        ]);
        // A query word finds the memory words it begins.
        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "deploy" })), [DEPLOYS]);
        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "kubernetes" })), []);
      }),
  );

  it.effect("a correction leaves only the corrected words to recall", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const id = keptId(yield* runRemember(call, { text: DEPLOYS }));

      const corrected = yield* runRemember(call, { text: DEPLOYS_CORRECTED, replaces: id });

      assert.equal(corrected.outcome, MEMORY_OUTCOME.CORRECTED);
      assert.equal(keptId(corrected), id);
      assert.deepEqual(recalledWords(yield* runRecall(call, { query: "deployments branch" })), [
        DEPLOYS_CORRECTED,
      ]);
    }),
  );

  it.effect(
    "a correction of a memory that is gone, or a new memory past the bound, is refused",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        const gone = randomUUID();

        const late = yield* runRemember(call, { text: DEPLOYS, replaces: gone });
        // Note that the workspace is filled in one insert, because a remember per memory reads every memory kept so far.
        const db = yield* Database;
        const now = new Date(0);
        yield* db.insert(memory).values(
          Array.from({ length: MEMORY_BOUNDS.MAX_MEMORIES }, (_, index) => ({
            organizationId: call.workspaceId,
            userId: call.userId,
            text: `Convention number ${index}.`,
            createdAt: now,
            updatedAt: now,
          })),
        );
        const past = yield* runRemember(call, { text: DEPLOYS });

        assert.equal(late.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(past.status, ACTION_RESULT_STATUS.REJECTED);
        assert.notEqual(late.reason, past.reason);
        assert.equal((yield* listMemories(call.workspaceId)).length, MEMORY_BOUNDS.MAX_MEMORIES);
      }),
  );

  it.effect("words that look like a credential are never kept, and the fact without it is", () =>
    Effect.gen(function* () {
      const call = yield* openCall;

      const credentials = [
        // Note that the token-shaped samples are built here rather than written whole, so no tracked line holds a credential's shape.
        `The staging key is ${["sk", "proj", "AbCdEfGh1234567890IjKlMnOp"].join("-")}.`,
        `CI pushes with ${["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("_")}.`,
        "The database is postgres://deploy:hunter2hunter2@db.internal:5432/app.",
        "Staging password: correct-horse-battery",
        "The webhook secret is Zx81kQp0Lm3NvB7tR2yWc5dF9gH4jK6s.",
        `${"-".repeat(5)}BEGIN RSA PRIVATE KEY${"-".repeat(5)} MIIEow`,
      ];

      for (const text of credentials) {
        const answer = yield* runRemember(call, { text });
        assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED, text);
      }

      const fact =
        "Staging credentials live in the team's 1Password vault, commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39.";

      assert.equal((yield* runRemember(call, { text: fact })).outcome, MEMORY_OUTCOME.KEPT);

      assert.deepEqual(
        (yield* listMemories(call.workspaceId)).map((kept) => kept.text),
        [fact],
      );
    }),
  );

  it.effect(
    "a coding agent's search logs each memory it answers as recalled, and a member's own search logs none",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        const tests = keptId(yield* runRemember(call, { text: TESTS_RUN }));
        const deploys = keptId(yield* runRemember(call, { text: DEPLOYS }));
        const agentId = yield* openAgentOnOwnTask(call.userId, call.workspaceId);
        const agents: MemoryCall = { ...call, source: { agentId, messageId: randomUUID() } };

        yield* runRecall(call, { query: "tests deployments" });
        const byMember = yield* recallsOf(call, [tests, deploys]);
        yield* runRecall(agents, { query: "tests" });

        assert.deepEqual(byMember, [0, 0]);
        assert.deepEqual(yield* recallsOf(call, [tests, deploys]), [1, 0]);
      }),
  );

  it.effect("a search whose recalls cannot be logged still answers what it found", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const tests = keptId(yield* runRemember(call, { text: TESTS_RUN }));
      // An agent the store holds no row of, so its recall's row is refused.
      const unlogged: MemoryCall = { ...call, source: { agentId: randomUUID(), messageId: null } };

      const answer = yield* runRecall(unlogged, { query: "tests" });

      assert.deepEqual(recalledWords(answer), [TESTS_RUN]);
      assert.deepEqual(yield* recallsOf(call, [tests]), [0]);
    }),
  );

  it.effect(
    "a Manager recalls the memories it keeps for itself beside the workspace's, a correction of one stays its own, and no other caller recalls them",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        const manager: MemoryCall = { ...call, managerId: yield* openManager(call) };

        yield* runRemember(manager, { text: TESTS_RUN });
        const own = keptId(yield* runRemember(manager, { text: DEPLOYS, scope: "manager" }));
        // Note that the correction names no scope, so it would land in the workspace's if it followed the default.
        yield* runRemember(manager, { text: DEPLOYS_CORRECTED, replaces: own });

        assert.deepEqual(
          new Set(recalledWords(yield* runRecall(manager, { query: "tests deployments" }))),
          new Set([DEPLOYS_CORRECTED, TESTS_RUN]),
        );
        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "tests deployments" })), [
          TESTS_RUN,
        ]);
      }),
  );

  it.effect("a call that does not read keeps and recalls nothing", () =>
    Effect.gen(function* () {
      const call = yield* openCall;

      const unread = [
        yield* runRemember(call, { text: "   " }),
        yield* runRemember(call, { text: "x".repeat(MEMORY_BOUNDS.MAX_CHARS + 1) }),
        yield* runRemember(call, { text: DEPLOYS, replaces: "not-an-id" }),
        yield* runRecall(call, { query: 7 }),
        yield* runRecall(call, {}),
        yield* runRecall(call, { query: "  " }),
      ];

      assert.deepEqual(
        unread.map((answer) => answer.status),
        unread.map(() => ACTION_RESULT_STATUS.REJECTED),
      );
      assert.deepEqual(yield* listMemories(call.workspaceId), []);
    }),
  );
});

it.effect(
  "a store that cannot be reached answers the model that memory is unavailable, and fails nothing",
  () =>
    Effect.gen(function* () {
      const call = { workspaceId: randomUUID(), userId: "user-unreached" };

      const remembered = yield* runRemember(call, { text: DEPLOYS });
      const recalled = yield* runRecall(call, { query: "deployments" });

      assert.equal(remembered.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(recalled.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(remembered.reason, recalled.reason);
    }).pipe(Effect.provide(noDatabase)),
);
