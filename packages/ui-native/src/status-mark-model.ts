// status-mark-model.ts -- the glyph a task's status is drawn with, as the panel's task marks draw it; its tone is the panel's own (`@repo/features/task-standing-words`'s `TASK_STATUS_TONE`).

import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { GLYPH, type Glyph } from "./glyph.js";

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
