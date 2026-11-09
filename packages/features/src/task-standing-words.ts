/**
 * task-standing-words.ts -- what a task's status, priority, assignee, and relations are called wherever they are named: a chip, a menu's row, a list's filter, and the iPhone's task page alike.
 */

import {
  TASK_PRIORITY,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type TaskPriority,
  type TaskRelationKind,
  type TaskStatus,
} from "./task-wire.js";

/** Each status as its chip, its menu's row, the Board's column, and the sidebar's filter say it. */
export const TASK_STATUS_WORDS = {
  [TASK_STATUS.BACKLOG]: "Backlog",
  [TASK_STATUS.TODO]: "Todo",
  [TASK_STATUS.IN_PROGRESS]: "In progress",
  [TASK_STATUS.DONE]: "Done",
  [TASK_STATUS.CANCELED]: "Canceled",
} as const satisfies Record<TaskStatus, string>;

/** Each priority as its chip, its menu's row, and a Board card's say it. */
export const TASK_PRIORITY_WORDS = {
  [TASK_PRIORITY.NONE]: "No priority",
  [TASK_PRIORITY.URGENT]: "Urgent",
  [TASK_PRIORITY.HIGH]: "High",
  [TASK_PRIORITY.MEDIUM]: "Medium",
  [TASK_PRIORITY.LOW]: "Low",
} as const satisfies Record<TaskPriority, string>;

/** What the assignee's chip and its first row say of a task no one is assigned to, as its hover card does, and what the Tasks page calls the tasks with none. */
export const NO_ASSIGNEE_WORDS = "No assignee";

/** Each kind as the menu's kind row, its submenu, the task's menus, and a related row's pill name it. */
export const TASK_RELATION_WORDS = {
  [TASK_RELATION_KIND.SUB_TASK]: "Sub-task",
  [TASK_RELATION_KIND.PARENT]: "Parent",
  [TASK_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskRelationKind, string>;
