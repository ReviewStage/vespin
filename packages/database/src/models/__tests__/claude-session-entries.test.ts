import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import {
  appendSessionEntries,
  copySessionEntries,
  deleteSessionEntries,
  holdsSessionEntries,
  listSessionEntrySessions,
  listSessionEntrySubkeys,
  loadSessionEntries,
} from "../claude-session-entries.js";
import { deleteConversations } from "../conversation-delete.js";

/**
 * An agent's CLI transcript as Anthropic's reference Postgres store keeps
 * it, over a real dialect: the example's append, load, list, and delete,
 * each narrowed to the account's own conversation, a Start's copy of its
 * source's rows, and the rows' going with their conversation's purge.
 * Synthetic accounts throughout.
 */

const PROJECT = "-workspace-repository";
const SESSION = "6f1c2a4e-0d3b-4c55-9a8e-2f7d1b9c0e11";
const MAIN = { projectKey: PROJECT, sessionId: SESSION };
const SUBAGENT = { ...MAIN, subpath: "subagents/agent-1" };
const EARLIER = { projectKey: PROJECT, sessionId: "0b7e5d2c-8a41-4f6e-b3c9-71d24e6a5f08" };

const entry = (uuid: string) => ({ type: "user", uuid, message: { role: "user", content: uuid } });

/** A key's whole transcript as the account reads it, none read as no entries. */
const loaded = (userId: string, conversationId: string, key: typeof MAIN | typeof SUBAGENT) =>
  loadSessionEntries(userId, conversationId, key).pipe(Effect.map(Option.getOrElse(() => [])));

/** An account of its own with an agent of its own on the runtime given, by the agent's conversation. */
const openAgentOn = Effect.fnUntraced(function* (runtime: ConversationRuntime) {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime,
  });
  return { userId, conversationId: Option.getOrThrow(started).agent.conversationId };
});

const openAgent = openAgentOn(CONVERSATION_RUNTIME.CLAUDE_CODE);

