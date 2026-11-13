/**
 * task-list-pull-requests.ts -- the task list's pull requests as TanStack DB live queries over its drawn agents: each agent's by its id, and each plan's lines by the plan's, derived again only for an agent or a plan whose agents moved.
 *
 * The first of the task list's derivations to stand on live queries, and the
 * pattern the rest follow. A query stands on the list's agents as it draws
 * them (`drawn-rows.ts`), never on the pool's synced collection, so a write
 * the member makes reaches it at once. What a row alone derives is a
 * `fn.select` over that row (`agentPullRequestOf`); what a plan's agents
 * derive together is the plan's agents gathered by an include (`toArray`)
 * under the plans they name (`groupKeys`), with the derivation a `fn.select`
 * over that group (`pullRequestLinesOf`). Each derivation is written into a
 * field of the query's row, never spread over it, so what a reader takes is
 * the derivation's own object, free of TanStack's virtual fields, and the
 * very object until its row or group moves again. A list a reader takes is
 * built again only after a query's change (`subscribeChanges`), so a draw
 * nothing reached hands the list drawn before.
 */

import { agentPullRequestOf, pullRequestLinesOf } from "@repo/features/task-list-live";
import type { ListedPullRequest, TaskPullRequests } from "@repo/features/task-wire";
import { KEPT_BY_SCOPE, type RowCollection, scopedCollection } from "@repo/sync";
import {
  createLiveQueryCollection,
  eq,
  groupKeys,
  toArray,
  type WithVirtualProps,
} from "@tanstack/db";
import { Effect, type Scope } from "effect";
import { listedOf, type QueryCollection } from "./drawn-rows.js";
import type { AgentRow } from "./task-list-collections.js";

/** The task list's pull requests, as its live queries hold them now. */
export interface TaskListPullRequests {
  /** The pull request of every agent whose row keeps one, the archived among them. */
  readonly agentPullRequests: () => readonly ListedPullRequest[];
  /** Every pull request of each plan that has one, those still open first, the newest agent's first within each. */
  readonly taskPullRequests: () => readonly TaskPullRequests[];
  /** Each plan's lines by its id, the very object `taskPullRequests` holds for it, for a plan's own query to join. */
  readonly byTask: QueryCollection<PlanPullRequests>;
  /** Each plan an agent names, with its agents gathered under it, for a plan's own query to join. */
  readonly agentsByTask: QueryCollection<PlanAgents>;
}

/** One plan an agent names, and its agents. */
export interface PlanAgents {
  readonly taskId: string;
  readonly agents: WithVirtualProps<AgentRow, string>[];
}

/** One plan an agent names, and every pull request its agents opened; none where they opened none. */
export interface PlanPullRequests {
  readonly taskId: string;
  readonly listing: TaskPullRequests | undefined;
}

/** The task list's pull requests over `agents`, its agents as it draws them, for as long as the scope stands. */
export function taskListPullRequests(
  agents: RowCollection<AgentRow, string>,
): Effect.Effect<TaskListPullRequests, never, Scope.Scope> {
  return Effect.gen(function* () {
    // Each agent's own pull request, derived again only as its row moves.
    const byAgent = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: agents })
            .fn.select(({ agent }) => ({ listed: agentPullRequestOf(agent) })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan an agent names, once, and its agents gathered under it.
    const plans = yield* scopedCollection(() =>
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
          q.from({ plan: plans }).select(({ plan }) => ({
            taskId: plan.taskId,
            agents: toArray(
              q.from({ agent: agents }).where(({ agent }) => eq(agent.planId, plan.taskId)),
            ),
          })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan's lines, derived again only as one of its agents moves.
    const byTask = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ group: groups }).fn.select(({ group }) => {
            const pullRequests = pullRequestLinesOf(group.agents);

            return {
              taskId: group.taskId,
              listing:
                pullRequests.length === 0
                  ? undefined
                  : ({ taskId: group.taskId, pullRequests } satisfies TaskPullRequests),
            };
          }),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    const agentPullRequests = yield* listedOf(byAgent, (row) => row.listed);
    const taskPullRequests = yield* listedOf(byTask, (row) => row.listing);

    return {
      agentPullRequests,
      taskPullRequests,
      byTask,
      agentsByTask: groups,
    };
  });
}
