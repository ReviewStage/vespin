import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PAGE_OWNER, PAGE_SHOWER, type PageOwner, type PageShower } from "@repo/features/page-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { taskPageVersion } from "../../schemas/task-page.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { listPages, readPageById, readPageVersion, writePage } from "../task-pages.js";
import { createTask, deleteTask } from "../task-store.js";

/**
 * A task's pages read by the page's id alone, over a real dialect: any
 * member of the task's workspace reads the newest version or one named,
 * beside the task it stands on and its newest version, and an account
 * outside the workspace, or a version the page never had, reads nothing.
 * Each version keeps who showed it, the brain or a coding agent by its id, which
 * a member reads on the plan's list and on the version, and a version shown
 * before that was kept reads as shown by no one named.
 *
 * Synthetic accounts and pages throughout.
 */

const LUKE: PageShower = { kind: PAGE_SHOWER.APP };

const onTask = (taskId: string): PageOwner => ({ kind: PAGE_OWNER.TASK, taskId });

const shownByAgent = (agentId: string): PageShower => ({ kind: PAGE_SHOWER.AGENT, agentId });

/** A coding agent of the workspace, on the task named. */
const openAgent = (userId: string, organizationId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.AGENT });
    yield* db.insert(agentTable).values({
      id,
      organizationId,
      userId,
      taskId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      idempotencyKey: randomUUID(),
    });
    return id;
  });

/** Each version's owner columns as the row holds them. */
const ownerColumnsOf = (pageId: string) =>
  Effect.flatMap(Database, (db) =>
    db
      .select({
        version: taskPageVersion.version,
        taskId: taskPageVersion.taskId,
        agentId: taskPageVersion.agentId,
      })
      .from(taskPageVersion)
      .where(eq(taskPageVersion.pageId, pageId))
      .orderBy(taskPageVersion.version),
  );

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("a page read by its id", (it) => {
  it.effect(
    "a member reads a teammate's page by its id, its newest version or one named, with its task and newest version, and an outsider or a version never written reads nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const first = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Invites", html: "<h1>One</h1>" },
            LUKE,
          ),
        );
        yield* writePage(
          owner,
          onTask(task.id),
          { pageId: first.id, title: "Invites by week", html: "<h1>Two</h1>" },
          LUKE,
        );

        const newest = Option.getOrThrow(yield* readPageById(teammate, first.id, undefined));
        const earlier = Option.getOrThrow(yield* readPageById(teammate, first.id, 1));

        assert.deepEqual(
          [
            newest.owner,
            newest.page.version,
            newest.page.title,
            newest.page.html,
            newest.newestVersion,
          ],
          [onTask(task.id), 2, "Invites by week", "<h1>Two</h1>", 2],
        );
        assert.deepEqual(
          [earlier.page.version, earlier.page.html, earlier.newestVersion],
          [1, "<h1>One</h1>", 2],
        );
        assert.ok(Option.isNone(yield* readPageById(outsider, first.id, undefined)));
        assert.ok(Option.isNone(yield* readPageById(teammate, first.id, 3)));
        assert.ok(Option.isNone(yield* readPageById(teammate, randomUUID(), undefined)));
      }),
  );

  it.effect(
    "each version keeps who showed it, which a member reads on the plan's list and on the version, an outsider reads nothing of, and one shown before it was kept names no one",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const agent = shownByAgent(yield* openAgent(owner, workspace, task.id));
        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Invites", html: "<h1>One</h1>" },
            agent,
          ),
        );
        yield* writePage(
          owner,
          onTask(task.id),
          { pageId: shown.id, title: "Invites", html: "<h1>Two</h1>" },
          LUKE,
        );
        const older = Option.getOrThrow(
          yield* writePage(owner, onTask(task.id), { title: "Old", html: "<h1>Old</h1>" }, LUKE),
        );
        // A version shown before who showed it was kept, as the column's migration leaves it.
        const db = yield* Database;
        yield* db
          .update(taskPageVersion)
          .set({ shownBy: null })
          .where(eq(taskPageVersion.pageId, older.id));

        const listed = yield* listPages(teammate, onTask(task.id));
        const first = yield* readPageVersion(teammate, onTask(task.id), shown.id, 1);

        assert.deepEqual(
          // Pages written in the same millisecond list in no particular order, so they are read by title.
          listed
            .map((page) => [page.title, page.shownBy] as const)
            .toSorted(([one], [other]) => one.localeCompare(other)),
          [
            ["Invites", LUKE],
            ["Old", undefined],
          ],
        );
        assert.deepEqual(
          Option.map(first, (page) => page.shownBy),
          Option.some(agent),
        );
        assert.deepEqual(yield* listPages(outsider, onTask(task.id)), []);
        assert.ok(Option.isNone(yield* readPageVersion(outsider, onTask(task.id), shown.id, 1)));
      }),
  );

  it.effect(
    "an agent on a task shows its pages on the task and is named on each version, and the task's deletion takes them",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const onIt = yield* openAgent(owner, workspace, task.id);
        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Plan", html: "<p>1</p>" },
            shownByAgent(onIt),
          ),
        );
        yield* writePage(
          owner,
          onTask(task.id),
          { pageId: shown.id, title: "Plan", html: "<p>2</p>" },
          LUKE,
        );

        yield* deleteTask(owner, task.id);

        assert.deepEqual(yield* ownerColumnsOf(shown.id), []);
      }),
  );

  it.effect("an agent's deletion clears its name from a task's versions and keeps them whole", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
      const onIt = yield* openAgent(owner, workspace, task.id);
      const shown = Option.getOrThrow(
        yield* writePage(
          owner,
          onTask(task.id),
          { title: "Plan", html: "<p>1</p>" },
          shownByAgent(onIt),
        ),
      );
      const db = yield* Database;

      yield* db.delete(agentTable).where(eq(agentTable.id, onIt));

      assert.deepEqual(yield* ownerColumnsOf(shown.id), [
        { version: 1, taskId: task.id, agentId: null },
      ]);
      assert.equal(
        Option.getOrThrow(yield* readPageVersion(owner, onTask(task.id), shown.id, 1)).html,
        "<p>1</p>",
      );
    }),
  );
});
