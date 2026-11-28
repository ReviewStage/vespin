import { expect, test } from "vitest";
import { ASSIGNED_TO } from "./task-list-model.js";
import {
  DEFAULT_TASK_TREE_VIEW,
  searchedTasks,
  TASK_ROW_FACE,
  type TaskBranch,
  type TaskTree,
  taskBranches,
  taskRowFace,
  taskTree,
} from "./task-tree-model.js";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";
import { COMPLETED_WINDOW, TASKS_GROUPING, TASKS_ORDER } from "./tasks-page-model.js";

/**
 * task-tree-model.test.ts -- the phone's Tasks list holds each of the
 * reader's open tasks once, where the sidebar stands it: a pinned task under
 * Pinned, a sectioned one in its section, a child under its parent, the
 * rest under their repository, and a teammate's task they follow under
 * Following; a search finds a settled task by its key;
 * a row nests under the nearest shallower row above it, however deep;
 * the view the reader chose stands their tasks as the Tasks page would;
 * a row wears a teammate's face, the unassigned mark, or none for the reader's own.
 */

const READER = "user-ada";
const WORKSPACE = "workspace-acme";

/** The view the tab starts from, the sidebar's own, as the reader has not changed it. */
const SIDEBAR_VIEW = {
  treeView: DEFAULT_TASK_TREE_VIEW,
  personName: (userId: string) => userId,
  now: 0,
} as const;

/** A branch as the test reads it: a row's name, or its name and the branches under it. */
type Named = string | readonly [string, readonly Named[]];

/** A task the reader made and is on, last updated `updatedAt` minutes in. */
function task(
  id: string,
  status: TaskStatus,
  repository: string | null,
  updatedAt: number,
  more: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE,
    name: id,
    createdAt: 0,
    updatedAt,
    repository,
    status,
    ownerId: READER,
    createdBy: { userId: READER, name: "Ada Lovelace" },
    assignee: { userId: READER, name: "Ada Lovelace" },
    ...more,
  };
}

const TASKS: readonly TaskSummary[] = [
  task("Invites", TASK_STATUS.IN_PROGRESS, "ada/relay", 50),
  task("Invite copy", TASK_STATUS.TODO, "ada/relay", 60, { parentTaskId: "Invites" }),
  task("Digest", TASK_STATUS.TODO, "ada/relay", 40, { pinnedAt: 1 }),
  task("Usage alerts", TASK_STATUS.TODO, "ada/ledger", 30),
  task("Launch notes", TASK_STATUS.IN_PROGRESS, "ada/relay", 20),
  task("Rounding", TASK_STATUS.DONE, "ada/ledger", 70, { number: 41 }),
  task("Elsewhere", TASK_STATUS.TODO, "ada/relay", 80, { workspaceId: "workspace-other" }),
];

/** Each group's heading and its rows' names, nested ones indented by their depth. */
function drawn(tree: TaskTree): readonly (readonly string[])[] {
  return [
    ...(tree.pinned === undefined ? [] : [tree.pinned]),
    ...(tree.following === undefined ? [] : [tree.following]),
    ...tree.sections,
    ...tree.tasks,
  ].map((group) => [
    group.title ?? "",
    ...group.rows.map(({ task: each, depth }) => `${"  ".repeat(depth)}${each.name}`),
  ]);
}

test("the tree stands each open task once: pinned, sectioned, nested, then by repository", () => {
  const tree = taskTree({
    view: {
      tasks: TASKS,
      taskSections: {
        sections: [{ id: "section-launch", workspaceId: WORKSPACE, title: "Launch", createdAt: 1 }],
        entries: [{ taskId: "Launch notes", sectionId: "section-launch", addedAt: 1 }],
        agentEntries: [],
      },
    },
    workspaceId: WORKSPACE,
    readerId: READER,
    noRepository: "No repository",
    tasksHead: "My tasks",
    ...SIDEBAR_VIEW,
  });

  expect(drawn(tree)).toEqual([
    ["Pinned", "Digest"],
    ["Launch", "Launch notes"],
    ["relay", "Invites", "  Invite copy"],
    ["ledger", "Usage alerts"],
  ]);
});

test("a child task put in a section stands there with its own child tasks, not under its parent", () => {
  const tree = taskTree({
    view: {
      tasks: [
        ...TASKS,
        task("Invite copy review", TASK_STATUS.TODO, "ada/relay", 10, {
          parentTaskId: "Invite copy",
        }),
      ],
      taskSections: {
        sections: [{ id: "section-launch", workspaceId: WORKSPACE, title: "Launch", createdAt: 1 }],
        entries: [{ taskId: "Invite copy", sectionId: "section-launch", addedAt: 1 }],
        agentEntries: [],
      },
    },
    workspaceId: WORKSPACE,
    readerId: READER,
    noRepository: "No repository",
    tasksHead: "My tasks",
    ...SIDEBAR_VIEW,
  });

  expect(drawn(tree)).toEqual([
    ["Pinned", "Digest"],
    ["Launch", "Invite copy", "  Invite copy review"],
    ["relay", "Invites", "Launch notes"],
    ["ledger", "Usage alerts"],
  ]);
});

