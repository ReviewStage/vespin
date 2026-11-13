// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { PullRequestLine, taskCardOf } from "./task-card.js";

/**
 * task-card.test.ts -- a task's hover card says where the task stands by
 * its board card's marks, its status, its priority, and who is on it, each
 * heard by a screen reader, and a pull request's line counts its size.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const TASK: TaskSummary = {
  id: "t-42",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  repository: "acme/app",
  createdAt: 1,
  updatedAt: 2,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
};

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The card of `task`, read under Acme among `others`, which a press on a task it names opens through `opened`. */
function drawn(
  task: TaskSummary,
  others: readonly TaskSummary[] = [],
  opened: (taskId: string) => void = () => undefined,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  const tasks = tasksControl({
    workspace: ACME,
    workspaces: [ACME],
    tasks: [task, ...others],
    onSelect: opened,
  });

  act(() => root.render(withQueryClient(taskCardOf(tasks, task, 10))));
  const card = container.querySelector<HTMLElement>("[data-task-card]");
  assert.ok(card, "the card is drawn");

  return card;
}

test("a task's card says where it stands by marks a reader hears, as the board's card draws them, and none is a picker", () => {
  const heard = (task: TaskSummary) =>
    [...drawn(task).querySelectorAll(".ui-hover-card-head .task-card-mark")].map((each) =>
      each.getAttribute("aria-label"),
    );

  assert.deepEqual(heard({ ...TASK, assignee: { userId: "user-charles", name: "Charles Pan" } }), [
    "Status: In progress",
    "Priority: High",
    "Assignee: Charles Pan",
  ]);
  assert.equal(heard(TASK).at(-1), "Assignee: No assignee");
  assert.equal(document.querySelector("[data-task-card] button[aria-haspopup]"), null);
});

test("a task's card names its parent, its sub-tasks with those finished counted, what it is blocked by and blocks, each under its header, and each task named opens", () => {
  const parent: TaskSummary = { ...TASK, id: "t-1", name: "Ship invitations", number: 1 };
  const blocker: TaskSummary = { ...TASK, id: "t-2", name: "Pick a mail provider", number: 2 };
  const waiter: TaskSummary = { ...TASK, id: "t-3", name: "Announce invitations", number: 3 };

  const child = {
    ...TASK,
    parentTaskId: parent.id,
    blocked: true,
    blockedBy: [blocker.id],
    blocks: [waiter.id],
  } as const;

  const done: TaskSummary = {
    ...TASK,
    id: "t-43",
    name: "Write the email",
    number: 43,
    status: TASK_STATUS.DONE,
    parentTaskId: child.id,
  };

  const open: TaskSummary = {
    ...TASK,
    id: "t-44",
    name: "Send the email",
    number: 44,
    createdAt: 3,
    parentTaskId: child.id,
  };

  const opened: string[] = [];

  const card = drawn(child, [parent, blocker, waiter, done, open], (taskId) => opened.push(taskId));

  const group = (header: string) =>
    [...card.querySelectorAll(`ul[aria-label='${header}'] li`)].map((each) => each.textContent);

  assert.deepEqual(group("Parent"), ["Ship invitationsACME-1"]);
  assert.deepEqual(group("Sub-tasks"), ["Write the emailACME-43", "Send the emailACME-44"]);
  assert.deepEqual(group("Blocked by"), ["Pick a mail providerACME-2"]);
  assert.deepEqual(group("Blocks"), ["Announce invitationsACME-3"]);
  assert.match(card.textContent ?? "", /Sub-tasks1\/2/u);
  assert.equal(card.querySelector("[data-task-card-blocked]"), null, "its blockers say it");

  for (const header of ["Sub-tasks", "Parent", "Blocked by", "Blocks"]) {
    act(() => card.querySelector<HTMLButtonElement>(`ul[aria-label='${header}'] button`)?.click());
  }

  assert.deepEqual(opened, ["t-43", "t-1", "t-2", "t-3"]);
  assert.equal(
    drawn({ ...TASK, blocked: true }).querySelector("[data-task-card-blocked]")?.textContent,
    "Blocked",
    "a service before blocks names no blocker",
  );
  assert.equal(drawn(TASK).querySelector("ul[aria-label], [data-task-card-blocked]"), null);
});

test("a pull request's line on the card counts its size as every figure is counted, green then red", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(PullRequestLine, {
          pullRequest: {
            number: 7,
            title: "Add invitations",
            state: PULL_REQUEST_STATE.OPEN,
            checks: CHECK_SUMMARY.PASSING,
            additions: 1234,
            deletions: 56,
          },
        }),
      ),
    ),
  );
  assert.deepEqual(
    [...container.querySelectorAll(".ui-count-part")].map((each) => [
      each.textContent,
      each.getAttribute("data-tone"),
    ]),
    [
      ["+1,234", "complete"],
      ["−56", "danger"],
    ],
  );
});
