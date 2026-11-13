import { expect, test } from "vitest";
import {
  ASSIGNED_TO,
  childTaskCounts,
  createdByOnly,
  drawnTaskRows,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  repositoryParts,
  SHOWN_STATUSES,
  TASK_ORDER,
  tasksAssignedTo,
  tasksById,
  tasksInStatuses,
  taskTime,
} from "./task-list-model.js";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from "./task-wire.js";

const DEAN = "user-dean";
const CHARLES = "user-charles";
const MAYA = "user-maya";

const NAMES = {
  [DEAN]: "Dean Stratakos",
  [CHARLES]: "Charles Pan",
  [MAYA]: "Maya Okafor",
} as const;

/** A task on `repository`, started at `createdAt`, last updated at `updatedAt`, by `creator` where one is named. */
function task(
  name: string,
  repository: string | null,
  createdAt: number,
  updatedAt: number,
  creator?: keyof typeof NAMES,
): TaskSummary {
  return {
    id: name,
    workspaceId: "workspace-acme",
    name,
    createdAt,
    updatedAt,
    repository,
    ...(creator === undefined
      ? undefined
      : { ownerId: creator, createdBy: { userId: creator, name: NAMES[creator] } }),
  };
}

const names = (groups: readonly RepositoryGroup[]) =>
  groups.map((group) => group.tasks.map((each) => each.name));

test("a repository group lists its tasks newest updated first, the time each row shows", () => {
  const groups = repositoryGroups([
    task("old", "acme/relay", 3, 10),
    task("touched", "acme/relay", 1, 30),
    task("new", "acme/relay", 2, 20),
  ]);

  expect(names(groups)).toEqual([["touched", "new", "old"]]);
});

test("a row shows when its task was started under Created, and its last update otherwise", () => {
  const retry = task("Retry webhooks", "acme/relay", 100, 900);
  expect(taskTime(retry, TASK_ORDER.CREATED)).toBe(100);
  expect(taskTime(retry, TASK_ORDER.UPDATED)).toBe(900);
  expect(taskTime(retry, TASK_ORDER.NAME)).toBe(900);
});

test("two repositories sharing a name are told apart by their owners", () => {
  const groups = repositoryGroups([task("a", "acme/site", 1, 2), task("b", "labs/site", 1, 1)]);
  expect(repositoryLabel("acme/site", groups)).toBe("acme/site");
  expect(repositoryLabel("labs/site", repositoryGroups([task("b", "labs/site", 1, 1)]))).toBe(
    "site",
  );
});

test("a repository splits into its owner and its name, and a name with no owner is its name alone", () => {
  expect(repositoryParts("acme/relay")).toEqual({ owner: "acme", name: "relay" });
  expect(repositoryParts("relay")).toEqual({ owner: undefined, name: "relay" });
});

test("filtered to one creator, the list holds only the tasks they created; filtered to nobody, every task", () => {
  const tasks = [
    task("Dean's", "acme/relay", 1, 1, DEAN),
    task("Charles's", "acme/relay", 1, 1, CHARLES),
    task("Unnamed", "acme/relay", 1, 1),
  ];

  expect(createdByOnly(tasks, DEAN).map((task) => task.name)).toEqual(["Dean's"]);
  expect(createdByOnly(tasks, undefined)).toHaveLength(3);
});

test("a task whose agent ended a turn after another task's description was edited stands first, showing its agent's time", () => {
  const edited = task("Description edited at 500", "acme/relay", 1, 500);

  const worked = {
    ...task("Agent finished at 800", "acme/relay", 1, 100),
    agents: {
      total: 1,
      working: 0,
      activityAt: 800,
      pullRequestTotal: 0,
    },
  };

  const groups = repositoryGroups([edited, worked]);
  expect(names(groups)).toEqual([["Agent finished at 800", "Description edited at 500"]]);
  expect(taskTime(worked, TASK_ORDER.UPDATED)).toBe(800);
  expect(taskTime(edited, TASK_ORDER.UPDATED)).toBe(500);
});

