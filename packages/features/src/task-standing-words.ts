/**
 * task-standing-words.ts -- what a task's status, priority, assignee, and relations are called wherever they are named: a chip, a menu's row, a list's filter, and the iPhone's task page alike; and the tone a status's mark is drawn in.
 */

import {
  TASK_CREATE_RELATION_KIND,
  TASK_PRIORITY,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type TaskCreateRelationKind,
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

/** The tones a status's mark is drawn in, as `@repo/ui`'s and `@repo/ui-native`'s `STATUS_TONE` name them. */
const TASK_STATUS_TONE_KIND = {
  NEUTRAL: "neutral",
  WORKING: "working",
  COMPLETE: "complete",
} as const;

/** The tone each status's mark is drawn in, on the panel and the iPhone alike: at rest, under way, or finished well. Only its glyph is each platform's own. */
export const TASK_STATUS_TONE = {
  [TASK_STATUS.BACKLOG]: TASK_STATUS_TONE_KIND.NEUTRAL,
  [TASK_STATUS.TODO]: TASK_STATUS_TONE_KIND.NEUTRAL,
  [TASK_STATUS.IN_PROGRESS]: TASK_STATUS_TONE_KIND.WORKING,
  [TASK_STATUS.DONE]: TASK_STATUS_TONE_KIND.COMPLETE,
  [TASK_STATUS.CANCELED]: TASK_STATUS_TONE_KIND.NEUTRAL,
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

/** Each relation a new task may start in, named from the new task's side, as New task's rows and menus name it. */
export const TASK_CREATE_RELATION_WORDS = {
  [TASK_CREATE_RELATION_KIND.SUB_TASK_OF]: "Sub-task of",
  [TASK_CREATE_RELATION_KIND.PARENT_OF]: "Parent of",
  [TASK_CREATE_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_CREATE_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskCreateRelationKind, string>;
