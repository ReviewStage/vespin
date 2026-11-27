import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { user } from "@repo/database/schemas/auth";
import { inboxItem } from "@repo/database/schemas/inbox";
import { task as taskTable } from "@repo/database/schemas/task";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { fakeWorkspaceSeams, getTestDB, joinWorkspace, startTask } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { INBOX_OLDER_PAGE_SIZE, INBOX_OLDER_READ } from "@repo/features/inbox-live";
import { INBOX_STATUS } from "@repo/features/inbox-wire";
import { ACCOUNT_INBOX_ITEMS, LIVE_POLL, LIVE_USER_QUERY } from "@repo/features/live-wire";
import { eq, inArray } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { type InboxAgent, postInboxThread } from "../../inbox/inbox-store.js";
import { hostedAnswer } from "../../testing/hosted-route.js";
import { liveProcedures } from "../live-procedures.js";

/**
 * The account's older inbox items as a client asks for them, page by page
 * through the live procedures: the settled items the items read leaves out
 * by the clock, newest first, each whole, every one read once across the
 * pages, ties on one instant broken by id, and none of an item the account
 * may not read, whether a teammate's it cannot see or another workspace's.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

/** The instant each case reads at, so the live window stands where an instant is a whole count of milliseconds past the epoch. */
const NOW = Date.parse("2026-10-15T09:00:00Z");

/** A day, in milliseconds. */
const DAY = 24 * 60 * 60 * 1000;

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return userId;
});

/** An agent of the account's on a task of its own in its test workspace. */
const openAgent = (userId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
      githubAccess: GITHUB_ACCESS.APP,
    });

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      githubAccess: GITHUB_ACCESS.APP,
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const agent: InboxAgent = {
      userId,
      taskId: task.id,
      agentId: Option.getOrThrow(started).agent.id,
    };

    return { agent, workspaceId: task.workspaceId };
  });

/** The agent's notices under the keys given, each posted with a message opening its thread; their ids. */
const postAll = (agent: InboxAgent, keys: readonly string[]) =>
  Effect.forEach(keys, (key) =>
    Effect.map(
      postInboxThread(agent, { key, title: `Merged ${key}`, body: "It is on main." }),
      (posted) => Result.getOrThrow(posted).id,
    ),
  );

/** The items named, closed, and last changed and settled at `at`, as an item settled long ago stands. */
const settleAt = (ids: readonly string[], at: Date) =>
  Effect.gen(function* () {
    const db = yield* Database;

    yield* db
      .update(inboxItem)
      .set({ status: INBOX_STATUS.CLOSED, updatedAt: at, settledAt: at })
      .where(inArray(inboxItem.id, [...ids]));
  });

/** One page of the account's older items asked as `bearer`, past `before` where named: its answer decoded, or the status it was refused with. */
const askOlder = (bearer: string, before?: string) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      // The test's own clock, so the window the service binds stands where the test put it.
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );

    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(bearer)),
      workspaces: yield* fakeWorkspaceSeams,
    });

    const url = new URL(INBOX_OLDER_READ.path, "https://app.test");
    url.searchParams.set(LIVE_USER_QUERY, bearer);
    url.searchParams.set(LIVE_POLL.QUERY, LIVE_POLL.ON);

    if (before !== undefined) url.searchParams.set("before", before);

    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { authorization: `Bearer ${bearer}` } }),
    );

    const body: unknown = JSON.parse(yield* Effect.promise(() => response.text()));

    return response.status === HOSTED_HTTP_STATUS.OK
      ? Result.succeed(Schema.decodeUnknownSync(INBOX_OLDER_READ.answer)(body))
      : Result.fail(response.status);
  });

/** Each part's row ids, in the order answered. */
// SAFETY: a part's rows are the read's own rows, each keyed by its `id` or, a file's, `attachmentId`.
const idsOf = (part: { readonly rows?: readonly unknown[] }) =>
  (part.rows ?? []).map((row) => (row as { readonly id: string }).id);

/** A page's items, by the ids its stamps and its rows name, sorted, the item each message is of, and the page after it. */
const pageOf = (answer: typeof INBOX_OLDER_READ.answer.Type) => ({
  stamps: idsOf(answer.queries.stamps).toSorted(),
  items: idsOf(answer.queries.items).toSorted(),
  // SAFETY: a messages part's rows are the read's own rows, each naming its item.
  threads: [
    ...new Set(
      (answer.queries.messages.rows ?? []).map(
        (row) => (row as { readonly itemId: string }).itemId,
      ),
    ),
  ].toSorted(),
  next: answer.next,
});