test("a teammate's open sub-task stands under the reader's parent, whatever its status", () => {
  const tree = taskTree({
    view: {
      tasks: [
        task("Invites", TASK_STATUS.IN_PROGRESS, "ada/relay", 50),
        task("Invite copy", TASK_STATUS.BACKLOG, "ada/relay", 60, {
          parentTaskId: "Invites",
          assignee: { userId: "user-grace", name: "Grace Hopper" },
        }),
      ],
    },
    workspaceId: WORKSPACE,
    readerId: READER,
    noRepository: "No repository",
    tasksHead: "My tasks",
    ...SIDEBAR_VIEW,
  });

  expect(drawn(tree)).toEqual([["", "Invites", "  Invite copy"]]);
});

test("Following holds the open tasks the reader follows that no other list holds", () => {
  const following = { followers: [{ userId: READER, assignee: false, machines: false }] };

  const teammate = {
    ownerId: "user-grace",
    createdBy: { userId: "user-grace", name: "Grace" },
    assignee: { userId: "user-grace", name: "Grace" },
  };

  const tree = taskTree({
    view: {
      tasks: [
        task("Digest", TASK_STATUS.TODO, "ada/relay", 40, { pinnedAt: 1, ...following }),
        task("Invites", TASK_STATUS.IN_PROGRESS, "ada/relay", 50, following),
        task("Billing", TASK_STATUS.TODO, "ada/ledger", 30, { ...teammate, ...following }),
        task("Billing copy", TASK_STATUS.TODO, "ada/ledger", 35, { parentTaskId: "Billing" }),
        task("Payouts", TASK_STATUS.DONE, "ada/ledger", 60, { ...teammate, ...following }),
        task("Refunds", TASK_STATUS.TODO, "ada/ledger", 70, teammate),
      ],
    },
    workspaceId: WORKSPACE,
    readerId: READER,
    noRepository: "No repository",
    tasksHead: "My tasks",
    ...SIDEBAR_VIEW,
  });

  expect(drawn(tree)).toEqual([
    ["Pinned", "Digest"],
    ["Following", "Billing", "  Billing copy"],
    ["", "Invites"],
  ]);
});

test("the view the reader chose stands their tasks: whose, grouped, ordered, finished lately, sub-tasks beside their parents", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  const grace = { assignee: { userId: "user-grace", name: "Grace Hopper" } };

  const tree = taskTree({
    view: {
      tasks: [
        task("Invites", TASK_STATUS.IN_PROGRESS, "ada/relay", 50),
        task("Invite copy", TASK_STATUS.TODO, "ada/relay", 60, {
          parentTaskId: "Invites",
          ...grace,
        }),
        task("Billing", TASK_STATUS.TODO, "ada/ledger", 30, grace),
        task("Archive", TASK_STATUS.BACKLOG, "ada/ledger", 10),
        task("Rounding", TASK_STATUS.DONE, "ada/ledger", 70, { completedAt: now - 2 * day }),
        task("Payouts", TASK_STATUS.DONE, "ada/ledger", 80, { completedAt: now - 20 * day }),
      ],
    },
    workspaceId: WORKSPACE,
    readerId: READER,
    noRepository: "No repository",
    tasksHead: "Everyone's tasks",
    treeView: {
      assignedTo: { kind: ASSIGNED_TO.ANYONE },
      statuses: [],
      grouping: TASKS_GROUPING.STATUS,
      order: TASKS_ORDER.NAME,
      completed: COMPLETED_WINDOW.PAST_WEEK,
      subTasks: true,
    },
    personName: (userId) => userId,
    now,
  });

  expect(drawn(tree)).toEqual([
    ["In progress", "Invites"],
    ["Todo", "Billing", "Invite copy"],
    ["Done", "Rounding"],
  ]);
});

test("a search finds the workspace's tasks whatever their status, by name or key", () => {
  const found = searchedTasks({
    tasks: TASKS,
    workspaceId: WORKSPACE,
    workspaceName: "Acme",
    tokens: ["acme-41"],
  });

  expect(found.map((each) => each.name)).toEqual(["Rounding"]);
});

test("each row stands under the nearest shallower row above it, however deep, and the rows after it at the top", () => {
  const row = (name: string, depth: number, open: boolean | undefined) => ({
    task: task(name, TASK_STATUS.TODO, "ada/relay", 0),
    depth,
    open,
  });

  const names = (branches: readonly TaskBranch[]): readonly Named[] =>
    branches.map(({ row: { task: each }, branches: under }) =>
      under.length === 0 ? each.name : [each.name, names(under)],
    );

  expect(
    names(
      taskBranches([
        row("Invites", 0, true),
        row("Invite copy", 1, true),
        row("Invite links", 2, undefined),
        row("Invite email", 1, undefined),
        row("Digest", 0, undefined),
      ]),
    ),
  ).toEqual([["Invites", [["Invite copy", ["Invite links"]], "Invite email"]], "Digest"]);
});

test("a row wears a teammate's face, the unassigned mark where no one is on it, and none for the reader's own", () => {
  const grace = { userId: "user-grace", name: "Grace Hopper" };
  const { assignee: _reader, ...unassigned }: TaskSummary = task("ship", TASK_STATUS.TODO, null, 1);

  expect([
    taskRowFace(task("ship", TASK_STATUS.TODO, null, 1, { assignee: grace }), READER, false),
    taskRowFace(unassigned, READER, false),
    taskRowFace(unassigned, READER, true),
    taskRowFace(task("ship", TASK_STATUS.TODO, null, 1), READER, false),
  ]).toEqual([
    { kind: TASK_ROW_FACE.PERSON, userId: "user-grace", name: "Grace Hopper" },
    { kind: TASK_ROW_FACE.NOBODY },
    undefined,
    undefined,
  ]);
});
