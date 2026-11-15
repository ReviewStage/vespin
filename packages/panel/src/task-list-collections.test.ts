// @vitest-environment jsdom

/**
 * task-list-collections.test.ts -- the task list's collections fill from the window's first read and take only the rows a task-list push moved, and a surface reading them by id holds across a push moving another task.
 */

import { AGENT_STATUS } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import {
  type AppStateSnapshot,
  type TaskListDelivery,
  taskListDelivery,
} from "@repo/host/app-state";
import { QueryClient } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  TaskListCollectionsProvider,
  useNamedTask,
  useTaskListRows,
} from "./task-list-collections.js";
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
  taskPullRequests: [{ taskId: INVITES.id, pullRequests: [] }],
  agentPullRequests: [],
  listStatus: TASKS_READ.READY,
  workspaces: [],
};

/** Main's document at `version`, its task list as given. */
function documentAt(version: number, tasks: TasksView): AppStateSnapshot {
  return { ...stateWith({}, {}), version, tasks };
}

/** A window following `first` over a fake bridge, and the task-list push that hands it a delivery as JSON crosses it. */
async function following(first: AppStateSnapshot): Promise<{
  readonly window: AppStateFollowing;
  readonly push: (delivery: TaskListDelivery) => void;
}> {
  let hear: ((delivery: TaskListDelivery) => void) | undefined;
  fakeAppBridge({
    requestAppState: () => Promise.resolve(structuredClone(first)),
    onAppState: () => () => undefined,
    onTaskList: (listener) => {
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

/** The task-list push main sends a window that holds `sent` once its document is `next`. */
function deliveryBetween(sent: AppStateSnapshot, next: AppStateSnapshot): TaskListDelivery {
  const delivery = taskListDelivery(sent, next);

  if (delivery === undefined) throw new Error("The two documents do not differ.");

  return delivery;
}

const stops: (() => void)[] = [];

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

/** What a surface reading the task list by id last drew: the task by its id, the rows' lookup, and the task through it. */
interface ReadById {
  readonly named: TaskSummary | undefined;
  readonly rows: ReturnType<typeof useTaskListRows>;
  readonly looked: TaskSummary | undefined;
}

/** Draws a surface over `window`'s collections reading `taskId` by its id, as the shell, the palette, and the Inbox do, `typed` the names being typed; answers what it last drew. */
async function readingById(
  window: AppStateFollowing,
  taskId: string,
  typed: ReadonlyMap<string, string>,
): Promise<() => ReadById> {
  let latest: ReadById | undefined;

  function Surface(): null {
    const named = useNamedTask(taskId, typed);
    const rows = useTaskListRows(typed);
    latest = { named, rows, looked: rows.task(taskId) };

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root.render(
      createElement(TaskListCollectionsProvider, {
        collections: window.taskList,
        children: createElement(Surface),
      }),
    ),
  );
  // Note that the lookup follows the ids it was asked once committed, which the live query then answers.
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
  stops.push(() => act(() => root.unmount()));

  return () => {
    if (latest === undefined) throw new Error("the surface has not drawn");

    return latest;
  };
}

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
    expect(window.taskList.taskPullRequests.get(INVITES.id)?.pullRequests).toEqual([]);
  });

  it("write only the row a push moved, and delete the row that went", async () => {
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

    const moved = deliveryBetween(first, renamed);

    expect(moved).toEqual({
      version: 2,
      moved: [{ key: ["tasks"], rows: [{ ...BILLING, name: "Billing" }] }],
    });
    push(moved);

    expect(told).toEqual([{ type: "update", key: BILLING.id }]);
    expect(window.taskList.tasks.get(BILLING.id)?.name).toBe("Billing");
    expect(window.taskList.tasks.get(INVITES.id)).toBe(invitesHeld);
    expect(agentsTold).toEqual([]);

    told.length = 0;
    push(deliveryBetween(renamed, documentAt(3, { ...renamed.tasks, tasks: [INVITES, SEARCH] })));

    expect(told).toEqual([{ type: "delete", key: BILLING.id }]);
  });
});

describe("a surface reading the task list by id", () => {
  it("is handed the same objects while a push moves another task, and the moved row once its own moves", async () => {
    const first = documentAt(1, LISTED);
    const { window, push } = await following(first);
    stops.push(window.stop);
    const read = await readingById(window, INVITES.id, new Map());
    const before = read();

    const billingRenamed = documentAt(2, {
      ...LISTED,
      tasks: [INVITES, { ...BILLING, name: "Billing" }, SEARCH],
    });

    await act(async () => push(deliveryBetween(first, billingRenamed)));

    expect(read().named).toBe(before.named);
    expect(read().rows).toBe(before.rows);
    expect(read().looked).toBe(before.looked);

    await act(async () =>
      push(
        deliveryBetween(
          billingRenamed,
          documentAt(3, {
            ...LISTED,
            tasks: [{ ...INVITES, name: "Invitations" }, { ...BILLING, name: "Billing" }, SEARCH],
          }),
        ),
      ),
    );

    expect(read().named?.name).toBe("Invitations");
    expect(read().looked?.name).toBe("Invitations");
  });

  it("draws a name being typed over the one listed", async () => {
    const { window } = await following(documentAt(1, LISTED));
    stops.push(window.stop);
    const read = await readingById(window, INVITES.id, new Map([[INVITES.id, "Invites, typed"]]));

    expect(read().named?.name).toBe("Invites, typed");
    expect(read().looked?.name).toBe("Invites, typed");
  });
});
