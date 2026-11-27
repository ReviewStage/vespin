import {
  AGENT_FAILURE,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentFailure,
  type AgentStatus,
  type AgentSummary,
  type ListedAgent,
  PULL_REQUEST_STATE,
} from "./agent-wire.js";
import type { TaskAgentsSummary, TaskPullRequestLine, TaskPullRequests } from "./task-wire.js";

/**
 * task-agents-model.ts -- a task's coding agents and their pull requests as every reader of them reads them, from the list the window follows live, and the one status its row wears.
 *
 * A task's row counts its agents (`TaskAgentsSummary`); the agents and pull
 * requests themselves are read from what the window holds beside the list
 * (`tasks-view.ts`'s `taskAgents` and `taskPullRequests`), every one of
 * them, in the order a task names them: its agents those at work first,
 * then the rest, newest started first within each, and its pull requests
 * those still open first, then merged, then closed.
 *
 * A row wears at most one status, as a devtool's sidebar does: the one
 * thing that matters most about its agents. An agent that failed comes
 * first; then one at work; then the pull request that matters most, an
 * open or draft one before a merged one, and a merged one before a closed
 * one. A task whose agents finished with nothing published wears none.
 * An agent's failure stops being the task's once another agent is started
 * on it after the failure, as a newer CI run decides a commit's check.
 *
 * Note that a thread waiting on the reader is no status here, because the
 * Tasks page's row and card say how many wait in a count of its own,
 * standing before this status (`@repo/panel`'s `WaitingCount`).
 */

/** Where a task's agents stand, most pressing first. */
export const TASK_AGENTS_STATUS = {
  FAILED: "failed",
  WORKING: "working",
  PULL_REQUEST: "pull-request",
  NONE: "none",
} as const;

export type TaskAgentsStatus =
  | { readonly kind: typeof TASK_AGENTS_STATUS.FAILED }
  | { readonly kind: typeof TASK_AGENTS_STATUS.WORKING }
  | {
      readonly kind: typeof TASK_AGENTS_STATUS.PULL_REQUEST;
      readonly pullRequest: Pick<TaskPullRequestLine, "state" | "queued">;
    }
  | { readonly kind: typeof TASK_AGENTS_STATUS.NONE };

const NO_STATUS: TaskAgentsStatus = { kind: TASK_AGENTS_STATUS.NONE };

/** The pull request states in the order a task's status picks among them: still to be acted on, then merged, then closed. */
const PULL_REQUEST_ORDER = [
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.DRAFT]),
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.MERGED]),
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.CLOSED]),
] as const;

/** Where a pull request stands in `PULL_REQUEST_ORDER`, earliest first. */
function rankOf(pullRequest: Pick<TaskPullRequestLine, "state">): number {
  return PULL_REQUEST_ORDER.findIndex((states) => states.has(pullRequest.state));
}

/** Items in the order a task's readers name their pull requests (`pullRequestOf`): those still to be acted on first, then merged, then closed, each rank in the order handed. */
export function inPullRequestOrder<Item>(
  items: readonly Item[],
  pullRequestOf: (item: Item) => Pick<TaskPullRequestLine, "state">,
): readonly Item[] {
  return items.toSorted((a, b) => rankOf(pullRequestOf(a)) - rankOf(pullRequestOf(b)));
}

