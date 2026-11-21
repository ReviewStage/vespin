/**
 * sidebar-task.ts -- one sidebar task row drawn alone, as the sidebar draws it, under the task opening its Tasks tab says.
 */

import type { TaskSummary } from "@repo/features/task-wire";
import { createElement, type ReactElement } from "react";
import { type OpenMarks, SidebarOpenProvider } from "../desktop/sidebar-open.js";
import { SidebarTask } from "../desktop/task-actions.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/** What a row drawn alone is handed beside its task: whether it is the row marked, the plan open too, its clock, and its press. */
interface SidebarTaskDrawn {
  readonly current?: boolean;
  readonly now: number;
  readonly onOpen: () => void;
  readonly key?: string;
}

/** The row of `task` over `tasks`, marked and open where `current` says, read with nothing unread. */
export function sidebarTaskRow(
  tasks: TasksControl,
  task: TaskSummary,
  { current = false, now, onOpen, key }: SidebarTaskDrawn,
): ReactElement {
  const marks: OpenMarks = { current: () => current, marked: () => current, unread: () => false };

  return createElement(SidebarOpenProvider, {
    key,
    tasks,
    watched: undefined,
    children: createElement(SidebarTask, { tasks, task, marks, now, onOpen }),
  });
}
