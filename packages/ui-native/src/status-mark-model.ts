// status-mark-model.ts -- the glyph a task's status and priority are drawn with, as the panel's task marks draw them; a status's tone is the panel's own (`@repo/features/task-standing-words`'s `TASK_STATUS_TONE`).

import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@repo/features/task-wire";
import { GLYPH, type Glyph } from "./glyph.js";
import { STATUS_TONE, type StatusTone } from "./tokens/colors.js";

/**
 * A ring that fills as work moves through it, as `@repo/ui`'s `task-marks.tsx`
 * draws it: dashed for later, empty to do, half filled under way, and a
 * filled disc once settled, a check for done and a cross for canceled.
 */
export const STATUS_MARK_SYMBOL = {
  [TASK_STATUS.BACKLOG]: GLYPH.STATUS_BACKLOG,
  [TASK_STATUS.TODO]: GLYPH.STATUS_TODO,
  [TASK_STATUS.IN_PROGRESS]: GLYPH.STATUS_IN_PROGRESS,
  [TASK_STATUS.DONE]: GLYPH.STATUS_DONE,
  [TASK_STATUS.CANCELED]: GLYPH.STATUS_CANCELED,
} as const satisfies Record<TaskStatus, Glyph>;

/**
 * Three bars, as many lit as the priority matters, an attention square for
 * urgent, and three dashes for a task no one weighed, as `@repo/ui`'s
 * `task-marks.tsx` draws them.
 */
export const PRIORITY_MARK_SYMBOL = {
  [TASK_PRIORITY.NONE]: GLYPH.PRIORITY_NONE,
  [TASK_PRIORITY.URGENT]: GLYPH.PRIORITY_URGENT,
  [TASK_PRIORITY.HIGH]: GLYPH.PRIORITY_HIGH,
  [TASK_PRIORITY.MEDIUM]: GLYPH.PRIORITY_MEDIUM,
  [TASK_PRIORITY.LOW]: GLYPH.PRIORITY_LOW,
} as const satisfies Record<TaskPriority, Glyph>;

/** A priority's ink, as `task-marks.css` draws it: urgent in the attention ink, every other in the muted one. */
export const PRIORITY_MARK_TONE = {
  [TASK_PRIORITY.NONE]: STATUS_TONE.NEUTRAL,
  [TASK_PRIORITY.URGENT]: STATUS_TONE.ATTENTION,
  [TASK_PRIORITY.HIGH]: STATUS_TONE.NEUTRAL,
  [TASK_PRIORITY.MEDIUM]: STATUS_TONE.NEUTRAL,
  [TASK_PRIORITY.LOW]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<TaskPriority, StatusTone>;
