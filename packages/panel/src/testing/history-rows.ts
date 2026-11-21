/**
 * history-rows.ts -- the task list's rows a test stands on: by id over a list, or as the window's collections fed from the Tasks tab a test stands.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { taskLinkStep } from "@repo/features/link-grammar";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, type TaskListParts } from "@repo/features/tasks-view";
import { taskListFollowing } from "@repo/host/task-list-following";
import { createElement, type ReactElement, type ReactNode, useLayoutEffect, useState } from "react";
import type { HistoryRows } from "../places/history-rows.js";
import { TaskListCollectionsProvider } from "../task-list-collections.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { TaskRows } from "../undo-stack.js";
import { listedAgentsOf, listedTasksOf } from "./tasks-control.js";

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

/** The rows a task's row write reads over `tasks` alone, as a list with no agent followed, no task open, and no plan held draws them. */
export function listedTaskRows(tasks: readonly TaskSummary[]): TaskRows {
  return {
    listed: (taskId) => tasks.find((task) => task.id === taskId),
    agents: () => undefined,
    agentPins: [],
    activeTaskId: undefined,
    held: undefined,
  };
}

/** The tasks, agents, and pull requests a test lists; none of the agents where it lists none. */
interface ListedTasks {
  readonly tasks: TaskListParts["tasks"];
  readonly taskAgents?: TaskListParts["taskAgents"] | undefined;
  readonly taskPullRequests?: TaskListParts["taskPullRequests"] | undefined;
  readonly agentPullRequests?: TaskListParts["agentPullRequests"] | undefined;
}

/** The window's task-list collections over what a test lists: `stand` writes its tasks, agents, and pull requests as the window's follow writes a document, and `provide` hands them to a tree. */
export interface StandingTaskList {
  readonly stand: (listed: ListedTasks) => void;
  readonly provide: (element: ReactNode) => ReactElement;
}

/** The window's task-list collections, standing on `initial`'s tasks and agents until `stand` writes others; none answered yet, as at launch, where `initial` is none. */
export function standingTaskList(initial: ListedTasks | undefined): StandingTaskList {
  const following = taskListFollowing();
  let version = 0;

  const stand = ({ tasks, taskAgents, taskPullRequests, agentPullRequests }: ListedTasks) => {
    version += 1;
    following.write(version, {
      ...IDLE_TASKS_VIEW,
      tasks,
      ...(taskAgents === undefined ? undefined : { taskAgents }),
      ...(taskPullRequests === undefined ? undefined : { taskPullRequests }),
      ...(agentPullRequests === undefined ? undefined : { agentPullRequests }),
    });
  };

  if (initial !== undefined) stand(initial);

  return {
    stand,
    provide: (element) =>
      createElement(TaskListCollectionsProvider, {
        collections: following.collections,
        children: element,
      }),
  };
}

/** `children` over the window's task collections standing on every task `tasks` holds, and the pull requests their lines name, written again as each draw hands another list, before the frame is painted. */
function StandingEvery({
  tasks,
  taskAgents,
  taskPullRequests,
  children,
}: {
  tasks: readonly TaskSummary[];
  taskAgents: ListedTasks["taskAgents"];
  taskPullRequests: ListedTasks["taskPullRequests"];
  children: ReactNode;
}): ReactElement {
  const [taskList] = useState(() => standingTaskList({ tasks, taskAgents, taskPullRequests }));

  useLayoutEffect(
    () => taskList.stand({ tasks, taskAgents, taskPullRequests }),
    [taskList, tasks, taskAgents, taskPullRequests],
  );

  return taskList.provide(children);
}

/** `element` over task collections holding every task and agent a test's tab lists (`listedTasks`, `listedAgents`), and the pull requests their lines name where given, as the window's root feeds them beside the tab it draws. */
export function overEveryTask(
  tasks: TasksControl,
  element: ReactNode,
  taskPullRequests?: ListedTasks["taskPullRequests"],
): ReactElement {
  return createElement(StandingEvery, {
    tasks: listedTasksOf(tasks),
    taskAgents: listedAgentsOf(tasks),
    taskPullRequests,
    children: element,
  });
}
