import { expect, test } from "vitest";
import { foldedTaskRows, searchedTasks, type TaskTree, taskTree } from "./task-tree-model.js";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";

/**
 * task-tree-model.test.ts -- the phone's Tasks list holds each of the
 * reader's open tasks once, where the sidebar stands it: a pinned task under
 * Pinned, a sectioned one in its section, a child under its parent, the
 * rest under their repository, and a teammate's task they follow under
 * Following; a search finds a settled task by its key;
 * a shut parent hides every row under it, however deep, and no row past it.
 */

const READER = "user-ada";
const WORKSPACE = "workspace-acme";

/** A task of the reader's, last updated `updatedAt` minutes in. */
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
  });

  expect(drawn(tree)).toEqual([
    ["Pinned", "Digest"],
    ["Launch", "Invite copy", "  Invite copy review"],
    ["relay", "Invites", "Launch notes"],
    ["ledger", "Usage alerts"],
  ]);
});

test("Following holds the open tasks the reader follows that no other list holds", () => {
  const following = { followers: [{ userId: READER, assignee: false, machines: false }] };
  const teammate = { ownerId: "user-grace", createdBy: { userId: "user-grace", name: "Grace" } };

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
  });

  expect(drawn(tree)).toEqual([
    ["Pinned", "Digest"],
    ["Following", "Billing", "  Billing copy"],
    ["", "Invites"],
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

test("a shut parent hides every row under it, however deep, and the rows after it stand", () => {
  const row = (name: string, depth: number, open: boolean | undefined) => ({
    task: task(name, TASK_STATUS.TODO, "ada/relay", 0),
    depth,
    open,
  });

  const rows = [
    row("Invites", 0, true),
    row("Invite copy", 1, true),
    row("Invite links", 2, undefined),
    row("Invite email", 1, undefined),
    row("Digest", 0, undefined),
  ];

  const shown = foldedTaskRows(rows, (taskId) => taskId !== "Invites");

  expect(shown.map(({ task: each, open }) => [each.name, open])).toEqual([
    ["Invites", false],
    ["Digest", undefined],
  ]);
  expect(
    foldedTaskRows(rows, (taskId) => taskId === "Invites").map(({ task: each }) => each.name),
  ).toEqual(["Invites", "Invite copy", "Invite email", "Digest"]);
});
