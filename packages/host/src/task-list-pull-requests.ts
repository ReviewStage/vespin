/**
 * task-list-pull-requests.ts -- the task list's agents' pull requests as a TanStack DB live query over its drawn agents: each agent's by its id, derived again only for an agent whose row moved.
 *
 * The first of the task list's derivations to stand on live queries, and the
 * pattern the rest follow. A query stands on the list's agents as it draws
 * them (`drawn-rows.ts`), never on the pool's synced collection, so a write
 * the member makes reaches it at once. What a row alone derives is a
 * `fn.select` over that row (`agentPullRequestOf`), written into a field of
 * the query's row, never spread over it, so what a reader takes is the
 * derivation's own object, free of TanStack's virtual fields, and the very
 * object until its row moves again. A list a reader takes is built again
 * only after the query's change (`subscribeChanges`), so a draw nothing
 * reached hands the list drawn before. What a plan's agents derive together,
 * the plan's pull requests among it, is held outside the queries
 * (`task-list-tallies.ts`).
 */

import { agentPullRequestOf } from "@repo/features/task-list-live";
import type { ListedPullRequest } from "@repo/features/task-wire";
import { KEPT_BY_SCOPE, type RowCollection, scopedCollection } from "@repo/sync";
import { createLiveQueryCollection } from "@tanstack/db";
import { Effect, type Scope } from "effect";
import { listedOf } from "./drawn-rows.js";
import type { AgentRow } from "./task-list-rows.js";

/** The task list's agents' pull requests, as its live query holds them now. */
export interface TaskListPullRequests {
  /** The pull request of every agent of `agents` whose row keeps one. */
  readonly agentPullRequests: () => readonly ListedPullRequest[];
}

/** The pull requests of `agents`, the list's agents as it draws them, for as long as the scope stands. */
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

    return { agentPullRequests: yield* listedOf(byAgent, (row) => row.listed) };
  });
}
