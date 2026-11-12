import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INBOX_ASK_STATUS, INBOX_STATUS } from "@repo/features/inbox-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { inboxItem } from "../../schemas/inbox.js";
import { inboxMessage } from "../../schemas/inbox-message.js";
import { getTestDB, openInboxItem, openTaskAgent, openWorkspace } from "../../testing/index.js";
import { archiveAgent, readAgent, unarchiveAgentFrom } from "../agent-store.js";
import { beginTaskWork, createTask, updateTask } from "../task-store.js";

/**
 * An inbox item settles on its own once its reason is gone: its task moved
 * to Done or Canceled, by hand or by the finish, or its agent archived,
 * through the stores' public writes over a real dialect. Every open item of
 * the task or the agent that holds an ask closes with why and its ask stands
 * withdrawn with the same why; a notice of theirs, and an item of another
 * task, agent, or account, stands open. Nothing undoes a settle: the agent
 * brought back, or the task moved off Done or Canceled by a member or by a
 * turn starting on it, leaves every item it settled closed.
 *
 * Synthetic accounts, workspaces, tasks, and agents throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** A member's task with an agent on it holding a question and a notice open: the question as its items, which a settle closes, and the notice beside them, which it leaves. */
const openTaskWithItems = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const { id: taskId } = yield* createTask(userId, { organizationId });
    const agentId = yield* openTaskAgent(userId, organizationId, taskId);
    const question = yield* openInboxItem(userId, organizationId, taskId, agentId, true);
    const notice = yield* openInboxItem(userId, organizationId, taskId, agentId, false);

    return { taskId, agentId, items: [question], notice };
  });

/** Where the item stands: its status, who closed it and why, and how each ask of its thread stands. */
const standingOf = (itemId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const [item] = yield* db
      .select({
        status: inboxItem.status,
        closedReason: inboxItem.closedReason,
        closedBy: inboxItem.closedBy,
        openAsk: inboxItem.openAskMessageId,
        settledAt: inboxItem.settledAt,
      })
      .from(inboxItem)
      .where(eq(inboxItem.id, itemId));

    const messages = yield* db
      .select({ ask: inboxMessage.ask })
      .from(inboxMessage)
      .where(eq(inboxMessage.itemId, itemId));

    return {
      ...(item ?? assert.fail("the item is gone")),
      asks: messages.flatMap(({ ask }) =>
        ask === null
          ? []
          : [
              {
                status: ask.status,
                withdrawnReason: ask.withdrawnReason,
                withdrawnAt: ask.withdrawnAt,
              },
            ],
      ),
    };
  });

/** The items stand open, each question's ask open too, with no withdrawal's time left on it. */
const assertOpen = (itemIds: readonly string[]) =>
  Effect.gen(function* () {
    for (const itemId of itemIds) {
      const standing = yield* standingOf(itemId);
      assert.equal(standing.status, INBOX_STATUS.OPEN);

      for (const ask of standing.asks) {
        assert.equal(ask.status, INBOX_ASK_STATUS.OPEN);
        assert.equal(ask.withdrawnAt, undefined);
      }
    }
  });

/** The items stand closed by no member, with why, and every ask they held withdrawn with the same why when the item settled. */
const assertSettled = (itemIds: readonly string[], reason: string) =>
  Effect.gen(function* () {
    for (const itemId of itemIds) {
      const standing = yield* standingOf(itemId);
      assert.equal(standing.status, INBOX_STATUS.CLOSED);
      assert.equal(standing.closedReason, reason);
      assert.equal(standing.closedBy, null);
      assert.equal(standing.openAsk, null);

      for (const ask of standing.asks) {
        assert.deepEqual(ask, {
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: reason,
          withdrawnAt: standing.settledAt?.getTime(),
        });
      }
    }
  });

