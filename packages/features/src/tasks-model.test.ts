import assert from "node:assert/strict";
import { TASK_BOUNDS, TASK_STATUS } from "@repo/features/task-wire";
import { test } from "vitest";
import {
  filedTaskOf,
  SETTLED_STATUS,
  settleChanges,
  settledNote,
  settleOffered,
} from "./tasks-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** A listed task at a status, or with none, as a service before statuses lists it. */
function standingTask(id: string, status?: (typeof TASK_STATUS)[keyof typeof TASK_STATUS]) {
  return {
    id,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    ...(status === undefined ? undefined : { status }),
  };
}

test("Mark done asks Done of the task", () => {
  const working = standingTask(INVITES, TASK_STATUS.IN_PROGRESS);

  const asked = settleChanges([working], SETTLED_STATUS.DONE);

  assert.deepEqual(asked, [{ taskId: INVITES, status: TASK_STATUS.DONE }]);
  assert.equal(settledNote(SETTLED_STATUS.DONE, 1, 0), "Marked done");
});

test("a repository's Mark tasks done asks Done of every task, and leaves one already done alone", () => {
  const tasks = [
    standingTask("task-backlog", TASK_STATUS.BACKLOG),
    standingTask("task-todo", TASK_STATUS.TODO),
    standingTask("task-before-statuses"),
    standingTask("task-done", TASK_STATUS.DONE),
  ];

  const asked = settleChanges(tasks, SETTLED_STATUS.DONE);

  assert.deepEqual(asked, [
    { taskId: "task-backlog", status: TASK_STATUS.DONE },
    { taskId: "task-todo", status: TASK_STATUS.DONE },
    { taskId: "task-before-statuses", status: TASK_STATUS.DONE },
  ]);
  assert.equal(settledNote(SETTLED_STATUS.DONE, 3, 1), "3 tasks marked done, 1 could not be");
});

test("a task already done is offered no Mark done, and one already canceled no Cancel task", () => {
  assert.equal(settleOffered(standingTask(INVITES, TASK_STATUS.DONE), SETTLED_STATUS.DONE), false);
  assert.equal(
    settleOffered(standingTask(INVITES, TASK_STATUS.CANCELED), SETTLED_STATUS.DONE),
    true,
  );
  assert.equal(
    settleOffered(standingTask(INVITES, TASK_STATUS.CANCELED), SETTLED_STATUS.CANCELED),
    false,
  );
});

test.each([
  { words: "  Fix the invite expiry  ", filed: { name: "Fix the invite expiry" } },
  {
    words: "Fix the invite expiry\n\nLinks expire after a day.",
    filed: {
      name: "Fix the invite expiry",
      brief: "Fix the invite expiry\n\nLinks expire after a day.",
    },
  },
  {
    words: "x".repeat(TASK_BOUNDS.MAX_NAME_CHARS + 5),
    filed: {
      name: "x".repeat(TASK_BOUNDS.MAX_NAME_CHARS),
      brief: "x".repeat(TASK_BOUNDS.MAX_NAME_CHARS + 5),
    },
  },
  { words: " \n ", filed: undefined },
])(
  "File for later names the task by its first line within the name's bound, the rest its brief",
  ({ words, filed }) => {
    assert.deepEqual(filedTaskOf(words), filed);
  },
);
