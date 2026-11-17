import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { listPages, readPageVersion, writePage } from "@repo/database/models/task-pages";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openTaskAgent, startTask } from "@repo/database/testing";
import { PAGE_SHOWER, type PageShower, taskPageOwner } from "@repo/features/page-wire";
import { Effect, Option } from "effect";

/**
 * A plan's pages, through the store's write and reads: a write is a page's
 * next version and every version stands as written, the plan lists each page
 * by its newest, a member of the task's workspace reads and writes its pages
 * whoever started it, and a task of a workspace the account is not in, or a
 * page the task does not hold, reads and writes as none. Synthetic accounts, tasks, and pages
 * throughout.
 */

const CHART = { title: "Invite funnel", html: "<!doctype html><p>v1</p>" } as const;
const CHART_AGAIN = { title: "Invite funnel, by week", html: "<!doctype html><p>v2</p>" } as const;
const MOCKUP = { title: "Invite dialog", html: "<!doctype html><button>Invite</button>" } as const;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return userId;
});

/** A task and the coding agent on it that shows its pages. */
const openTask = Effect.gen(function* () {
  const userId = yield* openAccount;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const agentId = yield* openTaskAgent(userId, task.workspaceId, task.id);
  const shower: PageShower = { kind: PAGE_SHOWER.AGENT, agentId };

  return { userId, taskId: task.id, workspaceId: task.workspaceId, shower };
});

/** A write the test expects to land, as the page it left. */
const written = (
  userId: string,
  taskId: string,
  write: Parameters<typeof writePage>[2],
  shower: PageShower,
) => Effect.map(writePage(userId, taskPageOwner(taskId), write, shower), Option.getOrThrow);

it.layer(getTestDB())("a plan's pages", (it) => {
  it.effect("another account's plan lists, reads, and takes no page", () =>
    Effect.gen(function* () {
      const { userId, taskId, shower } = yield* openTask;
      const other = yield* openAccount;
      const chart = yield* written(userId, taskId, CHART, shower);

      assert.deepEqual(yield* listPages(other, taskPageOwner(taskId)), []);
      assert.ok(Option.isNone(yield* readPageVersion(other, taskPageOwner(taskId), chart.id, 1)));
      assert.ok(Option.isNone(yield* writePage(other, taskPageOwner(taskId), MOCKUP, shower)));
      assert.ok(
        Option.isNone(
          yield* writePage(other, taskPageOwner(taskId), { pageId: chart.id, ...MOCKUP }, shower),
        ),
      );
      assert.deepEqual(yield* listPages(userId, taskPageOwner(taskId)), [chart]);
    }),
  );

  it.effect("a member of the plan's workspace reads and writes the pages a teammate wrote", () =>
    Effect.gen(function* () {
      const { userId, taskId, workspaceId, shower } = yield* openTask;
      const teammate = yield* openAccount;
      yield* joinWorkspace(workspaceId, teammate);
      const first = yield* written(userId, taskId, CHART, shower);

      const again = yield* written(teammate, taskId, { pageId: first.id, ...CHART_AGAIN }, shower);

      assert.equal(again.version, 2);
      assert.deepEqual(yield* listPages(userId, taskPageOwner(taskId)), [again]);
      assert.equal(
        Option.getOrThrow(yield* readPageVersion(teammate, taskPageOwner(taskId), first.id, 1))
          .html,
        CHART.html,
      );
    }),
  );
});
