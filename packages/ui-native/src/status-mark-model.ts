// status-mark-model.ts -- the SF Symbol and tone a task's status is drawn in, as the panel's task marks draw it.

import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import type { SfSymbol } from "./sf-symbol.js";
import { STATUS_TONE, type StatusTone } from "./tokens/colors.js";

type StatusMarkLook = { readonly symbol: SfSymbol; readonly tone: StatusTone };

/**
 * A ring that fills as work moves through it, as `@repo/ui`'s `task-marks.tsx`
 * draws it: dashed for later, empty to do, half filled under way, and a
 * filled disc once settled, a check for done and a cross for canceled.
 */
export const STATUS_MARK_LOOK = {
  [TASK_STATUS.BACKLOG]: { symbol: "circle.dashed", tone: STATUS_TONE.NEUTRAL },
  [TASK_STATUS.TODO]: { symbol: "circle", tone: STATUS_TONE.NEUTRAL },
  [TASK_STATUS.IN_PROGRESS]: { symbol: "circle.lefthalf.filled", tone: STATUS_TONE.WORKING },
  [TASK_STATUS.DONE]: { symbol: "checkmark.circle.fill", tone: STATUS_TONE.COMPLETE },
  [TASK_STATUS.CANCELED]: { symbol: "xmark.circle.fill", tone: STATUS_TONE.NEUTRAL },
} as const satisfies Record<TaskStatus, StatusMarkLook>;

/** The words a reader hears for a status, since the mark says nothing of its own. */
export const STATUS_MARK_LABEL = {
  [TASK_STATUS.BACKLOG]: "Backlog",
  [TASK_STATUS.TODO]: "Todo",
  [TASK_STATUS.IN_PROGRESS]: "In progress",
  [TASK_STATUS.DONE]: "Done",
  [TASK_STATUS.CANCELED]: "Canceled",
} as const satisfies Record<TaskStatus, string>;