test("an agent's activity older than the description's own edit leaves the description's time standing", () => {
  const summary = {
    ...task("Edited after its agent", "acme/relay", 1, 900),
    agents: {
      total: 1,
      working: 0,
      activityAt: 300,
      pullRequestTotal: 0,
    },
  };

  expect(taskTime(summary, TASK_ORDER.UPDATED)).toBe(900);
  expect(taskTime(summary, TASK_ORDER.CREATED)).toBe(1);
});

/** A task standing in `status` at `priority`, last updated at `updatedAt`. */
function standing(
  name: string,
  status: TaskStatus | undefined,
  priority: TaskPriority | undefined,
  updatedAt: number,
): TaskSummary {
  return {
    ...task(name, "acme/relay", 1, updatedAt),
    ...(status === undefined ? undefined : { status }),
    ...(priority === undefined ? undefined : { priority }),
  };
}

test("the list leaves the backlog and the settled out, and keeps a row with no status to leave out by", () => {
  const rows = [
    standing("Filed", TASK_STATUS.BACKLOG, TASK_PRIORITY.NONE, 1),
    standing("Under way", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.HIGH, 2),
    standing("Shipped", TASK_STATUS.DONE, TASK_PRIORITY.LOW, 3),
    standing("Also filed", TASK_STATUS.BACKLOG, TASK_PRIORITY.LOW, 4),
    standing("Older service", undefined, undefined, 5),
  ];

  expect(tasksInStatuses(rows, SHOWN_STATUSES).map((each) => each.name)).toEqual([
    "Under way",
    "Older service",
  ]);
});

/** A task as `task` makes it, assigned to `assignee`. */
function assigned(
  name: string,
  updatedAt: number,
  assignee: keyof typeof NAMES,
  creator?: keyof typeof NAMES,
): TaskSummary {
  return {
    ...task(name, "acme/relay", 1, updatedAt, creator),
    assignee: { userId: assignee, name: NAMES[assignee] },
  };
}

test("the rows assigned to one member are the tasks they are on, and every row for Anyone", () => {
  const rows = [
    {
      ...task("Dean's on it", "acme/relay", 1, 10, CHARLES),
      assignee: { userId: DEAN, name: "Dean" },
    },
    task("No one's on it", "acme/relay", 1, 20, DEAN),
  ];

  const member = { kind: ASSIGNED_TO.MEMBER, userId: DEAN } as const;
  expect(tasksAssignedTo(rows, member, CHARLES).map((each) => each.name)).toEqual(["Dean's on it"]);
  expect(tasksAssignedTo(rows, { kind: ASSIGNED_TO.ANYONE }, DEAN)).toHaveLength(2);
});

test("Following holds the tasks the reader follows, whoever is on them", () => {
  const rows = [
    {
      ...assigned("Dean's on it, Charles follows", 10, DEAN, DEAN),
      followers: [
        { userId: DEAN, assignee: true, machines: true },
        { userId: CHARLES, assignee: false, machines: false },
      ],
    },
    assigned("Charles is on it, follows nothing", 20, CHARLES, CHARLES),
  ];

  expect(
    tasksAssignedTo(rows, { kind: ASSIGNED_TO.FOLLOWING }, CHARLES).map((each) => each.name),
  ).toEqual(["Dean's on it, Charles follows"]);
});

test("Me holds the reader's tasks and the tasks no one is on that they created, but not a teammate's unassigned task or one they made for someone else", () => {
  const rows = [
    assigned("Charles made it, Dean's on it", 10, DEAN, CHARLES),
    task("Dean made it, no one's on it", "acme/relay", 1, 20, DEAN),
    assigned("Dean made it, Maya's on it", 30, MAYA, DEAN),
    task("Charles made it, no one's on it", "acme/relay", 1, 40, CHARLES),
  ];

  expect(tasksAssignedTo(rows, { kind: ASSIGNED_TO.ME }, DEAN).map((each) => each.name)).toEqual([
    "Charles made it, Dean's on it",
    "Dean made it, no one's on it",
  ]);
});

