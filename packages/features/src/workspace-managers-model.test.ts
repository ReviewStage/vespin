import assert from "node:assert/strict";
import { it, test } from "vitest";
import { AGENT_KIND, AGENT_STATUS } from "./agent-wire.js";
import {
  MANAGER_SORT,
  type ManagerSort,
  sortedManagers,
  workspaceManagersOf,
} from "./workspace-managers-model.js";

/**
 * workspace-managers-model.test.ts -- the workspace's Managers, as the
 * desktop's sidebar and the iOS app's Tasks tab and Search list them: its
 * unarchived agents of kind `manager` on no task, newest started first;
 * and the same Managers sorted as a reader chose. Synthetic ids.
 */

const HERE = "workspace-here";

function agent(
  id: string,
  fields: {
    readonly createdAt: number;
    readonly manager?: boolean;
    readonly taskId?: string | null;
    readonly workspaceId?: string;
    readonly archivedAt?: number;
  },
) {
  return {
    id,
    createdAt: fields.createdAt,
    taskId: fields.taskId ?? null,
    workspaceId: fields.workspaceId ?? HERE,
    ...(fields.manager === false ? undefined : { kind: AGENT_KIND.MANAGER }),
    ...(fields.archivedAt === undefined ? undefined : { archivedAt: fields.archivedAt }),
  };
}

test("lists the workspace's unarchived Managers alone, newest started first", () => {
  const listed = [
    agent("older", { createdAt: 1 }),
    agent("newer", { createdAt: 3 }),
    agent("archived", { createdAt: 4, archivedAt: 5 }),
    agent("elsewhere", { createdAt: 6, workspaceId: "workspace-other" }),
    agent("coder", { createdAt: 7, manager: false }),
    agent("on-a-task", { createdAt: 8, taskId: "task-1" }),
  ];

  assert.deepEqual(
    workspaceManagersOf(listed, HERE).map((each) => each.id),
    ["newer", "older"],
  );
});

/** Three Managers whose name, start, and last move each order them apart: Charlie started first and moved last; Bravo, at work, started last. */
const SORTED = [
  {
    ...agent("charlie", { createdAt: 1 }),
    title: "Charlie",
    status: AGENT_STATUS.COMPLETED,
    runStartedAt: 8,
    settledAt: 9,
  },
  {
    ...agent("alpha", { createdAt: 2 }),
    title: "alpha",
    status: AGENT_STATUS.COMPLETED,
    runStartedAt: 3,
    settledAt: 4,
  },
  {
    ...agent("bravo", { createdAt: 5 }),
    title: "Bravo",
    status: AGENT_STATUS.RUNNING,
    runStartedAt: 6,
  },
];

it.each<[ManagerSort, readonly string[]]>([
  [MANAGER_SORT.RECENT_ACTIVITY, ["charlie", "bravo", "alpha"]],
  [MANAGER_SORT.NAME, ["alpha", "bravo", "charlie"]],
  [MANAGER_SORT.CREATED, ["bravo", "alpha", "charlie"]],
])("sorted by %s", (sort, ids) => {
  assert.deepEqual(
    sortedManagers(SORTED, sort).map((each) => each.id),
    ids,
  );
});
