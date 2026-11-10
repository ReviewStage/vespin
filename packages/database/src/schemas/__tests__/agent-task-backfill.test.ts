import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TASK_STATUS } from "@repo/features/task-wire";
import { TURN_STATUS } from "@repo/wire";
import { asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace, replayable } from "../../testing/index.js";
import { agentTable } from "../agent.js";
import { agentBrowserTab } from "../agent-browser-tab.js";
import { user } from "../auth.js";
import { inboxItem } from "../inbox.js";
import { task } from "../task.js";
import { taskPageVersion } from "../task-page.js";
import { taskPin } from "../task-pin.js";

/**
 * The migrations that give every agent with no task a task of its own and
 * then require one: over a database from before them, each such agent lands
 * on a new task of its workspace, numbered after the workspace's last, named
 * from its title, assigned to its starter, Done unless it is still at work,
 * with its starter's pin, inbox thread, the pages it showed, and its
 * browser's tabs carried onto it; and running the backfill twice changes
 * nothing. Its read marks and sections are no longer replayed, since their
 * tables are dropped (`agent_read_and_section_entry_drop`). Synthetic
 * accounts throughout.
 */

const BACKFILL = "20261110012454_agent_task_backfill";
const REQUIRED = "20261110012643_agent_task_required";

/** The second migration undone, so the database stands as one from before both. */
const UNDO = [
  `ALTER TABLE "agent" ALTER COLUMN "task_id" DROP NOT NULL`,
  `CREATE INDEX "agent_org_taskless_created" ON "agent" ("organization_id","created_at") WHERE "agent"."task_id" is null`,
];

/** An agent with no task, written as a deployment from before the migrations wrote one; its id. */
const tasklessAgent = (
  userId: string,
  organizationId: string,
  title: string | null,
  startedAt: string,
  turn: typeof TURN_STATUS.RUNNING | typeof TURN_STATUS.SETTLED,
  archivedAt: string | null,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* sql`insert into conversations (id, user_id, kind) values (${conversationId}, ${userId}, 'coding_agent')`;
    yield* sql`insert into agent (id, organization_id, user_id, task_id, conversation_id, model, effort, repository, title, archived_at, idempotency_key, created_at)
      values (${id}, ${organizationId}, ${userId}, null, ${conversationId}, 'anthropic/claude-opus-5.5', 'high', 'acme/api', ${title}, ${archivedAt}, ${randomUUID()}, ${startedAt})`;
    yield* sql`insert into turns (user_id, conversation_id, origin, status, queued_at, settled_at)
      values (${userId}, ${conversationId}, 'user', ${turn}, ${startedAt}, ${turn === TURN_STATUS.SETTLED ? "2026-10-20T10:00:00Z" : null})`;
    return id;
  });

