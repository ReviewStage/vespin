/**
 * task-list-tasks.ts -- the task list's plans and agents as TanStack DB live queries over its drawn plans and agents: each agent as the tabs draw it, each plan with its agents in brief, and the pins, derived again only for a row that moved, a grace that ended, or a plan whose agents did.
 *
 * Follows the list's pull requests (`task-list-pull-requests.ts`, whose
 * header says how). Each query stands on the rows as the list draws them
 * (`drawn-rows.ts`), so a write the member makes reaches it at once, and on
 * the agents past their starting grace (`pastGrace`), a local-only
 * collection the list writes as each grace ends, so nothing here reads a
 * clock. An agent is joined with its grace (`graced`), then with the agents
 * started from it (`task-list-continuations.ts`), and drawn by a `fn.select`
 * over the two (`listedAgentOf`). A plan's agents with their graces are
 * gathered by an include (`toArray`) under the plans they name (`groupKeys`),
 * and the plan is joined with that group and its pull requests and drawn by
 * a `fn.select` over the three (`taskSummaryOf`). Each derivation is written
 * into a field of the query's row, never spread over it, so a reader takes
 * the derivation's own object, the very object until its row, its grace, or
 * its group moves again, and the lists are built again only after a query's
 * change (`listedOf`). So one row that moves builds again its own agent and
 * its own plan, whatever the account's size, and every other is the object
 * drawn before.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import {
  agentPinOf,
  agentsSummaryOf,
  listedAgentOf,
  taskSummaryOf,
} from "@repo/features/task-list-live";
import type { TaskAgentPin, TaskSummary } from "@repo/features/task-wire";
import { KEPT_BY_SCOPE, type RowCollection, scopedCollection } from "@repo/sync";
import {
  type Collection,
  createLiveQueryCollection,
  eq,
  groupKeys,
  isNull,
  isUndefined,
  not,
  toArray,
} from "@tanstack/db";
import { Effect, type Scope } from "effect";
import { listedOf, type QueryCollection } from "./drawn-rows.js";
import type { AgentRow, PastGrace, PlanRow } from "./task-list-collections.js";
import type { Continued } from "./task-list-continuations.js";
import type { PlanPullRequests } from "./task-list-pull-requests.js";

/** What the list's plans and agents are derived from: the rows as it draws them, and what it derives beside them. */
export interface TaskListSources {
  readonly plans: RowCollection<PlanRow, string>;
  readonly agents: RowCollection<AgentRow, string>;
  /** The agents whose starting grace has ended, by id. */
  readonly pastGrace: Collection<PastGrace, string>;
  /** Each plan's pull requests (`taskListPullRequests`). */
  readonly pullRequests: QueryCollection<PlanPullRequests>;
  /** The agents started from each agent (`taskListContinuations`). */
  readonly continuations: QueryCollection<Continued>;
}

/** The task list's plans and agents, as its live queries hold them now. */
export interface TaskListTasks {
  /** The plans newest started first, each with its agents in brief. */
  readonly plans: () => readonly TaskSummary[];
  /** Every agent on a plan, the archived among them, first started first. */
  readonly taskAgents: () => readonly ListedAgent[];
  /** The reader's pins of agents on a plan, the archived left out. */
  readonly taskAgentPins: () => readonly TaskAgentPin[];
}

/**
 * The row a full join's main side stands on, which the query's `where`
 * keeps for every row it answers. Note that the list's joins are full ones,
 * since TanStack loads a left join's other side on demand, and that demand
 * walks every key the main side holds at each change.
 */
function mainOf<Row>(row: Row | undefined): Row {
  if (row === undefined) throw new Error("A full join answered a row its where let go.");

  return row;
}

/** The task list's plans and agents over `sources`, for as long as the scope stands. */
export function taskListTasks(
  sources: TaskListSources,
): Effect.Effect<TaskListTasks, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { plans, agents, pastGrace, pullRequests, continuations } = sources;

    // Each agent with whether its grace has ended, derived again only as its row or its grace moves.
    const graced = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: agents })
            .fullJoin({ grace: pastGrace }, ({ agent, grace }) => eq(agent.id, grace.agentId))
            .where(({ agent }) => not(isUndefined(agent.id)))
            .fn.select(({ agent, grace }) => {
              const row = mainOf(agent);

              return {
                id: row.id,
                planId: row.planId,
                createdAt: row.createdAt,
                graced: { row, pastGrace: grace !== undefined },
              };
            }),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each agent as the tabs draw it, first started first, and by id among those started at one instant.
    const listed = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: graced })
            .fullJoin({ continued: continuations }, ({ agent, continued }) =>
              eq(agent.id, continued.agentId),
            )
            .where(({ agent }) => not(isUndefined(agent.id)))
            .orderBy(({ agent }) => agent.createdAt)
            .orderBy(({ agent }) => agent.id, { stringSort: "lexical" })
            .fn.select(({ agent, continued }) => {
              const { row, pastGrace } = mainOf(agent).graced;

              return { listed: listedAgentOf(row, pastGrace, continued?.continuedBy) };
            }),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan an agent names, once, and its agents with their graces gathered under it.
    const named = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: agents })
            .groupBy(groupKeys(({ agent }) => agent.planId))
            .select(({ agent }) => ({ taskId: agent.planId })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    const groups = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ plan: named }).select(({ plan }) => ({
            taskId: plan.taskId,
            agents: toArray(
              q
                .from({ agent: graced })
                .where(({ agent }) => eq(agent.planId, plan.taskId))
                .select(({ agent }) => agent.graced),
            ),
          })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan as the list's row says it, newest started first, derived again only as its row, its agents, or their graces move.
    const summaries = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ plan: plans })
            .fullJoin({ group: groups }, ({ plan, group }) => eq(plan.id, group.taskId))
            .fullJoin({ lines: pullRequests }, ({ plan, lines }) => eq(plan.id, lines.taskId))
            .where(({ plan }) => not(isUndefined(plan.id)))
            .orderBy(({ plan }) => plan.createdAt, "desc")
            .orderBy(({ plan }) => plan.id, { direction: "desc", stringSort: "lexical" })
            .fn.select(({ plan, group, lines }) => ({
              summary: taskSummaryOf(
                mainOf(plan),
                group === undefined
                  ? undefined
                  : agentsSummaryOf(group.agents, lines?.listing?.pullRequests.length ?? 0),
              ),
            })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each pin of an agent standing, derived again only as its row moves.
    const pins = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: agents })
            .where(({ agent }) => not(isNull(agent.pinnedAt)))
            .where(({ agent }) => isNull(agent.archivedAt))
            .fn.select(({ agent }) => ({ pin: agentPinOf(agent) })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    return {
      plans: yield* listedOf(summaries, (row) => row.summary),
      taskAgents: yield* listedOf(listed, (row) => row.listed),
      taskAgentPins: yield* listedOf(pins, (row) => row.pin),
    };
  });
}
