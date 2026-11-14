/**
 * task-list-continuations.ts -- the agents started from each agent of the task list, as a TanStack DB live query over its drawn agents, derived again only for an agent one started from it moved under.
 *
 * Stands on the list's agents as it draws them (`drawn-rows.ts`), as its
 * pull requests do (`task-list-pull-requests.ts`, whose header says how): each
 * agent another was started from, once (`groupKeys`), with the agents
 * started from it gathered by an include (`toArray`), first started first,
 * and the summary's list of them a `fn.select` over that group
 * (`continuedByOf`). That list is written into a field of the query's row,
 * never spread over it, so the agent's own query (`task-list-tasks.ts`)
 * joins the very object until one of that agent's continuations moves again.
 */

import { type ContinuedBy, continuedByOf } from "@repo/features/task-list-live";
import { KEPT_BY_SCOPE, type RowCollection, scopedCollection } from "@repo/sync";
import { createLiveQueryCollection, eq, groupKeys, isNull, not, toArray } from "@tanstack/db";
import { Effect, type Scope } from "effect";
import type { QueryCollection } from "./drawn-rows.js";
import type { AgentRow } from "./task-list-collections.js";

/** One agent another was started from, and the agents started from it as its summary names them (`continuedBy`). */
export interface Continued {
  readonly agentId: string | undefined;
  readonly continuedBy: ContinuedBy;
}

/** The agents started from each agent of `agents`, the list's agents as it draws them, by the agent they were started from, for as long as the scope stands. */
export function taskListContinuations(
  agents: RowCollection<AgentRow, string>,
): Effect.Effect<QueryCollection<Continued>, never, Scope.Scope> {
  return Effect.gen(function* () {
    // Each agent another was started from, once.
    const sources = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: agents })
            .where(({ agent }) => not(isNull(agent.startedFrom)))
            .groupBy(groupKeys(({ agent }) => agent.startedFrom?.agentId))
            .select(({ agent }) => ({ agentId: agent.startedFrom?.agentId })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // The agents started from each, first started first, and by id among those started at one instant.
    const groups = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ source: sources }).select(({ source }) => ({
            agentId: source.agentId,
            agents: toArray(
              q
                .from({ agent: agents })
                .where(({ agent }) => eq(agent.startedFrom?.agentId, source.agentId))
                .orderBy(({ agent }) => agent.createdAt)
                .orderBy(({ agent }) => agent.id, { stringSort: "lexical" }),
            ),
          })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each agent's continuations as its summary names them, derived again only as one of them moves.
    return yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ group: groups }).fn.select(({ group }) => ({
            agentId: group.agentId,
            continuedBy: continuedByOf(group.agents),
          })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );
  });
}
