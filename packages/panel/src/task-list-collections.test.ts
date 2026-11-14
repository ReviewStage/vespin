/**
 * task-list-collections.test.ts -- the task list's collections fill from the window's first read and take only the rows a delivery moved.
 */

import { AGENT_STATUS } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import {
  type AppStateDelivery,
  type AppStateSnapshot,
  appStateDelivery,
} from "@repo/host/app-state";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { stateWith } from "./testing/app-state.js";
import { listedAgent } from "./testing/tasks-control.js";
import { type AppStateFollowing, followAppState } from "./use-app-state.js";

/** A task as the list carries it, named and timed as given. */
function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: "workspace-listed",
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: null,
  };
}

const INVITES = task("task-invites", "Teammate invitations");
const BILLING = task("task-billing", "Billing export");
const SEARCH = task("task-search", "Search outside the live set");

const LISTED: TasksView = {
  tasks: [INVITES, BILLING, SEARCH],
  taskAgents: [
    listedAgent({
      id: "agent-invites",
      taskId: INVITES.id,
      title: "Expire stale invitations",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      status: AGENT_STATUS.COMPLETED,
      createdAt: 1,
      turnId: null,
    }),
  ],
  agentPullRequests: [],
  listStatus: TASKS_READ.READY,
  workspaces: [],
};

/** Main's document at `version`, its task list as given. */
function documentAt(version: number, tasks: TasksView): AppStateSnapshot {
  return { ...stateWith({}, {}), version, tasks };
}

/** A window following `first` over a fake bridge, and the push that hands it a delivery as JSON crosses it. */
async function following(first: AppStateSnapshot): Promise<{
  readonly window: AppStateFollowing;
  readonly push: (delivery: AppStateDelivery) => void;
}> {
  let hear: ((delivery: AppStateDelivery) => void) | undefined;
  fakeAppBridge({
    requestAppState: () => Promise.resolve(structuredClone(first)),
    onAppState: (listener) => {
      hear = listener;

      return () => undefined;
    },
  });
  const window = followAppState(new QueryClient());
  await window.written;

  return {
    window,
    push: (delivery) => hear?.(JSON.parse(JSON.stringify(delivery))),
  };
}

/** What main pushes a window that holds `sent` once its document is `next`. */
function deliveryBetween(sent: AppStateSnapshot, next: AppStateSnapshot): AppStateDelivery {
  const delivery = appStateDelivery(sent, next);

  if (delivery === undefined) throw new Error("The two documents do not differ.");

  return delivery;
}

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe("the task list's collections", () => {
  it("hold every row of the first whole read", async () => {
    const { window } = await following(documentAt(1, LISTED));
    stops.push(window.stop);

    expect(window.taskList.tasks.isReady()).toBe(true);
    expect([...window.taskList.tasks.keys()].sort()).toEqual(
      [INVITES.id, BILLING.id, SEARCH.id].sort(),
    );
    expect(window.taskList.agents.get("agent-invites")?.taskId).toBe(INVITES.id);
  });

  it("write only the row a delivery moved, and delete the row that went", async () => {
    const first = documentAt(1, LISTED);
    const { window, push } = await following(first);
    stops.push(window.stop);
    const invitesHeld = window.taskList.tasks.get(INVITES.id);
    const told: { type: string; key: string }[] = [];
    const agentsTold: unknown[] = [];

    // Note that each subscriber is handed the rows held first, so a row it has seen is told as moved rather than as new.
    const tasks = window.taskList.tasks.subscribeChanges(
      (changes) => told.push(...changes.map(({ type, key }) => ({ type, key: String(key) }))),
      { includeInitialState: true },
    );

    const agents = window.taskList.agents.subscribeChanges(
      (changes) => agentsTold.push(...changes),
      { includeInitialState: true },
    );

    stops.push(
      () => tasks.unsubscribe(),
      () => agents.unsubscribe(),
    );
    told.length = 0;
    agentsTold.length = 0;

    const renamed = documentAt(2, {
      ...LISTED,
      tasks: [INVITES, { ...BILLING, name: "Billing" }, SEARCH],
    });

    push(deliveryBetween(first, renamed));

    expect(told).toEqual([{ type: "update", key: BILLING.id }]);
    expect(window.taskList.tasks.get(BILLING.id)?.name).toBe("Billing");
    expect(window.taskList.tasks.get(INVITES.id)).toBe(invitesHeld);
    expect(agentsTold).toEqual([]);

    told.length = 0;
    push(deliveryBetween(renamed, documentAt(3, { ...renamed.tasks, tasks: [INVITES, SEARCH] })));

    expect(told).toEqual([{ type: "delete", key: BILLING.id }]);
  });
});
