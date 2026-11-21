import {
  AGENT_STATUS,
  type AgentPullRequest,
  type ListedAgent,
  PULL_REQUEST_STATE,
} from "./agent-wire.js";
import type { PersonAgent } from "./person-page-model.js";
import { agentLastMovedAt } from "./task-agents-model.js";
import { TASK_ORDER, taskTime } from "./task-list-model.js";
import {
  type ListedPullRequest,
  TASK_STATUS,
  type TaskStatus,
  type TaskSummary,
} from "./task-wire.js";

/**
 * manager-overview-model.ts -- what a Manager's page lists beside its chat: the agents it started and their pull requests, the tasks it made, and how many of each stand where.
 *
 * Everything is read from what the window already follows live: the
 * workspace's tasks, the agents the list carries, and the pull request each
 * of those agents' rows names. An agent is the Manager's by its
 * `startedByAgentId`, an archived one left out, as a task leaves it out of
 * its agents; a task is the Manager's where the Manager made it (its
 * `origin`) or one of its agents works on it. Its open tasks are those not
 * finished, and its done ones those finished in the last week, a canceled
 * one in neither. Each list is the newest first, its agents at work and its
 * open pull requests ahead of the rest, so what moves now leads.
 */

/** How far back a task finished still counts as done this week. */
const WEEK_MILLIS = 7 * 24 * 60 * 60 * 1000;

/** The statuses of an agent at work: starting, or running. */
const AT_WORK: ReadonlySet<ListedAgent["status"]> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** The states of a pull request still open, a draft among them. */
const OPEN_PULL_REQUEST: ReadonlySet<AgentPullRequest["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** The statuses of a task not finished. */
const OPEN_TASK: ReadonlySet<TaskStatus> = new Set([
  TASK_STATUS.BACKLOG,
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
]);

/** A pull request one of the Manager's agents opened, with the agent and its task. */
export interface ManagerPullRequest {
  readonly pullRequest: AgentPullRequest;
  readonly agent: ListedAgent;
  readonly task: TaskSummary;
}

/** What a Manager's overview lists. */
export interface ManagerOverview {
  /** The agents it started on listed tasks, those at work first, each part newest first. */
  readonly agents: readonly PersonAgent[];
  /** The pull requests its agents opened, the open ones first, each part as its agents stand. */
  readonly pullRequests: readonly ManagerPullRequest[];
  /** Its tasks not finished, the latest moved first. */
  readonly openTasks: readonly TaskSummary[];
  /** Its tasks done in the last week, the latest moved first. */
  readonly doneThisWeek: readonly TaskSummary[];
}

/** A task's status, Todo for one from a service before statuses. */
function statusOf(task: TaskSummary): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

/** When a task finished, as it says it; when it last moved where it says none. */
function finishedAt(task: TaskSummary): number {
  return task.completedAt ?? task.updatedAt;
}

/** A Manager's overview, from the listed workspace's tasks, the agents the list follows live, and their pull requests, at `now`. */
export function managerOverview({
  managerId,
  tasks,
  agents,
  pullRequests,
  now,
}: {
  managerId: string;
  tasks: readonly TaskSummary[];
  agents: readonly ListedAgent[] | undefined;
  pullRequests: readonly ListedPullRequest[] | undefined;
  now: number;
}): ManagerOverview {
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const started = (agents ?? []).flatMap((agent): PersonAgent[] => {
    const task = agent.taskId === null ? undefined : byId.get(agent.taskId);

    if (task === undefined || agent.archivedAt !== undefined) return [];

    if (agent.startedByAgentId !== managerId) return [];

    return [{ task, agent, at: agentLastMovedAt(agent) }];
  });

  const newest = (a: PersonAgent, b: PersonAgent) => b.at - a.at;
  const atWork = started.filter(({ agent }) => AT_WORK.has(agent.status)).toSorted(newest);
  const resting = started.filter(({ agent }) => !AT_WORK.has(agent.status)).toSorted(newest);
  const ordered = [...atWork, ...resting];

  // Note that each agent's row names one pull request, so the list holds each agent's once.
  const byAgent = new Map((pullRequests ?? []).map((each) => [each.agentId, each.pullRequest]));

  const opened = ordered.flatMap(({ agent, task }): ManagerPullRequest[] => {
    const pullRequest = byAgent.get(agent.id);

    return pullRequest === undefined ? [] : [{ pullRequest, agent, task }];
  });

  const open = opened.filter(({ pullRequest }) => OPEN_PULL_REQUEST.has(pullRequest.state));
  const workedOn = new Set(started.map(({ task }) => task.id));

  const theirs = tasks
    .filter((task) => task.origin?.agentId === managerId || workedOn.has(task.id))
    .toSorted((a, b) => taskTime(b, TASK_ORDER.UPDATED) - taskTime(a, TASK_ORDER.UPDATED));

  return {
    agents: ordered,
    pullRequests: [
      ...open,
      ...opened.filter(({ pullRequest }) => !OPEN_PULL_REQUEST.has(pullRequest.state)),
    ],
    openTasks: theirs.filter((task) => OPEN_TASK.has(statusOf(task))),
    doneThisWeek: theirs.filter(
      (task) => task.status === TASK_STATUS.DONE && now - finishedAt(task) <= WEEK_MILLIS,
    ),
  };
}
