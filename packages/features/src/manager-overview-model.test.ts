import { expect, test } from "vitest";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  CHECK_SUMMARY,
  type ListedAgent,
  PULL_REQUEST_STATE,
} from "./agent-wire.js";
import { managerOverview } from "./manager-overview-model.js";
import { DESCRIPTION_ACTOR, TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";

/**
 * A Manager's overview lists what it started and nothing else: its agents,
 * not another Manager's nor an archived one, their pull requests, the open
 * ones first, the tasks it made or its agents work on, and of those the
 * ones done in the last week. Synthetic accounts.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 30 * DAY;
const MANAGER = "00000000-0000-4000-8000-00000000aaaa";
const OTHER_MANAGER = "00000000-0000-4000-8000-00000000bbbb";
const ADA = { userId: "user-ada", name: "Ada Lovelace" };

function task(n: number, status: TaskStatus, updatedAt: number, madeBy?: string): TaskSummary {
  return {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-acme",
    name: `Task ${n}`,
    createdAt: 1,
    updatedAt,
    repository: "acme/relay",
    ownerId: ADA.userId,
    createdBy: ADA,
    status,
    ...(madeBy === undefined
      ? undefined
      : { origin: { actor: DESCRIPTION_ACTOR.AGENT, agentId: madeBy } }),
  };
}

function agent(
  n: number,
  on: TaskSummary,
  startedBy: string,
  status: ListedAgent["status"],
  at: number,
): ListedAgent {
  const working = status === AGENT_STATUS.RUNNING || status === AGENT_STATUS.STARTING;

  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    taskId: on.id,
    title: `Agent ${n}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status,
    createdAt: 1,
    turnId: null,
    workspaceId: on.workspaceId,
    repository: on.repository,
    startedBy: ADA,
    startedByAgentId: startedBy,
    ...(working ? { runStartedAt: at } : { settledAt: at }),
  };
}

function pullRequest(number: number, state: AgentPullRequest["state"]): AgentPullRequest {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
  };
}

// The Manager made Invites and Landing, and started agents on Invites, Digest, and Rounding.
const INVITES = task(1, TASK_STATUS.IN_PROGRESS, 20 * DAY, MANAGER);
const LANDING = task(2, TASK_STATUS.TODO, 25 * DAY, MANAGER);
const DIGEST = task(3, TASK_STATUS.IN_PROGRESS, 28 * DAY);
const ROUNDING = task(4, TASK_STATUS.DONE, 27 * DAY);
const LEDGER = task(5, TASK_STATUS.DONE, 10 * DAY, MANAGER);
const DROPPED = task(6, TASK_STATUS.CANCELED, 29 * DAY, MANAGER);
const BILLING = task(7, TASK_STATUS.TODO, 29 * DAY, OTHER_MANAGER);

const INVITING = agent(1, INVITES, MANAGER, AGENT_STATUS.COMPLETED, 26 * DAY);
const DIGESTING = agent(2, DIGEST, MANAGER, AGENT_STATUS.RUNNING, 20 * DAY);
const ROUNDED = agent(3, ROUNDING, MANAGER, AGENT_STATUS.COMPLETED, 27 * DAY);
const ARCHIVED = { ...agent(4, INVITES, MANAGER, AGENT_STATUS.COMPLETED, 29 * DAY), archivedAt: 1 };
const BILLER = agent(5, BILLING, OTHER_MANAGER, AGENT_STATUS.RUNNING, 29 * DAY);

test("a Manager's overview lists its own agents, pull requests, and tasks", () => {
  const overview = managerOverview({
    managerId: MANAGER,
    tasks: [INVITES, LANDING, DIGEST, ROUNDING, LEDGER, DROPPED, BILLING],
    agents: [INVITING, DIGESTING, ROUNDED, ARCHIVED, BILLER],
    pullRequests: [
      {
        agentId: ROUNDED.id,
        taskId: ROUNDING.id,
        pullRequest: pullRequest(3, PULL_REQUEST_STATE.MERGED),
      },
      {
        agentId: INVITING.id,
        taskId: INVITES.id,
        pullRequest: pullRequest(1, PULL_REQUEST_STATE.OPEN),
      },
      {
        agentId: DIGESTING.id,
        taskId: DIGEST.id,
        pullRequest: pullRequest(2, PULL_REQUEST_STATE.DRAFT),
      },
      {
        agentId: BILLER.id,
        taskId: BILLING.id,
        pullRequest: pullRequest(5, PULL_REQUEST_STATE.OPEN),
      },
    ],
    now: NOW,
  });

  expect({
    agents: overview.agents.map(({ agent: each }) => each.title),
    pullRequests: overview.pullRequests.map(({ pullRequest: each }) => each.number),
    openTasks: overview.openTasks.map((each) => each.name),
    doneThisWeek: overview.doneThisWeek.map((each) => each.name),
  }).toEqual({
    // At work first, then the newest settled.
    agents: ["Agent 2", "Agent 3", "Agent 1"],
    // Open and draft first, in the agents' order, then the merged.
    pullRequests: [2, 1, 3],
    openTasks: ["Task 3", "Task 2", "Task 1"],
    // Ledger finished 20 days ago, so it is no longer this week's.
    doneThisWeek: ["Task 4"],
  });
});