it.layer(getTestDB())("agent_task_backfill over a database from before it", (it) => {
  it.effect(
    "each agent with no task lands on a task of its own, numbered after the workspace's, standing as the agent did and carrying its starter's marks, and running it again changes nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const sql = yield* SqlClient.SqlClient;
        const userId = `user-${randomUUID()}`;
        yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@app.test` });
        const organizationId = yield* openWorkspace(userId);
        const standing = yield* createTask(userId, {
          organizationId,
          name: "Teammate invitations",
        });

        for (const statement of UNDO) yield* sql.unsafe(statement);

        // Started out of order, so the numbers follow the order they were started in, not the order they were written.
        const working = yield* tasklessAgent(
          userId,
          organizationId,
          "Fix the flaky upload test",
          "2026-10-18T09:00:00Z",
          TURN_STATUS.RUNNING,
          null,
        );
        const archived = yield* tasklessAgent(
          userId,
          organizationId,
          null,
          "2026-10-16T09:00:00Z",
          TURN_STATUS.SETTLED,
          "2026-10-21T09:00:00Z",
        );
        yield* sql`insert into agent_pin (user_id, agent_id, pinned_at) values (${userId}, ${working}, '2026-10-19T09:00:00Z')`;
        const itemId = randomUUID();
        yield* sql`insert into inbox_item (id, user_id, task_id, organization_id, agent_id, key, revision, version, title, needs_reply, status, posted_at, updated_at)
          values (${itemId}, ${userId}, null, ${organizationId}, ${working}, 'branch-protection', 1, 5, 'Require a review on main', false, 'open', now(), now())`;
        const pageVersionId = randomUUID();
        yield* sql`insert into task_page_version (id, task_id, agent_id, page_id, version, title, html, at)
          values (${pageVersionId}, null, ${working}, ${randomUUID()}, 1, 'Flaky runs', '<p>Three of ten</p>', now())`;
        const tabId = randomUUID();
        yield* sql`insert into agent_browser_tab (id, conversation_id, task_id, target_id, address, opened_by)
          select ${tabId}, conversation_id, null, 'target-1', 'https://ci.example.test/runs', 'agent' from agent where id = ${working}`;

        const backfill = replayable(yield* migrationStatements(BACKFILL));
        for (const statement of backfill) yield* sql.unsafe(statement);
        for (const statement of backfill) yield* sql.unsafe(statement);
        // The column is required again once every agent stands on a task, which fails where the backfill left one on none.
        for (const statement of yield* migrationStatements(REQUIRED)) yield* sql.unsafe(statement);

        const agents = yield* db
          .select({ id: agentTable.id, taskId: agentTable.taskId })
          .from(agentTable)
          .where(inArray(agentTable.id, [working, archived]));
        const taskOf = new Map(agents.map((agent) => [agent.id, agent.taskId]));
        const made = yield* db
          .select({
            id: task.id,
            name: task.name,
            number: task.number,
            status: task.status,
            userId: task.userId,
            assigneeId: task.assigneeId,
            repository: task.repository,
            completedAt: task.completedAt,
          })
          .from(task)
          .where(eq(task.organizationId, organizationId))
          .orderBy(asc(task.number));
        assert.deepEqual(made, [
          {
            id: standing.id,
            name: "Teammate invitations",
            number: 1,
            status: TASK_STATUS.TODO,
            userId,
            assigneeId: null,
            repository: null,
            completedAt: null,
          },
          {
            id: taskOf.get(archived),
            name: "Untitled",
            number: 2,
            status: TASK_STATUS.DONE,
            userId,
            assigneeId: userId,
            repository: "acme/api",
            completedAt: new Date("2026-10-21T09:00:00Z"),
          },
          {
            id: taskOf.get(working),
            name: "Fix the flaky upload test",
            number: 3,
            status: TASK_STATUS.IN_PROGRESS,
            userId,
            assigneeId: userId,
            repository: "acme/api",
            completedAt: null,
          },
        ]);

        const workingTask = taskOf.get(working) ?? "";
        const pins = yield* db
          .select({ taskId: taskPin.taskId })
          .from(taskPin)
          .where(eq(taskPin.userId, userId));
        assert.deepEqual(pins, [{ taskId: workingTask }]);
        const [item] = yield* db
          .select({ taskId: inboxItem.taskId })
          .from(inboxItem)
          .where(eq(inboxItem.id, itemId));
        assert.deepEqual(item, { taskId: workingTask });
        const [page] = yield* db
          .select({ taskId: taskPageVersion.taskId })
          .from(taskPageVersion)
          .where(eq(taskPageVersion.id, pageVersionId));
        assert.deepEqual(page, { taskId: workingTask });
        const [tab] = yield* db
          .select({ taskId: agentBrowserTab.taskId })
          .from(agentBrowserTab)
          .where(eq(agentBrowserTab.id, tabId));
        assert.deepEqual(tab, { taskId: workingTask });

        // A task started after the backfill takes the next number, not one the backfill handed out.
        const next = yield* createTask(userId, {
          organizationId,
          name: "Rotate the webhook secret",
        });
        assert.equal(next.number, 4);
      }),
  );
});
