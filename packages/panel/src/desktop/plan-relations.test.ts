// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskBlockRelation,
  type TaskRelationChangeRequest,
  type TaskSummary,
} from "@repo/features/task-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeActPortCalls, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handMembers } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { PlanHead } from "./plan-head.js";

/**
 * plan-relations.test.ts -- the open task's Sub-tasks and Task relations groups:
 * a sub-task's own nested under it once its fold opens, a group drawn only
 * while it holds a row, a relation's kind moved from its pill in one
 * call, never a block taken away and added again, and Remove relation
 * taking the block away through the door that offers Undo; and New
 * sub-task's + on a folded group opening it on a draft whose Return adds a
 * sub-task of the open task. Synthetic tasks.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACME = {
  id: DOCUMENT_TASK.workspaceId,
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  fakeActPort({});
  handMembers(() => ({ rows: { members: [] } }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A task of the workspace, `id`, standing under `parentTaskId` where one is named. */
function summary(id: string, number: number, parentTaskId?: string): TaskSummary {
  return {
    id,
    workspaceId: ACME.id,
    name: `Task ${number}`,
    repository: null,
    createdAt: number,
    updatedAt: number,
    status: TASK_STATUS.TODO,
    priority: TASK_PRIORITY.NONE,
    number,
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
  };
}

/** Draws the head's groups for the open task, its blocks as given, over `listed`, its sends kept in `sent`. */
function draw(
  listed: readonly TaskSummary[],
  blocks: { blockedBy?: string[]; blocks?: string[] },
  sent: {
    changes: TaskRelationChangeRequest[];
    removed: [TaskBlockRelation, string][];
    started?: unknown[];
  },
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_CHANGE_RELATION]: ({ relation }) => {
      sent.changes.push(relation);
      return Promise.resolve({ blockedBy: [], blocks: [], parentTaskId: null });
    },
    [ACT_KIND.TASKS_BLOCK]: ({ block }) => {
      sent.removed.push([block.relation, block.taskId]);
      return Promise.resolve({ blockedBy: [], blocks: [] });
    },
    [ACT_KIND.TASKS_START]: (start) => {
      sent.started?.push(start);
      return Promise.resolve({ planId: "t-9" });
    },
  });
  const tasks = tasksControl({
    tasks: [...listed],
    workspace: ACME,
    workspaces: [ACME],
    listRead: true,
  });
  const task = { ...DOCUMENT_TASK, ...blocks };
  act(() =>
    root?.render(
      withQueryClient(
        createElement(PlanHead, {
          task,
          tasks,
          door: { workspaceName: ACME.name, tasks: listed },
          room: { scroller: { current: container }, column: { current: container } },
          agents: null,
          pages: null,
          onOpenTask: tasks.onSelect,
        }),
      ),
    ),
  );
  return container;
}

/** The ids of the rows a group's list draws, in order. */
function rowIds(container: HTMLElement, list: string): (string | null)[] {
  return [...container.querySelectorAll(`ul[aria-label='${list}'] > li[data-task-id]`)].map((row) =>
    row.getAttribute("data-task-id"),
  );
}

test("a sub-task's own stand under it once its fold opens, and a task with no relations draws no Task relations group", () => {
  const sent = { changes: [], removed: [] };
  const container = draw(
    [summary("t-2", 2, DOCUMENT_TASK.id), summary("t-3", 3, "t-2"), summary("t-4", 4)],
    {},
    sent,
  );

  assert.deepEqual(rowIds(container, "Sub-tasks"), ["t-2"]);
  assert.equal(container.querySelector("ul[aria-label='Task relations']"), null);

  act(() =>
    container.querySelector<HTMLButtonElement>("button[aria-label='Sub-tasks of Task 2']")?.click(),
  );
  assert.deepEqual(rowIds(container, "Sub-tasks"), ["t-2", "t-3"]);
});

test("New sub-task's + on a folded group opens it on a draft, whose Return adds a sub-task of the open task and opens the next", async () => {
  const sent = { changes: [], removed: [], started: [] as unknown[] };
  const container = draw([summary("t-2", 2, DOCUMENT_TASK.id)], {}, sent);
  const draft = () => container.querySelector<HTMLInputElement>("[data-quick-add] input");
  act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded='true']")?.click());
  assert.deepEqual(rowIds(container, "Sub-tasks"), [], "the group folds its rows");

  act(() =>
    container.querySelector<HTMLButtonElement>("button[aria-label='New sub-task']")?.click(),
  );
  assert.deepEqual(rowIds(container, "Sub-tasks"), ["t-2"], "the group opens");
  const field = draft() ?? assert.fail("the draft stands at the end of the sub-tasks");
  field.value = "Check the invite email copy";
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);

  assert.deepEqual(sent.started, [
    {
      name: "Check the invite email copy",
      parentTaskId: DOCUMENT_TASK.id,
      workspaceId: ACME.id,
      planning: false,
      quiet: true,
    },
  ]);
  assert.equal(draft()?.value, "", "the next draft stands, empty");
});

test("a relation stands while the list does not hold its task, and picking another kind on its pill moves it in one call, and Remove relation takes the block away", async () => {
  const sent: { changes: TaskRelationChangeRequest[]; removed: [TaskBlockRelation, string][] } = {
    changes: [],
    removed: [],
  };
  const container = draw([summary("t-5", 5)], { blockedBy: ["t-5"], blocks: ["t-9"] }, sent);
  assert.equal(container.querySelector("ul[aria-label='Sub-tasks']"), null);
  // Note that a task the list does not hold yet still stands, so a list still read hides no relation.
  assert.deepEqual(rowIds(container, "Task relations"), ["t-5", "t-9"]);
  const unlisted = container.querySelector("li[data-task-id='t-9']");
  assert.equal(
    unlisted?.querySelector("[data-cell='status'] button"),
    null,
    "a task not listed yet offers no status to change",
  );
  const pill = () =>
    container.querySelector<HTMLButtonElement>("button[aria-label='Relation: Blocked by']");

  act(() => pill()?.click());
  const blocks = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
    (option) => option.textContent?.includes("Blocks") && !option.textContent.includes("Blocked"),
  );
  assert.ok(blocks, "the menu offers Blocks");
  await act(async () => blocks.click());
  assert.deepEqual(sent.changes, [{ taskId: "t-5", from: "blocked-by", to: "blocks" }]);
  assert.deepEqual(sent.removed, []);

  act(() => pill()?.click());
  const remove = [...document.querySelectorAll<HTMLElement>("button, [role='option']")].find(
    (each) => each.textContent?.trim() === "Remove relation",
  );
  assert.ok(remove, "the menu offers Remove relation");
  await act(async () => remove.click());
  assert.deepEqual(sent.removed, [["blocked-by", "t-5"]]);
});