it.layer(getTestDB())("an inbox item settling with its task", (it) => {
  it.effect(
    "closes a task's open questions when a member moves it to done or canceled, and no notice of its own or other task's or account's item",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const elsewhere = yield* openWorkspace(outsider);
        const shipped = yield* openTaskWithItems(dean, workspace);
        const dropped = yield* openTaskWithItems(dean, workspace);
        const working = yield* openTaskWithItems(dean, workspace);
        const theirs = yield* openTaskWithItems(outsider, elsewhere);

        yield* updateTask(dean, shipped.taskId, { status: TASK_STATUS.DONE });
        yield* updateTask(dean, dropped.taskId, { status: TASK_STATUS.CANCELED });
        yield* updateTask(dean, working.taskId, { status: TASK_STATUS.IN_PROGRESS });

        yield* assertSettled(shipped.items, "Its task is done.");
        yield* assertSettled(dropped.items, "Its task was canceled.");
        yield* assertOpen([...working.items, ...theirs.items]);
        yield* assertOpen([shipped.notice, dropped.notice]);
      }),
  );

  it.effect(
    "leaves the items a move settled closed when a member or a turn moves the task off done or canceled",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const done = yield* openTaskWithItems(dean, workspace);
        const canceled = yield* openTaskWithItems(dean, workspace);
        const taken = yield* openTaskWithItems(dean, workspace);

        yield* updateTask(dean, done.taskId, { status: TASK_STATUS.DONE });
        yield* updateTask(dean, done.taskId, { status: TASK_STATUS.IN_PROGRESS });
        yield* updateTask(dean, canceled.taskId, { status: TASK_STATUS.CANCELED });
        yield* updateTask(dean, canceled.taskId, { status: TASK_STATUS.TODO });
        yield* updateTask(dean, taken.taskId, { status: TASK_STATUS.DONE });
        assert.equal(yield* beginTaskWork(dean, taken.taskId), true);

        yield* assertSettled(done.items, "Its task is done.");
        yield* assertSettled(canceled.items, "Its task was canceled.");
        yield* assertSettled(taken.items, "Its task is done.");
      }),
  );
});

/** The agent's archive as it stands, failing the test where it stands unarchived. */
const archivedAtOf = (userId: string, agentId: string) =>
  Effect.map(
    readAgent(userId, agentId),
    (agent) => Option.getOrUndefined(agent)?.archivedAt ?? assert.fail("the agent is not archived"),
  );

/** Each store write that archives an agent, paired with a write that brings it back, both as its member. */
const ARCHIVES = [
  {
    name: "an archive by hand, undone by hand",
    archive: (userId: string, agentId: string) => archiveAgent(userId, agentId, true),
    unarchive: (userId: string, agentId: string) => archiveAgent(userId, agentId, false),
  },
  {
    name: "an archive by hand, undone from the archive read",
    archive: (userId: string, agentId: string) => archiveAgent(userId, agentId, true),
    unarchive: (userId: string, agentId: string) =>
      Effect.flatMap(archivedAtOf(userId, agentId), (archivedAt) =>
        unarchiveAgentFrom(userId, agentId, archivedAt),
      ),
  },
] as const;

it.layer(getTestDB())("an inbox item settling with its agent", (it) => {
  it.effect.each(ARCHIVES)(
    "$name closes the agent's open questions and leaves them closed once it is back, and no notice of its own or other agent's or account's item",
    ({ archive, unarchive }) =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const elsewhere = yield* openWorkspace(outsider);
        const archived = yield* openTaskWithItems(dean, workspace);
        const teammate = yield* openTaskAgent(dean, workspace, archived.taskId);
        const besides = yield* openInboxItem(dean, workspace, archived.taskId, teammate, true);
        const theirs = yield* openTaskWithItems(outsider, elsewhere);

        yield* archive(dean, archived.agentId);
        yield* assertSettled(archived.items, "Its agent was archived.");
        yield* assertOpen([archived.notice, besides, ...theirs.items]);

        yield* unarchive(dean, archived.agentId);
        yield* assertSettled(archived.items, "Its agent was archived.");
      }),
  );
});
