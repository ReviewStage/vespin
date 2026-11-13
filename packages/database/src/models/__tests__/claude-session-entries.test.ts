import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import {
  appendSessionEntries,
  copySessionEntries,
  deleteSessionEntries,
  holdsSession,
  listSessionEntrySessions,
  listSessionEntrySubkeys,
  loadSessionEntries,
  loadSessionEntryPage,
  type SessionEntryPage,
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

const entry = (uuid: string) => ({ type: "user", uuid, message: { role: "user", content: uuid } });

/** A session's root: its first entry, the user's, with no parent. */
const root = (uuid: string) => ({ ...entry(uuid), parentUuid: null });

/** A key's whole transcript as the account reads it, none read as no entries. */
const loaded = (userId: string, conversationId: string, key: typeof MAIN | typeof SUBAGENT) =>
  loadSessionEntries(userId, conversationId, key).pipe(Effect.map(Option.getOrElse(() => [])));

/** A key's transcript read page by page from its first, each page's entries in its own list. */
const paged = (userId: string, conversationId: string, key: typeof MAIN | typeof SUBAGENT) =>
  Effect.gen(function* () {
    const pages: Array<ReadonlyArray<unknown>> = [];
    let after: number | null = null;

    do {
      const page: SessionEntryPage = yield* loadSessionEntryPage(
        userId,
        conversationId,
        key,
        after,
      );

      pages.push(page.entries);
      after = page.next;
    } while (after !== null);

    return pages;
  });

/** An account of its own with an agent of its own, by the agent's conversation. */
const openAgent = Effect.gen(function* () {
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
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  return { userId, conversationId: Option.getOrThrow(started).agent.conversationId };
});

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
      assert.deepEqual(yield* paged(userId, conversationId, MAIN), [
        [entry("a"), entry("b"), entry("c")],
      ]);
      assert.deepEqual(yield* paged(userId, conversationId, SUBAGENT), [[entry("s")]]);
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

  it.effect(
    "a session is held from its first entry where its root is stored, never where only a tail is, and a Start's copy of its source's transcript holds it as the source does",
    () =>
      Effect.gen(function* () {
        const source = yield* openAgent;
        const started = yield* openAgent;
        const tail = yield* openAgent;
        yield* appendSessionEntries(source.userId, source.conversationId, MAIN, [
          root("a"),
          entry("b"),
        ]);
        yield* appendSessionEntries(tail.userId, tail.conversationId, MAIN, [
          entry("b"),
          { type: "cost-state", sessionId: SESSION },
        ]);

        assert.equal(yield* holdsSession(source.userId, source.conversationId, SESSION), true);
        assert.equal(yield* holdsSession(tail.userId, tail.conversationId, SESSION), false);
        assert.equal(yield* holdsSession(started.userId, started.conversationId, SESSION), false);
        yield* copySessionEntries(source, started.conversationId);
        assert.equal(yield* holdsSession(started.userId, started.conversationId, SESSION), true);
        assert.deepEqual(yield* loaded(started.userId, started.conversationId, MAIN), [
          root("a"),
          entry("b"),
        ]);
        assert.deepEqual(yield* loaded(source.userId, source.conversationId, MAIN), [
          root("a"),
          entry("b"),
        ]);
      }),
  );

  it.effect(
    "a session larger than one page loads whole and in order across its pages, and another account pages none of it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAgent;
        const other = yield* openAgent;

        // Note that each entry of three megabytes holds more than a page's bytes alone, though far fewer than its count.
        const large = ["a", "b", "c"].map((uuid) => ({
          ...entry(uuid),
          toolOutput: uuid.repeat(3 * 1024 * 1024),
        }));

        yield* appendSessionEntries(owner.userId, owner.conversationId, MAIN, large);

        const pages = yield* paged(owner.userId, owner.conversationId, MAIN);
        assert.ok(pages.length > 1);
        assert.ok(pages.every((page) => page.length > 0));
        assert.deepEqual(pages.flat(), large);
        assert.deepEqual(yield* paged(other.userId, owner.conversationId, MAIN), [[]]);
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
