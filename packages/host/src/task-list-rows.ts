/**
 * task-list-rows.ts -- the rows the task list's live queries stand on: a plan's and an agent's as the list's statement answers them, and an agent past its starting grace.
 *
 * Their own module, below the collections that hold them and the queries
 * that read them (`task-list-tasks.ts`, `task-list-pull-requests.ts`,
 * `task-list-continuations.ts`), so a query names a row without importing
 * the collections that compose it.
 */

import type { TaskListLiveRows } from "@repo/features/task-list-live";

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["tasks"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** An agent whose starting grace has ended, by its id, with its plan's, as the list holds it beside the agents' rows. */
export interface PastGrace {
  readonly agentId: string;
  readonly taskId: string;
}
