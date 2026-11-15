import type { ListedAgent } from "@repo/features/agent-wire";
import { agentsOfTask } from "@repo/features/task-agents-model";
import type { TaskPullRequestLine, TaskPullRequests } from "@repo/features/task-wire";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";

/**
 * use-task-work.ts -- every agent a task holds and every pull request they opened, as every reader of a task's agents and pull requests reads them.
 *
 * A task's row counts its agents (`TaskAgentsSummary`); the agents and pull
 * requests themselves are what the window holds beside the list while it is
 * followed live: every agent on a task (`taskAgents`) and every pull request
 * of each (`taskPullRequests`), read in the order a task names them
 * (`task-agents-model.ts`), each read from the task list's collections by
 * the task it names, so a delivery that moves another task's rows draws
 * none of them again. Before the list is followed live the window holds no
 * task's agents, and every task reads none.
 */

/** A task's agents and pull requests, every one the window holds. */
interface TaskWork {
  readonly agents: readonly ListedAgent[];
  readonly pullRequests: readonly TaskPullRequestLine[];
}

/** No pull requests, before the list carries the task's. */
const NO_PULL_REQUESTS: readonly TaskPullRequestLine[] = [];

/** Every agent a task holds, those at work first, and every pull request they opened. */
export function useTaskWork(taskId: string): TaskWork {
  const { agents } = useTaskListCollections();
  const pullRequests = useTaskPullRequests(taskId);

  const { data: onTask } = useLiveQuery((q) =>
    q.from({ agent: agents }).where(({ agent }) => eq(agent.taskId, taskId)),
  );

  return useMemo(
    () => ({ agents: agentsOfTask(onTask, taskId), pullRequests }),
    [onTask, taskId, pullRequests],
  );
}

/** Every pull request a task's agents opened, those still open first. */
export function useTaskPullRequests(taskId: string): readonly TaskPullRequestLine[] {
  const { taskPullRequests } = useTaskListCollections();

  return useTaskListRow(taskPullRequests, taskId)?.pullRequests ?? NO_PULL_REQUESTS;
}

/** One agent on a task as the list followed live holds it, as the task's agents name it; none where it holds no such agent, or holds it archived. */
export function useTaskAgent(agentId: string): ListedAgent | undefined {
  const agent = useTaskListRow(useTaskListCollections().agents, agentId);

  return agent?.archivedAt === undefined ? agent : undefined;
}

/** Every pull request of every task, by task, for a list that reads many tasks' (`pullRequestsOfTask`); none before the list carries any. */
export function useListedTaskPullRequests(): readonly TaskPullRequests[] {
  const { taskPullRequests } = useTaskListCollections();

  return useLiveQuery((q) => q.from({ listed: taskPullRequests })).data;
}
