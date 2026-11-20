/**
 * task-list-archived.ts -- the task list's archived agents, held apart from its live queries: each drawn once as the tabs draw it, its pull request, and what each plan's archived agents add to its summary.
 *
 * Most of an account's agents are archived (82% of one of 5,400), and an
 * archived agent's row seldom moves again, yet every live query of the list
 * (`task-list-tasks.ts`, `task-list-pull-requests.ts`) would carry each
 * through its graph on every whole answer. So the list's live queries take
 * its agents that are not archived, and the archived ones are held here, by
 * id, in a plain map: each drawn by `listedAgentOf` once, as its row or the
 * agents started from it move, and the very object until then. An archived
 * agent whose status still waits on its starting grace (`agentGraceEnd`)
 * stays with the live queries, which mark its grace's end, so nothing here
 * reads one (`heldApart`).
 *
 * What a plan's summary reads of its archived agents, the latest activity
 * and the latest start, is held per plan (`ArchivedActivity`) and moved only
 * for a plan whose archived agents moved, for the plan's summary to add
 * (`task-list-tasks.ts`). The archived agents and their pull requests are
 * lists built again only once one of them moved, which the list merges with
 * its live queries' own (`mergedByStart`), so a reader takes the lists it
 * took before.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import {
  type ArchivedActivity,
  agentGraceEnd,
  agentPullRequestOf,
  archivedActivityOf,
  type ContinuedBy,
  listedAgentOf,
} from "@repo/features/task-list-live";
import type { ListedPullRequest } from "@repo/features/task-wire";
import type { AgentRow } from "./task-list-rows.js";

/** One archived agent the list holds apart: its row, its pull request, and how the tabs draw it, built once the list first asks. */
interface HeldAgent {
  readonly row: AgentRow;
  listed: ListedAgent | undefined;
  readonly pullRequest: ListedPullRequest | undefined;
}

/** The task list's archived agents, held apart from its live queries. */
export interface ArchivedAgents {
  /**
   * Takes each of `keys` as `rowOf` draws it now: held where it is an
   * archived agent held apart (`heldApart`), let go where it is not or is
   * gone, and the plans whose archived agents moved written again.
   */
  readonly drawn: (keys: readonly string[], rowOf: (key: string) => AgentRow | undefined) => void;
  /** Draws again each archived agent of `agentIds`, the agents started from it having moved. */
  readonly continued: (agentIds: Iterable<string>) => void;
  /** Every archived agent held apart, as the tabs draw it, first started first, and by id among those started at one instant. */
  readonly taskAgents: () => readonly ListedAgent[];
  /** The pull request of every archived agent held apart whose row keeps one. */
  readonly agentPullRequests: () => readonly ListedPullRequest[];
  /** What the plan `taskId`'s archived agents held apart add to its summary, the very object until one of them moves; none where it has none. */
  readonly activityOf: (taskId: string) => ArchivedActivity | undefined;
  /** How many times what any plan's archived agents add has moved. */
  readonly activityMoved: () => number;
}

/**
 * Whether the list holds `row` apart from its live queries: an archived
 * agent whose status waits on no starting grace, so nothing but its row and
 * the agents started from it moves what it draws.
 */
export function heldApart(row: AgentRow): boolean {
  return row.archivedAt !== null && agentGraceEnd(row) === undefined;
}

