import assert from "node:assert/strict";
import { TASKS_PAGE } from "@repo/features/tasks-model";
import { type FileStripTab, fileTab } from "@repo/ui/tab-strip-model";
import { test } from "vitest";
import { liveStepTitle, NAMED_STEP, stepTitle } from "./history-titles.js";
import { ROUTED_PLACE } from "./places/routed-places.js";
import { MAIN_TAB, SIDE_PANEL_TAB } from "./tasks/task-tab-model.js";
import type { InboxChoice } from "./tasks/use-tasks-tab.js";
import { tasksControl, VIEWS_AWAY } from "./testing/tasks-control.js";

/**
 * history-titles.test.ts -- each step of the history is named as Back's menu
 * lists it: a task by its name with the tabs it showed, the Inbox with the
 * task its item is of, and every other page by what the window's title calls it.
 */

const TASK = {
  id: "task-1",
  workspaceId: "workspace-acme",
  name: "Auth refactor",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
};

/** The window on the task, its side panel open on the tab given or shut. */
function onTask(
  side: (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB] | FileStripTab | undefined,
) {
  const base = tasksControl();
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [TASK],
    activeTaskId: TASK.id,
    boundFor: TASK.id,
    sidePanel: {
      ...base.sidePanel,
      open: side !== undefined,
      tab: side ?? SIDE_PANEL_TAB.DESCRIPTION,
    },
  });
}

test("a task's step is named by the task, with the side panel's tab while it is open", () => {
  assert.deepEqual(stepTitle(undefined, onTask(SIDE_PANEL_TAB.COMMENTS), VIEWS_AWAY), {
    label: "Auth refactor",
    detail: "Comments",
    panes: { column: undefined, side: "Comments" },
  });
  assert.deepEqual(stepTitle(undefined, onTask(fileTab("apps/web/session-store.ts")), VIEWS_AWAY), {
    label: "Auth refactor",
    detail: "session-store.ts",
    panes: { column: undefined, side: "session-store.ts" },
  });
  assert.deepEqual(stepTitle(undefined, onTask(undefined), VIEWS_AWAY), {
    label: "Auth refactor",
    detail: undefined,
  });
});

test("a task on its way, its strips still another's, is named by the task alone", () => {
  const opening = { ...onTask(SIDE_PANEL_TAB.COMMENTS), activeTaskId: "task-before" };
  assert.deepEqual(stepTitle(undefined, opening, VIEWS_AWAY), { label: "Auth refactor" });
});

test("a task's step listed later on its Overview is named by the task and its panel's tab, Overview being the task itself", () => {
  const step = {
    kind: NAMED_STEP.TASK,
    taskId: TASK.id,
    column: MAIN_TAB.OVERVIEW,
    side: SIDE_PANEL_TAB.COMMENTS,
  } as const;
  assert.deepEqual(liveStepTitle(step, undefined, tasksControl({ tasks: [TASK] }), undefined), {
    label: "Auth refactor",
    detail: "Comments",
  });
});

test("the Inbox's step names the task its item is of, Settings and Home are named alone, and Admin's step as the place under it", () => {
  const chosen: InboxChoice = { itemId: "item-1", taskId: TASK.id };
  const base = tasksControl({ tasks: [TASK] });
  const inbox = { ...VIEWS_AWAY, inbox: { open: true, chosen, narrowed: undefined } };
  assert.deepEqual(stepTitle(ROUTED_PLACE.INBOX, base, inbox), {
    label: "Inbox",
    detail: "Auth refactor",
  });
  assert.deepEqual(stepTitle(ROUTED_PLACE.SETTINGS, base, VIEWS_AWAY), { label: "Settings" });
  assert.deepEqual(stepTitle(undefined, base, VIEWS_AWAY), { label: "Home" });
  assert.deepEqual(stepTitle(ROUTED_PLACE.ADMIN, base, VIEWS_AWAY), { label: "Home" });
});