it.layer(getTestDB())("the account's older inbox items", (it) => {
  it.effect(
    "come a page at a time past the live window, the latest changed first and by id at one instant, each whole, every one once, and none the window carries",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const userId = yield* openUser;
        const { agent } = yield* openAgent(userId);
        const now = yield* Clock.currentTimeMillis;
        const settledSince = now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS;
        const keys = Array.from({ length: INBOX_OLDER_PAGE_SIZE + 2 }, (_, at) => `old-${at}`);
        const old = yield* postAll(agent, keys);
        // Every old item but the last settled at one instant, which only their ids order, and the last a day before it.
        const tied = new Date(settledSince - DAY);
        yield* settleAt(old.slice(0, -1), tied);
        yield* settleAt(old.slice(-1), new Date(settledSince - 2 * DAY));
        const [open, recent] = yield* postAll(agent, ["open", "recent"]);
        assert.ok(open !== undefined && recent !== undefined);
        yield* settleAt([recent], new Date(settledSince + DAY));

        const first = pageOf(Result.getOrThrow(yield* askOlder(userId)));
        assert.equal(first.stamps.length, INBOX_OLDER_PAGE_SIZE);
        assert.deepEqual(first.items, first.stamps, "each item on the page comes whole");
        assert.deepEqual(first.threads, first.stamps, "with its thread");
        assert.ok(first.next !== undefined, "a page that leaves more names the next");

        // The tied items stand by id, the greatest first, so the first page holds the greatest ids of them.
        const tiedByIdDesc = old.slice(0, -1).toSorted().toReversed();
        assert.deepEqual(first.stamps, tiedByIdDesc.slice(0, INBOX_OLDER_PAGE_SIZE).toSorted());

        const second = pageOf(Result.getOrThrow(yield* askOlder(userId, first.next)));
        assert.deepEqual(
          second.stamps,
          [...tiedByIdDesc.slice(INBOX_OLDER_PAGE_SIZE), ...old.slice(-1)].toSorted(),
          "the last page holds the rest of the tied items and the oldest",
        );
        assert.deepEqual(second.items, second.stamps);
        assert.equal(second.next, undefined, "the last page names none after it");
      }),
  );

  it.effect("refuse a page they did not answer", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;

      assert.deepEqual(
        yield* askOlder(userId, "not-a-page"),
        Result.fail(HOSTED_HTTP_STATUS.BAD_REQUEST),
      );
    }),
  );

  it.effect(
    "read none of a teammate's item the account may not see, nor of another workspace's",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        const now = yield* Clock.currentTimeMillis;
        const longAgo = new Date(now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS - DAY);

        const shared = yield* openAgent(owner);
        yield* joinWorkspace(shared.workspaceId, teammate);
        const [sharedItem] = yield* postAll(shared.agent, ["shared"]);
        assert.ok(sharedItem !== undefined);

        // A task of the owner's on their own GitHub token, which the teammate holds none to read through.
        const hidden = yield* openAgent(owner);
        const [hiddenItem] = yield* postAll(hidden.agent, ["hidden"]);
        assert.ok(hiddenItem !== undefined);
        const db = yield* Database;
        yield* db
          .update(taskTable)
          .set({ githubAccess: GITHUB_ACCESS.TOKEN })
          .where(eq(taskTable.id, hidden.agent.taskId ?? ""));

        // The outsider's own workspace, whose item no member of the owner's reads.
        const elsewhere = yield* openAgent(outsider);
        const [elsewhereItem] = yield* postAll(elsewhere.agent, ["elsewhere"]);
        assert.ok(elsewhereItem !== undefined);
        yield* settleAt([sharedItem, hiddenItem, elsewhereItem], longAgo);

        const read = (userId: string) =>
          Effect.map(askOlder(userId), (answered) => pageOf(Result.getOrThrow(answered)));

        assert.deepEqual((yield* read(owner)).stamps, [sharedItem, hiddenItem].toSorted());
        assert.deepEqual(
          yield* read(teammate),
          { stamps: [sharedItem], items: [sharedItem], threads: [sharedItem], next: undefined },
          "a teammate reads the shared item alone",
        );
        assert.deepEqual(
          yield* read(outsider),
          {
            stamps: [elsewhereItem],
            items: [elsewhereItem],
            threads: [elsewhereItem],
            next: undefined,
          },
          "another workspace's account reads its own alone",
        );
      }),
  );
});