/** First started first, and by id among those started at one instant, as the list's agents query orders them. */
function firstStarted(
  a: { readonly id: string; readonly createdAt: number },
  b: { readonly id: string; readonly createdAt: number },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * `live` and `apart`, each already first started first, as one list in that
 * order: what the list's agents query would answer had it held both.
 */
export function mergedByStart<Value extends { readonly id: string; readonly createdAt: number }>(
  live: readonly Value[],
  apart: readonly Value[],
): readonly Value[] {
  if (apart.length === 0) return live;

  const merged: Value[] = [];
  let right = 0;

  for (const value of live) {
    // Note that no agent stands in both lists, so none ties, and of two started at one instant the lesser id goes first.
    for (let next = apart[right]; next !== undefined && firstStarted(next, value) < 0; ) {
      merged.push(next);
      right += 1;
      next = apart[right];
    }

    merged.push(value);
  }

  merged.push(...apart.slice(right));

  return merged;
}

/** The task list's archived agents, none held yet, the agents started from each read by `continuedOf`. */
export function archivedAgents(
  continuedOf: (agentId: string) => ContinuedBy | undefined,
): ArchivedAgents {
  const held = new Map<string, HeldAgent>();
  /** The archived agents held apart of each plan, by the plan's id. */
  const ofTask = new Map<string, Set<string>>();
  /** What each plan's archived agents add as last taken, kept the very object while their instants stand. */
  const activities = new Map<string, ArchivedActivity>();
  let activityMoved = 0;
  /** The held agents' ids in their order, and the lists last built; none once one moved. */
  let order: readonly string[] | undefined;
  let listed: readonly ListedAgent[] | undefined;
  let pullRequests: readonly ListedPullRequest[] | undefined;

  /** Moves `id` from the plan it was held under, where it was, to `taskId`'s, answering the plans it left and joined. */
  const moveTask = (id: string, was: string | null | undefined, taskId: string | null) => {
    if (was === taskId) return [];

    if (was !== undefined && was !== null) {
      const agents = ofTask.get(was);
      agents?.delete(id);

      if (agents?.size === 0) ofTask.delete(was);
    }

    if (taskId !== null) ofTask.set(taskId, (ofTask.get(taskId) ?? new Set()).add(id));

    return [was, taskId].flatMap((each) => (each === undefined || each === null ? [] : [each]));
  };

  /** Takes again what the plan `taskId`'s archived agents add, keeping the object held where it is the same. */
  const activityDrawn = (taskId: string) => {
    const now = archivedActivityOf(
      [...(ofTask.get(taskId) ?? [])].flatMap((id) => {
        const row = held.get(id)?.row;

        return row === undefined ? [] : [row];
      }),
    );

    const was = activities.get(taskId);

    if (now?.activityAt === was?.activityAt && now?.latestStart === was?.latestStart) return;
    activityMoved += 1;

    if (now === undefined) activities.delete(taskId);
    else activities.set(taskId, now);
  };

  const drawn = (keys: readonly string[], rowOf: (key: string) => AgentRow | undefined) => {
    const tasks = new Set<string>();

    for (const key of keys) {
      const drawnRow = rowOf(key);
      const row = drawnRow !== undefined && heldApart(drawnRow) ? drawnRow : undefined;
      const was = held.get(key);

      if (row === was?.row) continue;

      for (const taskId of moveTask(key, was?.row.taskId, row?.taskId ?? null)) tasks.add(taskId);

      // Note that a plan's activity reads every archived agent's row, so one whose row moved within its plan writes it again too.
      if (row?.taskId != null) tasks.add(row.taskId);

      if (row === undefined || row.createdAt !== was?.row.createdAt) order = undefined;

      if (row === undefined) held.delete(key);
      else held.set(key, { row, listed: undefined, pullRequest: agentPullRequestOf(row) });
      listed = undefined;
      pullRequests = undefined;
    }

    for (const taskId of tasks) activityDrawn(taskId);
  };

  const continued = (agentIds: Iterable<string>) => {
    for (const id of agentIds) {
      const agent = held.get(id);

      if (agent === undefined) continue;
      agent.listed = undefined;
      listed = undefined;
    }
  };

  const ordered = (): readonly string[] => {
    order ??= [...held.values()]
      .map((agent) => agent.row)
      .toSorted(firstStarted)
      .map((row) => row.id);

    return order;
  };

  const taskAgents = (): readonly ListedAgent[] => {
    listed ??= ordered().flatMap((id) => {
      const agent = held.get(id);

      if (agent === undefined) return [];
      // Note that a status held apart waits on no grace, so it is drawn as past none.
      agent.listed ??= listedAgentOf(agent.row, false, continuedOf(id));

      return [agent.listed];
    });

    return listed;
  };

  const agentPullRequests = (): readonly ListedPullRequest[] => {
    pullRequests ??= ordered().flatMap((id) => {
      const pullRequest = held.get(id)?.pullRequest;

      return pullRequest === undefined ? [] : [pullRequest];
    });

    return pullRequests;
  };

  return {
    drawn,
    continued,
    taskAgents,
    agentPullRequests,
    activityOf: (taskId) => activities.get(taskId),
    activityMoved: () => activityMoved,
  };
}
