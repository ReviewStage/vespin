// status-mark-model.ts -- the SF Symbol a task's status is drawn with, as the panel's task marks draw it; its tone is the panel's own (`@repo/features/task-standing-words`'s `TASK_STATUS_TONE`).

import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import type { SfSymbol } from "./sf-symbol.js";

/**
 * A ring that fills as work moves through it, as `@repo/ui`'s `task-marks.tsx`
 * draws it: dashed for later, empty to do, half filled under way, and a
 * filled disc once settled, a check for done and a cross for canceled.
 */
export const STATUS_MARK_SYMBOL = {
  [TASK_STATUS.BACKLOG]: "circle.dashed",
  [TASK_STATUS.TODO]: "circle",
  [TASK_STATUS.IN_PROGRESS]: "circle.righthalf.filled",
  [TASK_STATUS.DONE]: "checkmark.circle.fill",
  [TASK_STATUS.CANCELED]: "xmark.circle.fill",
} as const satisfies Record<TaskStatus, SfSymbol>;
