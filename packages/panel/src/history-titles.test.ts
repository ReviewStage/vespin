import assert from "node:assert/strict";
import { TASKS_PAGE } from "@repo/features/tasks-model";
import { type FileStripTab, fileTab } from "@repo/ui/tab-strip-model";
import { test } from "vitest";
import { liveStepTitle, NAMED_STEP, stepTitle } from "./history-titles.js";
import type { RoutedPlace } from "./places/routed-places.js";
import { ROUTED_PLACE } from "./places/routed-places.js";
import { MAIN_TAB, SIDE_PANEL_TAB } from "./tasks/task-tab-model.js";
import type { InboxChoice, TasksControl } from "./tasks/use-tasks-tab.js";
import { listedRows } from "./testing/history-rows.js";
import { tasksControl, VIEWS_AWAY } from "./testing/tasks-control.js";
import type { RoutedViews } from "./workspace-routes.js";

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

/** What the step standing is called, its tasks read by id from those the tab lists. */
function titleOf(place: RoutedPlace | undefined, tasks: TasksControl, views: RoutedViews) {
  return stepTitle(place, tasks, listedRows(tasks.tasks), views);
}

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
  assert.deepEqual(titleOf(undefined, onTask(SIDE_PANEL_TAB.COMMENTS), VIEWS_AWAY), {
    label: "Auth refactor",
    detail: "Comments",
    panes: { column: undefined, side: "Comments" },
  });
  assert.deepEqual(titleOf(undefined, onTask(fileTab("apps/web/session-store.ts")), VIEWS_AWAY), {
    label: "Auth refactor",
    detail: "session-store.ts",
    panes: { column: undefined, side: "session-store.ts" },
  });
  assert.deepEqual(titleOf(undefined, onTask(undefined), VIEWS_AWAY), {
    label: "Auth refactor",
    detail: undefined,
  });
});

test("a task on its way, its strips still another's, is named by the task alone", () => {
  const opening = { ...onTask(SIDE_PANEL_TAB.COMMENTS), activeTaskId: "task-before" };
  assert.deepEqual(titleOf(undefined, opening, VIEWS_AWAY), { label: "Auth refactor" });
});

test("a task's step listed later on its Overview is named by the task and its panel's tab, Overview being the task itself", () => {
  const step = {
    kind: NAMED_STEP.TASK,
    taskId: TASK.id,
    column: MAIN_TAB.OVERVIEW,
    side: SIDE_PANEL_TAB.COMMENTS,
  } as const;

  assert.deepEqual(
    liveStepTitle(step, undefined, { ...tasksControl(), rows: listedRows([TASK]) }, undefined),
    {
      label: "Auth refactor",
      detail: "Comments",
    },
  );
});

test("the Inbox's step names the task its item is of, Settings and Home are named alone, and Admin's step as the place under it", () => {
  const chosen: InboxChoice = { itemId: "item-1", taskId: TASK.id };
  const base = tasksControl({ tasks: [TASK] });
  const inbox = { ...VIEWS_AWAY, inbox: { open: true, chosen, narrowed: undefined } };
  assert.deepEqual(titleOf(ROUTED_PLACE.INBOX, base, inbox), {
    label: "Inbox",
    detail: "Auth refactor",
  });
  assert.deepEqual(titleOf(ROUTED_PLACE.SETTINGS, base, VIEWS_AWAY), { label: "Settings" });
  assert.deepEqual(titleOf(undefined, base, VIEWS_AWAY), { label: "Home" });
  assert.deepEqual(titleOf(ROUTED_PLACE.ADMIN, base, VIEWS_AWAY), { label: "Home" });
});
