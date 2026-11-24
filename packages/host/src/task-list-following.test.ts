import assert from "node:assert/strict";
import { AGENT_STATUS, type ListedAgent } from "@repo/features/agent-wire";
import type { TaskListParts } from "@repo/features/tasks-view";
import { it } from "vitest";
import { taskListFollowing } from "./task-list-following.js";

/** An agent as the task list carries it, on the task named, and archived where `archivedAt` is given. */
function agent(id: string, fields: Partial<ListedAgent> = {}): ListedAgent {
  return {
    id,
    taskId: "task-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
    workspaceId: "workspace-1",
    repository: null,
    ...fields,
  };
}

/** The task list holding `taskAgents` and nothing else. */
function lists(taskAgents: readonly ListedAgent[]): TaskListParts {
  return { tasks: [], taskAgents, taskPullRequests: [], agentPullRequests: [] };
}

/** The ids the agents' collection holds, in order. */
async function heldIds(following: ReturnType<typeof taskListFollowing>): Promise<string[]> {
  const held = await following.collections.agents.toArrayWhenReady();

  return held.map((each) => each.id).toSorted();
}

it("an archived agent on a task is kept back at launch, so a read of it by id misses until the backlog is written, and every other agent is there at once", async () => {
  const following = taskListFollowing({ deferArchivedAgents: true });
  const manager = agent("manager", { taskId: null, archivedAt: 5 });
  following.write(1, lists([agent("live"), agent("archived", { archivedAt: 5 }), manager]));

  assert.deepEqual(await heldIds(following), ["live", "manager"]);
  assert.equal(following.collections.agents.get("archived"), undefined);

  following.flushDeferredAgents();

  assert.equal(following.collections.agents.get("archived")?.archivedAt, 5);
  following.stop();
});

it("the backlog is written a few at a time, each answering how many still wait, and once it is empty an agent archived later passes straight through", async () => {
  const following = taskListFollowing({ deferArchivedAgents: true });
  following.write(1, lists(["a", "b", "c"].map((id) => agent(id, { archivedAt: 5 }))));

  assert.equal(following.writeDeferredAgents(2), 1);
  assert.equal((await heldIds(following)).length, 2);
  assert.equal(following.writeDeferredAgents(2), 0);

  following.deliver({
    version: 2,
    moved: [{ key: ["taskAgents"], rows: [agent("d", { archivedAt: 6 })] }],
  });

  assert.deepEqual(await heldIds(following), ["a", "b", "c", "d"]);
  following.stop();
});

it("an agent archived while the backlog waits leaves the collection for it, one brought back leaves it for the collection, and one gone is never written", async () => {
  const following = taskListFollowing({ deferArchivedAgents: true });
  following.write(
    1,
    lists([agent("live"), agent("back", { archivedAt: 5 }), agent("gone", { archivedAt: 5 })]),
  );

  following.deliver({
    version: 2,
    moved: [
      {
        key: ["taskAgents"],
        rows: [agent("live", { archivedAt: 7 }), agent("back")],
        ids: ["live", "back"],
      },
    ],
  });

  assert.deepEqual(await heldIds(following), ["back"]);

  following.flushDeferredAgents();

  assert.deepEqual(await heldIds(following), ["back", "live"]);
  following.stop();
});

it("an agent the Inbox names is written at once, while the rest of the backlog waits", async () => {
  const following = taskListFollowing({ deferArchivedAgents: true });
  following.write(1, lists([agent("named", { archivedAt: 5 }), agent("other", { archivedAt: 5 })]));

  following.keepAgents(["named"]);

  assert.deepEqual(await heldIds(following), ["named"]);
  following.stop();
});
