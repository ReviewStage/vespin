import {
  type AgentLatestTurn,
  type AgentStoreEffect,
  lastSettledTurnsOfReached,
  latestTurnsOfReached,
  listPublishedAgents,
  type PublishedAgentLine,
} from "@repo/database/models/agent-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import {
  AGENT_STATUS,
  type AgentFailure,
  type AgentStatus,
  PULL_REQUEST_STATE,
  pullRequestAuthorOf,
} from "@repo/features/agent-wire";
import { standingFailures } from "@repo/features/task-agents-model";
import {
  type HeldTaskSummary,
  RELEASED_CLIENT_TASK_LINES,
  type TaskAgentLine,
  type TaskPullRequestLine,
  type TaskSummary,
} from "@repo/features/task-wire";
import { Clock, Effect } from "effect";
import {
  agentActivityAt,
  agentFailureOf,
  agentRunStartedAt,
  agentStatusOf,
  startedBlank,
} from "./coder-host/status.js";

/**
 * task-agents.ts -- what each listed task's coding agents are doing and what they published, in brief, for the held list (GET) the command line and released desktops read.
 *
 * Four statements answer the whole list however many tasks it holds: the
 * agents of every task named with the pull request each last published,
 * their newest turns, when each last ended a turn, and the names of the
 * members who started them. An
 * agent's status and its starter are read exactly as its tab's are
 * (`coder-host/status.ts`), and a pull request is the one its row keeps as
 * GitHub last answered, so nothing here asks GitHub. A task with no agent carries nothing, so the
 * list stays as small as it was for every task nobody has started an agent
 * on.
 */

const WORKING_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** One agent read for the list: its line, when it was started, which orders the lines, when it last did something settled, and whether it was archived, which leaves it out of all but the activity. */
interface ReadAgent {
  readonly line: TaskAgentLine;
  /** Why its newest turn failed, where it did (`agentFailureOf`). */
  readonly failure: AgentFailure | undefined;
  readonly createdAt: number;
  readonly activityAt: number;
  readonly archived: boolean;
  readonly pullRequests: PublishedAgentLine["pullRequests"];
}

/** One agent as its row names it, its status read at `now`: since its run began while it works, since its newest turn ended once it has; its starter named by `names`, and left unnamed once their account is gone. */
function agentLine(
  held: PublishedAgentLine,
  turn: AgentLatestTurn | undefined,
  lastSettledAt: Date | undefined,
  now: number,
  names: ReadonlyMap<string, string>,
): ReadAgent {
  const { agent } = held;
  const starter = names.get(agent.userId);
  const standing = { createdAt: agent.createdAt, now, blank: startedBlank(agent) };
  const status = agentStatusOf(turn, standing);

  const at = WORKING_STATUSES.has(status)
    ? agentRunStartedAt(turn, standing)
    : turn?.settledAt?.getTime();

  return {
    line: {
      id: agent.id,
      title: agent.title,
      model: agent.model,
      effort: agent.effort,
      status,
      ...(at === undefined ? undefined : { at }),
      ...(starter === undefined
        ? undefined
        : { startedBy: { userId: agent.userId, name: starter } }),
      ...(agent.automationId === null ? undefined : { automationId: agent.automationId }),
    },
    failure: turn === undefined ? undefined : agentFailureOf(turn),
    createdAt: agent.createdAt.getTime(),
    activityAt: agentActivityAt(lastSettledAt, agent),
    archived: agent.archivedAt !== null,
    pullRequests: held.pullRequests,
  };
}

/** The order the pull requests a row names stand in: those still to act on first, then merged, then closed. */
const PULL_REQUEST_RANK = {
  [PULL_REQUEST_STATE.OPEN]: 0,
  [PULL_REQUEST_STATE.DRAFT]: 0,
  [PULL_REQUEST_STATE.MERGED]: 1,
  [PULL_REQUEST_STATE.CLOSED]: 2,
} as const satisfies Record<TaskPullRequestLine["state"], number>;