it.layer(getTestDB())("an agent's stored CLI transcript", (it) => {
  it.effect("a session's transcripts load in order, list, and delete with their subpaths", () =>
    Effect.gen(function* () {
      const { userId, conversationId } = yield* openAgent;
      yield* appendSessionEntries(userId, conversationId, MAIN, [entry("a"), entry("b")]);
      yield* appendSessionEntries(userId, conversationId, SUBAGENT, [entry("s")]);
      yield* appendSessionEntries(userId, conversationId, MAIN, [entry("c")]);

      assert.deepEqual(yield* loaded(userId, conversationId, MAIN), [
        entry("a"),
        entry("b"),
        entry("c"),
      ]);
      assert.deepEqual(yield* loaded(userId, conversationId, SUBAGENT), [entry("s")]);
      assert.deepEqual(
        (yield* listSessionEntrySessions(userId, conversationId, PROJECT)).map(
          (listed) => listed.sessionId,
        ),
        [SESSION],
      );
      assert.deepEqual(yield* listSessionEntrySubkeys(userId, conversationId, MAIN), [
        SUBAGENT.subpath,
      ]);

      yield* deleteSessionEntries(userId, conversationId, MAIN);
      assert.deepEqual(yield* loaded(userId, conversationId, MAIN), []);
      assert.deepEqual(yield* loaded(userId, conversationId, SUBAGENT), []);
    }),
  );

  it.effect("an account reads and writes its own agent's transcript, and never another's", () =>
    Effect.gen(function* () {
      const owner = yield* openAgent;
      const other = yield* openAgent;
      yield* appendSessionEntries(owner.userId, owner.conversationId, MAIN, [entry("a")]);

      yield* appendSessionEntries(other.userId, owner.conversationId, MAIN, [entry("x")]);
      yield* deleteSessionEntries(other.userId, owner.conversationId, MAIN);
      assert.deepEqual(yield* loaded(other.userId, owner.conversationId, MAIN), []);
      assert.deepEqual(
        yield* listSessionEntrySessions(other.userId, owner.conversationId, PROJECT),
        [],
      );
      assert.deepEqual(yield* loaded(owner.userId, owner.conversationId, MAIN), [entry("a")]);
    }),
  );

  it.effect("a main transcript of bookkeeping alone is neither held nor loaded", () =>
    Effect.gen(function* () {
      const { userId, conversationId } = yield* openAgent;
      const costState = { type: "cost-state", sessionId: SESSION, totalCostUSD: 0 };
      // An earlier session's messages stay beside it, and hold nothing of this one.
      yield* appendSessionEntries(userId, conversationId, EARLIER, [entry("e")]);
      yield* appendSessionEntries(userId, conversationId, MAIN, [costState]);

      assert.equal(yield* holdsSessionEntries(userId, conversationId, SESSION), false);
      assert.deepEqual(yield* loaded(userId, conversationId, MAIN), []);

      yield* appendSessionEntries(userId, conversationId, MAIN, [entry("a")]);
      assert.equal(yield* holdsSessionEntries(userId, conversationId, SESSION), true);
      assert.deepEqual(yield* loaded(userId, conversationId, MAIN), [costState, entry("a")]);
    }),
  );

  it.effect(
    "Codex holds its rollout under a subpath, and Claude Code never a subagent's alone",
    () =>
      Effect.gen(function* () {
        const codex = yield* openAgentOn(CONVERSATION_RUNTIME.CODEX);
        const unrolled = yield* openAgentOn(CONVERSATION_RUNTIME.CODEX);
        const claude = yield* openAgent;
        const rollout = { type: "session_meta" };
        yield* appendSessionEntries(codex.userId, codex.conversationId, SUBAGENT, [rollout]);
        yield* appendSessionEntries(unrolled.userId, unrolled.conversationId, MAIN, [entry("m")]);
        yield* appendSessionEntries(claude.userId, claude.conversationId, SUBAGENT, [entry("s")]);

        assert.equal(yield* holdsSessionEntries(codex.userId, codex.conversationId, SESSION), true);
        assert.deepEqual(yield* loaded(codex.userId, codex.conversationId, SUBAGENT), [rollout]);
        assert.equal(
          yield* holdsSessionEntries(unrolled.userId, unrolled.conversationId, SESSION),
          false,
        );
        assert.equal(
          yield* holdsSessionEntries(claude.userId, claude.conversationId, SESSION),
          false,
        );
      }),
  );

  it.effect("a Start copies its source's transcript, which the source keeps", () =>
    Effect.gen(function* () {
      const source = yield* openAgent;
      const started = yield* openAgent;
      const empty = yield* openAgent;
      yield* appendSessionEntries(source.userId, source.conversationId, MAIN, [
        entry("a"),
        entry("b"),
      ]);

      assert.equal(yield* holdsSessionEntries(empty.userId, empty.conversationId, SESSION), false);
      assert.equal(yield* holdsSessionEntries(source.userId, source.conversationId, SESSION), true);
      yield* copySessionEntries(source, started.conversationId);
      assert.deepEqual(yield* loaded(started.userId, started.conversationId, MAIN), [
        entry("a"),
        entry("b"),
      ]);
      assert.deepEqual(yield* loaded(source.userId, source.conversationId, MAIN), [
        entry("a"),
        entry("b"),
      ]);
    }),
  );

  it.effect("a transcript goes with its conversation when a delete removes it", () =>
    Effect.gen(function* () {
      const { userId, conversationId } = yield* openAgent;
      const kept = yield* openAgent;
      yield* appendSessionEntries(userId, conversationId, MAIN, [entry("a")]);
      yield* appendSessionEntries(kept.userId, kept.conversationId, MAIN, [entry("k")]);

      yield* deleteConversations([conversationId]);

      assert.deepEqual(yield* loaded(userId, conversationId, MAIN), []);
      assert.deepEqual(yield* loaded(kept.userId, kept.conversationId, MAIN), [entry("k")]);
    }),
  );
});
