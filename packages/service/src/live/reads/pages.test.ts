import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@repo/database/core/live-statement";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { listPages, writePage } from "@repo/database/models/task-pages";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { pagesOfLiveRows, TASK_PAGES_READ } from "@repo/features/task-pages-live";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { taskPagesRead } from "./pages.js";

/**
 * A task's pages as Realtime would deliver them, over the real migrations on
 * PGlite: the statement run as Realtime runs it, its rows decoded and ordered
 * as the desktop does, beside `listPages`, the held read the Inbox read them
 * with. The two agree as pages are shown, as a page's next version lands,
 * and for an account that does not reach the task.
 *
 * Synthetic accounts, pages, and words throughout.
 */

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return userId;
});

/** The statement run as Realtime runs it. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** A coding agent of the account's, on the task named. */
const openAgent = (userId: string, place: { taskId: string }) =>
  Effect.map(
    createAgent(userId, {
      taskId: place.taskId,
      descriptionSnapshot: null,
      prompt: null,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

/** The pages as Realtime would deliver them to `reader`, as the desktop orders them. */
const liveRowsOf = (statement: LiveStatement) =>
  Effect.gen(function* () {
    const rows = yield* Schema.decodeUnknownEffect(TASK_PAGES_READ.rows)({
      pages: yield* runLive(statement),
    });

    return pagesOfLiveRows(rows);
  });

/** The task's pages as Realtime would deliver them to `reader`, as the desktop orders them. */
const livePagesOf = (reader: string, taskId: string) =>
  liveRowsOf(Option.getOrThrow(taskPagesRead.statements({ userId: reader, id: taskId })).pages);

it.layer(getTestDB())("a task's pages followed live", (it) => {
  it.effect(
    "answer what listPages answers as pages are shown and moved on, and nothing to a stranger",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing" });

        const agrees = Effect.gen(function* () {
          const held = yield* listPages(owner, taskPageOwner(task.id));
          assert.deepEqual(yield* livePagesOf(owner, task.id), held);

          return held;
        });

        assert.deepEqual(yield* agrees, []);

        const funnel = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(task.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.APP },
          ),
        );

        yield* writePage(
          owner,
          taskPageOwner(task.id),
          { title: "Seat pricing", html: "<p>Seats</p>" },
          { kind: PAGE_SHOWER.AGENT, agentId: yield* openAgent(owner, { taskId: task.id }) },
        );
        yield* writePage(
          owner,
          taskPageOwner(other.id),
          { title: "Another task's page", html: "<p>Elsewhere</p>" },
          { kind: PAGE_SHOWER.APP },
        );
        assert.equal((yield* agrees).length, 2);
        yield* writePage(
          owner,
          taskPageOwner(task.id),
          { pageId: funnel.id, title: "Invite funnel, revised", html: "<p>Two</p>" },
          { kind: PAGE_SHOWER.APP },
        );
        const pages = yield* agrees;
        assert.deepEqual(
          pages.find((page) => page.id === funnel.id)?.title,
          "Invite funnel, revised",
        );
        assert.deepEqual(yield* livePagesOf(stranger, task.id), []);
      }),
  );
});