/**
 * One task's agents in brief: those at work named first, then the rest,
 * newest started first within each; the pull requests each named once by
 * their page, since two agents on one branch share theirs and a task whose
 * repository changed may hold two of one number, those still open first, then
 * merged, then closed, newest agent's first within each and each agent's
 * newest first, so the few a released
 * client's row names always hold the one its mark is drawn for; and the
 * latest settled activity of every agent, named or not and archived or not,
 * which the plan's last update is read beside; and how many agents failed
 * with no agent started since (`standingFailures`). A
 * plan whose every agent is archived carries its activity alone, with no
 * agent and no pull request counted. Note that the agents and pull requests
 * named stop at `RELEASED_CLIENT_TASK_LINES`, because a released client
 * refuses a longer list; this build's window reads every one from the list
 * it follows live instead.
 */
function summaryOf(read: readonly ReadAgent[]): NonNullable<HeldTaskSummary["agents"]> {
  const agents = read.filter((agent) => !agent.archived);
  const newest = [...agents].sort((a, b) => b.createdAt - a.createdAt);
  const working = newest.filter((agent) => WORKING_STATUSES.has(agent.line.status));
  const resting = newest.filter((agent) => !WORKING_STATUSES.has(agent.line.status));
  const pullRequests = new Map<string, TaskPullRequestLine>();

  for (const { pullRequests: opened, line } of newest) {
    for (const published of opened) {
      if (pullRequests.has(published.url)) continue;
      const { number, title, state, checks, additions, deletions, url } = published;
      pullRequests.set(url, {
        number,
        title,
        state,
        checks,
        additions,
        deletions,
        url,
        agentId: line.id,
        ...(published.queued === true ? { queued: true } : undefined),
        ...pullRequestAuthorOf(published),
      });
    }
  }

  return {
    total: agents.length,
    working: working.length,
    failed: standingFailures(
      agents.map(({ createdAt, line, failure }) => ({
        createdAt,
        status: line.status,
        at: line.at,
        failure,
      })),
      Math.max(...read.map((agent) => agent.createdAt)),
    ),
    ...(read.length === 0
      ? undefined
      : { activityAt: Math.max(...read.map((agent) => agent.activityAt)) }),
    agents: [...working, ...resting]
      .slice(0, RELEASED_CLIENT_TASK_LINES)
      .map((agent) => agent.line),
    pullRequestTotal: pullRequests.size,
    pullRequests: [...pullRequests.values()]
      .sort((a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state])
      .slice(0, RELEASED_CLIENT_TASK_LINES),
  };
}

/** The account's listed tasks, each carrying its agents in brief, whichever member started each, where it has any; the tasks' order and every other field as listed. */
export function withTaskAgents(
  userId: string,
  tasks: readonly Omit<TaskSummary, "agents">[],
): AgentStoreEffect<readonly HeldTaskSummary[]> {
  return Effect.gen(function* () {
    // Note that the archived agents are read too, because the work one did
    // is still the task's activity, though the row names it no more.
    const held = yield* listPublishedAgents(
      userId,
      tasks.map((task) => task.id),
      { includeArchived: true },
    );

    const conversationIds = held.map(({ agent }) => agent.conversationId);
    // The agents were read through the tasks' gate, and each conversation is its starter's, a teammate's as often as the account's.
    const turns = yield* latestTurnsOfReached(conversationIds);
    const settled = yield* lastSettledTurnsOfReached(conversationIds);
    const names = yield* readAccountNames(held.map(({ agent }) => agent.userId));
    const now = yield* Clock.currentTimeMillis;
    const byTask = new Map<string, ReadAgent[]>();

    for (const agent of held) {
      const { conversationId, taskId } = agent.agent;

      const line = agentLine(
        agent,
        turns.get(conversationId),
        settled.get(conversationId),
        now,
        names,
      );

      byTask.set(taskId, [...(byTask.get(taskId) ?? []), line]);
    }

    return tasks.map((task) => {
      const agents = byTask.get(task.id);

      return agents === undefined ? task : { ...task, agents: summaryOf(agents) };
    });
  });
}