/** The pull request a task's status names: the first of the earliest state in `PULL_REQUEST_ORDER`. */
function markedPullRequest<PullRequest extends Pick<TaskPullRequestLine, "state">>(
  pullRequests: readonly PullRequest[],
): PullRequest | undefined {
  for (const states of PULL_REQUEST_ORDER) {
    const found = pullRequests.find((each) => states.has(each.state));

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * How many of a task's unarchived `agents` failed with no agent started on
 * the task since `latestStart`, each failing when its last turn settled, or
 * as it started where it ran none. Note that `latestStart` counts the
 * archived agents too, because archiving the agent that took over from a
 * failure must not bring the failure back. The held and live reads both
 * count `TaskAgentsSummary.failed` here, so the two agree. An agent its
 * plan's usage limit stopped is no failure to count, since its user expects it.
 */
export function standingFailures(
  agents: readonly {
    readonly createdAt: number;
    readonly status: AgentStatus;
    /** When its last turn settled; none where it ran none. */
    readonly at: number | undefined;
    /** Why its newest turn failed, where it did. */
    readonly failure: AgentFailure | undefined;
  }[],
  latestStart: number,
): number {
  return agents.filter(
    ({ createdAt, status, at, failure }) =>
      status === AGENT_STATUS.FAILED &&
      failure !== AGENT_FAILURE.PLAN_LIMIT &&
      (at ?? createdAt) >= latestStart,
  ).length;
}

/** The statuses under which an agent is at work. */
const WORKING: ReadonlySet<ListedAgent["status"]> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** What ordering a task's agents reads of each. */
type OrderedAgent = Pick<ListedAgent, "id" | "taskId" | "status" | "createdAt" | "archivedAt">;

/** Those at work first, then the rest, newest started first within each, and by id among those started at one instant. */
function workingFirst(a: OrderedAgent, b: OrderedAgent): number {
  const working = Number(WORKING.has(b.status)) - Number(WORKING.has(a.status));

  if (working !== 0) return working;

  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A task's agents among those the window holds, the archived left out, those at work first, then the rest, newest started first within each. */
export function agentsOfTask<Agent extends OrderedAgent>(
  agents: readonly Agent[] | undefined,
  taskId: string,
): readonly Agent[] {
  return (agents ?? [])
    .filter((agent) => agent.taskId === taskId && agent.archivedAt === undefined)
    .toSorted(workingFirst);
}

/** When an agent last moved, as a row naming it says: when its run began while it works, when its newest turn ended once it has; none where neither is known. */
export function agentMovedAt(
  agent: Pick<ListedAgent, "status" | "runStartedAt" | "settledAt">,
): number | undefined {
  return WORKING.has(agent.status) ? agent.runStartedAt : agent.settledAt;
}

/** When an agent last moved, as its row's time says it (`agentMovedAt`); else when its newest run began, else when it was started. */
export function agentLastMovedAt(
  agent: Pick<ListedAgent, "status" | "runStartedAt" | "settledAt" | "createdAt">,
): number {
  return agentMovedAt(agent) ?? agent.runStartedAt ?? agent.createdAt;
}

/** A task's pull requests among those the window holds, every one, in the order the task names them; none where it opened none. */
export function pullRequestsOfTask(
  listed: readonly TaskPullRequests[] | undefined,
  taskId: string,
): readonly TaskPullRequestLine[] {
  return listed?.find((each) => each.taskId === taskId)?.pullRequests ?? [];
}

/**
 * The one pull request an agent's own row names of every one it opened,
 * listed newest first: the first of the earliest state in
 * `PULL_REQUEST_ORDER`, as its task's status picks among its agents', so an
 * agent whose newest merged while an older one waits names the one that
 * waits, as its task does; none where it opened none.
 */
export function agentMarkedPullRequest<PullRequest extends Pick<TaskPullRequestLine, "state">>(
  pullRequests: readonly PullRequest[],
): PullRequest | undefined {
  return markedPullRequest(pullRequests);
}

/** The one status a task's row wears for what its agents are doing and what they published, its pull requests every one it opened (`pullRequestsOfTask`). */
export function taskAgentsStatus(
  agents: TaskAgentsSummary | undefined,
  pullRequests: readonly TaskPullRequestLine[],
): TaskAgentsStatus {
  if (agents === undefined) return NO_STATUS;

  if ((agents.failed ?? 0) > 0) return { kind: TASK_AGENTS_STATUS.FAILED };

  if (agents.working > 0) return { kind: TASK_AGENTS_STATUS.WORKING };
  const pullRequest = markedPullRequest(pullRequests);

  return pullRequest === undefined
    ? NO_STATUS
    : { kind: TASK_AGENTS_STATUS.PULL_REQUEST, pullRequest };
}

/** The statuses an agent may still write under, which is when it can be stopped. */
const FOLLOWED_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** Whether an agent in this status may still write more. */
export function agentStillWriting(status: AgentStatus): boolean {
  return FOLLOWED_STATUSES.has(status);
}

/**
 * Agents in the order a task's Agents group lists them: the oldest started
 * first, as its sub-tasks read in the order they were made. An entry with
 * no agent, a draft's, is started at none.
 */
export function inAgentListOrder<Entry>(
  entries: readonly Entry[],
  agentOf: (entry: Entry) => Pick<ListedAgent, "createdAt"> | undefined,
): readonly Entry[] {
  const started = (entry: Entry) => agentOf(entry)?.createdAt ?? 0;

  return entries.toSorted((a, b) => started(a) - started(b));
}

/** What a task's Agents tree reads of each agent: who started it, what it was started from, whether it still works, and why its turn failed. */
type TreeAgent = Pick<AgentSummary, "id" | "status" | "startedByAgentId" | "from"> & {
  readonly turn?: { readonly failure?: AgentFailure };
};

/**
 * Where the agents nested under a row stand, at every depth under it: how
 * many may still write, and how many failed. Note that it counts no share
 * done, as a task's sub-tasks do, because an agent at rest is no agent
 * finished: a worker waiting on CI rests until its wake, and one the
 * developer messages works again.
 */
export interface StartedAgentsStanding {
  readonly working: number;
  readonly failed: number;
}

/** How the agents under a row stand, as its count says them. */
export const STARTED_STANDING = {
  WORKING: "working",
  FAILED: "failed",
} as const;

export type StartedStanding = (typeof STARTED_STANDING)[keyof typeof STARTED_STANDING];

/** What a row's count of the agents under it reads as: "2 working", "1 failed". */
export function startedShown(count: number, standing: StartedStanding): string {
  return `${count} ${standing}`;
}

/** What a row's count of the agents under it is heard as: "2 agents it started are working", "1 agent it started failed". */
export function startedHeard(count: number, standing: StartedStanding): string {
  const agents = count === 1 ? "agent" : "agents";

  if (standing === STARTED_STANDING.FAILED) return `${count} ${agents} it started failed`;

  return `${count} ${agents} it started ${count === 1 ? "is" : "are"} working`;
}

/** Whether an agent failed by a fault of its own: failed, and not stopped by its plan's usage limit, which its user expects. */
function agentFailedByFault(agent: Pick<TreeAgent, "status" | "turn">): boolean {
  return agent.status === AGENT_STATUS.FAILED && agent.turn?.failure !== AGENT_FAILURE.PLAN_LIMIT;
}

/** One row of a task's Agents tree: its entry, how deep it stands, and the agents it started, counted, where it started any. */
export interface AgentTreeRow<Entry> {
  readonly entry: Entry;
  readonly depth: number;
  /** Where the agents nested under it stand, at every depth, whether or not they stand open; none where it started none. */
  readonly started?: StartedAgentsStanding | undefined;
  /** The agents its fold passes by, at every depth under it, while it stands folded; none while it stands open or started none. */
  readonly folded?: readonly Entry[] | undefined;
}

/**
 * The agent an agent stands nested under among those listed: the one that
 * started it, or, where that one is not listed, the listed agent that
 * continued it, followed along each continuation, as an orchestrator
 * continued takes on what the one before it started; none where neither is
 * listed.
 */
function listedStarter(
  agent: TreeAgent,
  listed: ReadonlySet<string>,
  continuedBy: ReadonlyMap<string, string>,
): string | undefined {
  let starter = agent.startedByAgentId;

  while (starter !== undefined && !listed.has(starter)) starter = continuedBy.get(starter);

  return starter === agent.id ? undefined : starter;
}

/** Whether walking up from `id` through `starters` comes back to it, as a loop of starters would, which nothing writes but is cut where it closes. */
function closesLoop(id: string, starters: ReadonlyMap<string, string>): boolean {
  const passed = new Set<string>();

  for (let up = starters.get(id); up !== undefined; up = starters.get(up)) {
    if (up === id || passed.has(up)) return true;
    passed.add(up);
  }

  return false;
}

/**
 * A task's agents as its Agents group draws them: each nested under the
 * listed agent that started it (`listedStarter`), to any depth, those under
 * a row not `open` passed by. Siblings keep the order handed in
 * (`inAgentListOrder`), and each row at the top stands where the first of
 * the agents under it, itself among them, stands. A row counts the agents
 * nested under it, at every depth, that still work and that failed, and a row
 * standing folded names every agent its fold passes by, so what waits on
 * the developer there can still be said on it. A loop of
 * starters, which nothing writes, is cut where it closes, its agents
 * standing at the top.
 */
export function agentTree<Entry>(
  ordered: readonly Entry[],
  agentOf: (entry: Entry) => TreeAgent | undefined,
  open: (agentId: string) => boolean,
): readonly AgentTreeRow<Entry>[] {
  const listed = new Set<string>();
  const continuedBy = new Map<string, string>();

  for (const entry of ordered) {
    const agent = agentOf(entry);

    if (agent === undefined) continue;
    listed.add(agent.id);

    // Note that a fork stands on its own, so only a continue takes on what the agent before it started.
    if (agent.from !== undefined && agent.from.messageId === undefined) {
      continuedBy.set(agent.from.agentId, agent.id);
    }
  }

  const starters = new Map<string, string>();

  for (const entry of ordered) {
    const agent = agentOf(entry);
    const starter = agent === undefined ? undefined : listedStarter(agent, listed, continuedBy);

    if (agent !== undefined && starter !== undefined) starters.set(agent.id, starter);
  }

  const under = new Map<string, Entry[]>();
  const tops: Entry[] = [];

  for (const entry of ordered) {
    const id = agentOf(entry)?.id;
    const starter = id === undefined ? undefined : starters.get(id);

    if (id === undefined || starter === undefined || closesLoop(id, starters)) tops.push(entry);
    else under.set(starter, [...(under.get(starter) ?? []), entry]);
  }

  const kidsOf = (entry: Entry) => {
    const id = agentOf(entry)?.id;

    return (id === undefined ? undefined : under.get(id)) ?? [];
  };

  const everyUnder = (entry: Entry): Entry[] => [entry, ...kidsOf(entry).flatMap(everyUnder)];
  const rank = new Map(ordered.map((entry, at) => [entry, at]));

  const first = (entry: Entry): number =>
    Math.min(rank.get(entry) ?? 0, ...kidsOf(entry).map(first));

  const firsts = new Map(tops.map((top) => [top, first(top)]));
  const rows: AgentTreeRow<Entry>[] = [];

  const draw = (entry: Entry, depth: number) => {
    const kids = kidsOf(entry);
    const id = agentOf(entry)?.id;

    if (kids.length === 0) {
      rows.push({ entry, depth });

      return;
    }

    const nested = kids.flatMap(everyUnder).flatMap((kid) => agentOf(kid) ?? []);

    const started = {
      working: nested.filter((agent) => agentStillWriting(agent.status)).length,
      failed: nested.filter(agentFailedByFault).length,
    };

    if (id !== undefined && open(id)) {
      rows.push({ entry, depth, started });

      for (const kid of kids) draw(kid, depth + 1);

      return;
    }

    rows.push({ entry, depth, started, folded: kids.flatMap(everyUnder) });
  };

  for (const top of tops.toSorted((a, b) => (firsts.get(a) ?? 0) - (firsts.get(b) ?? 0))) {
    draw(top, 0);
  }

  return rows;
}

/** What the Machine menu, its chips, and an agent's row say of where it runs. */
export const RUNS_ON_WORDS = {
  LABEL: "Machine",
  CLOUD: "Cloud",
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Can't check status",
  CHECKING: "Checking",
  SETTING_UP: "Setting up",
  FAILED: "Failed",
  REMOVED: "Removed device",
  NO_MATCH: "No devices match",
} as const;

/** The Mac a local agent runs on, as its row reads it. */
type RunsOnMac = NonNullable<AgentSummary["mac"]>;

/**
 * Where an agent runs, as its row says it: Cloud for one in a sandbox, the
 * device it runs on by `deviceName` (its own name where none is given), and
 * Removed device for a local agent whose Mac is gone.
 */
export function agentRunsOnWords(
  agent: Pick<AgentSummary, "machine" | "mac">,
  deviceName: (mac: RunsOnMac) => string = (mac) => mac.name,
): string {
  if (agent.machine !== AGENT_MACHINE.DEVICE) return RUNS_ON_WORDS.CLOUD;

  return agent.mac === undefined ? RUNS_ON_WORDS.REMOVED : deviceName(agent.mac);
}
