/**
 * task-list-moved.ts -- what one drawing of the task list moved among its tasks and its agents, told by the list's live queries (`list-moves.ts`) rather than a walk of every row, for a reader outside the windows that follows the list as the host draws it.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { type ListMove, movesBetween } from "./list-moves.js";

/** The task list's tasks and agents as one drawing of it holds them. */
export interface TaskListDrawn {
  readonly tasks: readonly TaskSummary[];
  /** Every agent on a task, the archived among them. */
  readonly taskAgents: readonly ListedAgent[];
}

/**
 * One drawing of the task list as a reader following it takes it: the
 * tasks and agents that came, moved, or went since the drawing before, each
 * as it stood and as it stands; or the drawing whole, where it starts the
 * list anew, the first a reader hears or one no drawing before it can be
 * told the moves since.
 */
export type TaskListMoved =
  | { readonly whole: true; readonly drawn: TaskListDrawn }
  | {
      readonly whole: false;
      readonly tasks: readonly ListMove<TaskSummary>[];
      readonly agents: readonly ListMove<ListedAgent>[];
    };

/** The drawing `after`, told the moves since `before`; whole where there is no drawing before it or the moves since it cannot be told. */
export function taskListMoved(
  before: TaskListDrawn | undefined,
  after: TaskListDrawn,
): TaskListMoved {
  const tasks = before && movesBetween(before.tasks, after.tasks);
  const agents = before && movesBetween(before.taskAgents, after.taskAgents);

  if (tasks === undefined || agents === undefined) return { whole: true, drawn: after };

  return { whole: false, tasks: tasks.moves, agents: agents.moves };
}