/** A task on acme/relay under `parent`, where one is named, updated at `updatedAt`. */
function childTask(name: string, updatedAt: number, parent?: string): TaskSummary {
  return {
    ...task(name, "acme/relay", updatedAt, updatedAt),
    ...(parent === undefined ? undefined : { parentTaskId: parent }),
  };
}

/** The rows drawn, each as its name indented two spaces for each level it stands at, `every` the workspace's tasks the list is drawn from. */
function drawnNames(
  tasks: readonly TaskSummary[],
  opened: readonly string[],
  standing?: string,
  every: readonly TaskSummary[] = tasks,
): string[] {
  return drawnTaskRows(
    tasks,
    (taskId) => opened.includes(taskId),
    (each) => each.name === standing,
    tasksById(every),
  ).map(({ task: each, depth }) => `${"  ".repeat(depth)}${each.name}`);
}

const TREE = [
  childTask("grandchild", 50, "child"),
  childTask("parent", 40),
  childTask("child", 30, "parent"),
  childTask("sibling", 20, "parent"),
  childTask("other", 10),
] as const;

test("a grandchild stands under its child, and that child under its parent, never at the top, each level in the list's order", () => {
  expect(drawnNames(TREE, ["parent", "child"])).toEqual([
    "parent",
    "  child",
    "    grandchild",
    "  sibling",
    "other",
  ]);
});

test("a parent folded shut draws none of its child tasks but the open one and the rows above it", () => {
  expect(drawnNames(TREE, [])).toEqual(["parent", "other"]);
  expect(drawnNames(TREE, [], "grandchild")).toEqual([
    "parent",
    "  child",
    "    grandchild",
    "other",
  ]);
});

test("a child task whose parent the list leaves out stands at the top", () => {
  const filtered = TREE.filter((each) => each.name !== "parent");
  expect(drawnNames(filtered, ["child"])).toEqual(["child", "  grandchild", "sibling", "other"]);
});

test("a child task whose parent the list leaves out stands under the nearest ancestor the list holds, at the depth it is drawn", () => {
  const hidden = TREE.filter((each) => each.name !== "child");
  expect(drawnNames(hidden, ["parent"], undefined, TREE)).toEqual([
    "parent",
    "  grandchild",
    "  sibling",
    "other",
  ]);
});

test("a pinned child task stands at the top, never under its parent, its own child tasks still under it", () => {
  const pinned = { ...childTask("child", 30, "parent"), pinnedAt: 1 };
  expect(
    drawnNames(
      [childTask("parent", 40), pinned, childTask("grandchild", 20, "child")],
      ["parent", "child"],
    ),
  ).toEqual(["parent", "child", "  grandchild"]);
});

test("a parent counts its direct child tasks that are done or canceled, of all its children, and not theirs", () => {
  const withStatus = (name: string, parent: string | undefined, status: TaskStatus) => ({
    ...childTask(name, 1, parent),
    status,
  });

  const counts = childTaskCounts([
    withStatus("parent", undefined, TASK_STATUS.IN_PROGRESS),
    withStatus("shipped", "parent", TASK_STATUS.DONE),
    withStatus("cut", "parent", TASK_STATUS.CANCELED),
    withStatus("working", "parent", TASK_STATUS.IN_PROGRESS),
    withStatus("waiting", "parent", TASK_STATUS.TODO),
    withStatus("grandchild", "working", TASK_STATUS.DONE),
  ]);

  expect(counts.get("parent")).toEqual({ finished: 2, total: 4 });
  expect(counts.get("working")).toEqual({ finished: 1, total: 1 });
  expect(counts.has("shipped")).toBe(false);
});
