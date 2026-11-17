import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace } from "../../testing/index.js";
import { user } from "../auth.js";

/**
 * The migration that rewrites the rows only the retired call notetaker and
 * the app's own actor wrote: the notetaker's tasks and revisions read as
 * their member's own, a page version the app showed as one shown before who
 * showed it was kept, and the app's comments and the asks sent to it leave
 * their threads, a thread with no member's comment left going whole. The
 * rows are written as an earlier build stored them, under the app's old
 * word as well as its new one. Synthetic accounts and rows throughout.
 */

const MIGRATION = "20261116215610_retired_notetaker_and_app_actor_rows";

/** The words earlier builds stored for the actors the migration retires; no code names them now. */
const OLD = { NOTETAKER: "notetaker", APP: "app", LEGACY_APP: "luke" } as const;

/** The migration's statements, run in one transaction as the migrator runs them; its exit. */
const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const statements = yield* migrationStatements(MIGRATION);

  return yield* Effect.exit(
    sql.withTransaction(Effect.forEach(statements, (statement) => sql.unsafe(statement))),
  );
});

/** An account with a workspace and a task in it. */
const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@app.test` });
  const organizationId = yield* openWorkspace(userId);
  const task = yield* createTask(userId, { organizationId, name: "Teammate invitations" });

  return { userId, taskId: task.id };
});

/** A thread on the task's description, moved on to `revision`; its id. */
const openThread = (taskId: string, revision: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = randomUUID();

    yield* sql`
      INSERT INTO description_comment_thread (id, task_id, scope, quote, section, status, revision, created_at, updated_at)
      VALUES (${id}, ${taskId}, 'words', 'invite', '', 'open', ${revision}, now(), now())
    `;

    return id;
  });

/** One entry of a thread, written by `actor` and asking `asked` where it is an ask; its id. */
const writeEntry = (
  thread: { readonly taskId: string; readonly threadId: string; readonly userId: string },
  entry: {
    readonly seq: number;
    readonly kind: string;
    readonly actor: string;
    readonly asked?: string;
  },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = randomUUID();
    const words = entry.kind === "comment" ? "Who may withdraw an invite?" : null;

    yield* sql`
      INSERT INTO description_comment (id, thread_id, task_id, seq, kind, actor, user_id, words, asked_actor, created_at)
      VALUES (${id}, ${thread.threadId}, ${thread.taskId}, ${entry.seq}, ${entry.kind}, ${entry.actor}, ${thread.userId}, ${words}, ${entry.asked ?? null}, now())
    `;

    return id;
  });

it.layer(getTestDB())("the retired notetaker's and app's rows", (it) => {
  it.effect(
    "a task and a revision the notetaker wrote read as their member's, and a page version the app showed names no one",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, taskId } = yield* openTask;
        yield* sql`UPDATE task SET creator_actor = ${OLD.NOTETAKER} WHERE id = ${taskId}`;

        yield* sql`
          INSERT INTO description_revision (task_id, seq, actor, user_id, description, changes, started_at, at)
          VALUES (${taskId}, 1, ${OLD.NOTETAKER}, ${userId}, '## Goal', 1, now(), now())
        `;

        for (const kind of [OLD.APP, OLD.LEGACY_APP]) {
          yield* sql`
            INSERT INTO task_page_version (task_id, page_id, version, title, html, shown_by, at)
            VALUES (${taskId}, ${randomUUID()}, 1, 'Invite funnel', '<p>1</p>', ${JSON.stringify({ kind })}::jsonb, now())
          `;
        }

        assert.ok(Exit.isSuccess(yield* migrate));

        const tasks = yield* sql`SELECT creator_actor FROM task WHERE id = ${taskId}`;

        const revisions =
          yield* sql`SELECT actor, user_id FROM description_revision WHERE task_id = ${taskId}`;

        const pages = yield* sql`SELECT shown_by FROM task_page_version WHERE task_id = ${taskId}`;

        assert.deepEqual(tasks, [{ creator_actor: "developer" }]);
        assert.deepEqual(revisions, [{ actor: "developer", user_id: userId }]);
        assert.deepEqual(pages, [{ shown_by: null }, { shown_by: null }]);
      }),
  );

  it.effect(
    "the app's comments and the asks sent to it leave their threads, which move on, a thread left with no member's comment goes, and every other thread stands as it was",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, taskId } = yield* openTask;
        const kept = { taskId, userId, threadId: yield* openThread(taskId, 3) };
        const appsAlone = { taskId, userId, threadId: yield* openThread(taskId, 1) };
        const untouched = { taskId, userId, threadId: yield* openThread(taskId, 1) };

        const question = yield* writeEntry(kept, { seq: 1, kind: "comment", actor: "member" });
        yield* writeEntry(kept, { seq: 2, kind: "asked", actor: "member", asked: OLD.LEGACY_APP });
        yield* writeEntry(kept, { seq: 3, kind: "comment", actor: OLD.APP });
        yield* writeEntry(appsAlone, { seq: 1, kind: "comment", actor: OLD.LEGACY_APP });
        const standing = yield* writeEntry(untouched, { seq: 1, kind: "comment", actor: "member" });

        assert.ok(Exit.isSuccess(yield* migrate));

        const threads = yield* sql`
          SELECT id, revision FROM description_comment_thread WHERE task_id = ${taskId} ORDER BY revision DESC
        `;

        const entries = yield* sql`
          SELECT id FROM description_comment WHERE task_id = ${taskId} ORDER BY seq, id
        `;

        assert.deepEqual(threads, [
          { id: kept.threadId, revision: 4 },
          { id: untouched.threadId, revision: 1 },
        ]);
        assert.deepEqual(
          entries.map((entry) => entry.id).toSorted(),
          [question, standing].toSorted(),
        );
      }),
  );
});
