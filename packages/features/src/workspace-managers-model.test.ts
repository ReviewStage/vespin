import assert from "node:assert/strict";
import { test } from "vitest";
import { AGENT_KIND } from "./agent-wire.js";
import { workspaceManagersOf } from "./workspace-managers-model.js";

/**
 * workspace-managers-model.test.ts -- the workspace's Managers, as the
 * desktop's sidebar and the iOS app's Tasks tab and Search list them: its
 * unarchived agents of kind `manager` on no task, newest started first.
 * Synthetic ids.
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
