/**
 * history-rows.ts -- the task list's rows a test of the window's history stands on: by id over a list, or as the window's collections fed from the Tasks tab a test stands.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { taskLinkStep } from "@repo/features/link-grammar";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, type TasksView } from "@repo/features/tasks-view";
import { createElement, type ReactElement, type ReactNode } from "react";
import type { HistoryRows } from "../places/history-rows.js";
import { TaskListCollectionsProvider, taskListFollowing } from "../task-list-collections.js";

/** The rows of `tasks` and `agents` by id, each task among them the only ones ever listed: for a name read once, where no task is deleted between reads. */
export function listedRows(
  tasks: readonly TaskSummary[],
  agents: readonly ListedAgent[] = [],
): HistoryRows {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    task: (taskId) => byId.get(taskId),
    agent: (agentId) => agentsById.get(agentId),
    everListed: (taskId) => byId.has(taskId),
    everStepped: (workspaceId, step) =>
      tasks.find((task) => task.workspaceId === workspaceId && taskLinkStep(task) === step)?.id,
  };
}

/** The tasks and agents a test lists; none of the agents where it lists none. */
interface ListedTasks {
  readonly tasks: TasksView["tasks"];
  readonly taskAgents?: TasksView["taskAgents"] | undefined;
}

/** The window's task-list collections over what a test lists: `stand` writes its tasks and agents as the window's follow writes a document, and `provide` hands them to a tree. */
export interface StandingTaskList {
  readonly stand: (listed: ListedTasks) => void;
  readonly provide: (element: ReactNode) => ReactElement;
}

/** The window's task-list collections, standing on `initial`'s tasks and agents until `stand` writes others. */
export function standingTaskList(initial: ListedTasks): StandingTaskList {
  const following = taskListFollowing();
  let version = 0;

  const stand = ({ tasks, taskAgents }: ListedTasks) => {
    version += 1;
    following.write(
      version,
      taskAgents === undefined
        ? { ...IDLE_TASKS_VIEW, tasks }
        : { ...IDLE_TASKS_VIEW, tasks, taskAgents },
    );
  };

  stand(initial);

  return {
    stand,
    provide: (element) =>
      createElement(TaskListCollectionsProvider, {
        collections: following.collections,
        children: element,
      }),
  };
}
