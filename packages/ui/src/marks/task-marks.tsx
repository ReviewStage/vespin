import {
  TASK_MARK_ELEMENT,
  TASK_MARK_LAYER,
  TASK_MARK_ROLE,
  TASK_PRIORITY_MARK,
  TASK_STATUS_MARK,
} from "@repo/brand/task-status-marks";
import { TASK_STATUS_TONE } from "@repo/features/task-standing-words";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@repo/features/task-wire";
import React from "react";
import type { StatusTone } from "../status-tone.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * task-marks.tsx -- the marks a task's status and priority wear wherever a task is drawn: a page's chip, a menu's row, a list's line.
 *
 * A status is a ring that fills as work moves through it: dashed while it
 * is filed for later, an empty ring to do, half filled under way, and a
 * filled disc once settled, with a check for done and a cross for
 * canceled. A priority is three bars, as many lit as it matters, an
 * attention square for urgent, and three dashes for one no one weighed.
 * Both are drawn from `@repo/brand`'s one table, which the iOS app's
 * symbols are cut from too.
 * A status draws in its status tone's ink, under way in the working blue
 * and done in the green every other done wears, and a priority in its own
 * (`task-marks.css`), each at the glyph cell of
 * whatever leads with it, which sizes it, and says nothing of its own: the
 * words beside it, or the caller's label, are what a reader hears.
 */

/** Each status's mark, from `@repo/brand`'s table. */
const STATUS_MARK = {
  [TASK_STATUS.BACKLOG]: TASK_STATUS_MARK.BACKLOG,
  [TASK_STATUS.TODO]: TASK_STATUS_MARK.TODO,
  [TASK_STATUS.IN_PROGRESS]: TASK_STATUS_MARK.IN_PROGRESS,
  [TASK_STATUS.DONE]: TASK_STATUS_MARK.DONE,
  [TASK_STATUS.CANCELED]: TASK_STATUS_MARK.CANCELED,
} as const satisfies Record<TaskStatus, (typeof TASK_STATUS_MARK)[keyof typeof TASK_STATUS_MARK]>;

type StatusPart = (typeof STATUS_MARK)[TaskStatus][number];

/** The class each part's role is drawn with: a line stroked, a fill, or a cut stroked in the ground's ink. */
const PART_CLASS = {
  [TASK_MARK_ROLE.LINE]: "ui-task-mark-line",
  [TASK_MARK_ROLE.FILL]: "ui-task-mark-fill",
  [TASK_MARK_ROLE.CUT]: "ui-task-mark-cut",
} as const;

/** One part of a status's mark, as the element its table names. */
function statusPart(part: StatusPart, index: number): React.JSX.Element {
  const className = PART_CLASS[part.role];

  if (part.element === TASK_MARK_ELEMENT.PATH)
    return <path key={index} className={className} d={part.d} />;

  return (
    <circle
      key={index}
      className={className}
      cx={part.cx}
      cy={part.cy}
      r={part.r}
      strokeDasharray={"dash" in part ? part.dash.join(" ") : undefined}
    />
  );
}

/** A task's status as its mark, in the tone of the status it stands for. */
export function TaskStatusMark({ status }: { status: TaskStatus }): React.JSX.Element {
  const tone: StatusTone = TASK_STATUS_TONE[status];

  return (
    <svg
      className="ui-task-mark ui-task-status-mark"
      data-status={status}
      data-tone={tone}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {STATUS_MARK[status].map(statusPart)}
    </svg>
  );
}

/** Each priority's mark, from `@repo/brand`'s table. */
const PRIORITY_MARK = {
  [TASK_PRIORITY.NONE]: TASK_PRIORITY_MARK.NONE,
  [TASK_PRIORITY.URGENT]: TASK_PRIORITY_MARK.URGENT,
  [TASK_PRIORITY.HIGH]: TASK_PRIORITY_MARK.HIGH,
  [TASK_PRIORITY.MEDIUM]: TASK_PRIORITY_MARK.MEDIUM,
  [TASK_PRIORITY.LOW]: TASK_PRIORITY_MARK.LOW,
} as const satisfies Record<
  TaskPriority,
  (typeof TASK_PRIORITY_MARK)[keyof typeof TASK_PRIORITY_MARK]
>;

type PriorityPart = (typeof PRIORITY_MARK)[TaskPriority][number];

/** One part of a priority's mark: a bar, lit or not where it stands on a layer, urgent's square, or the "!" cut from it. */
function priorityPart(part: PriorityPart, index: number): React.JSX.Element {
  const className = PART_CLASS[part.role];

  if (part.element === TASK_MARK_ELEMENT.PATH)
    return <path key={index} className={className} d={part.d} />;

  return (
    <rect
      key={index}
      className={className}
      data-lit={"layer" in part ? part.layer === TASK_MARK_LAYER.LIT : undefined}
      x={part.x}
      y={part.y}
      width={part.width}
      height={part.height}
      rx={part.rx}
    />
  );
}

/** A task's priority as its mark: bars as many as it matters, urgent's square, or dashes where no one weighed it. */
export function TaskPriorityMark({ priority }: { priority: TaskPriority }): React.JSX.Element {
  return (
    <svg
      className="ui-task-mark ui-task-priority-mark"
      data-priority={priority}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {PRIORITY_MARK[priority].map(priorityPart)}
    </svg>
  );
}
