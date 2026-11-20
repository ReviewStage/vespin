/**
 * task-list-tasks.ts -- the task list's plans and agents as TanStack DB live queries over its drawn plans and agents: each agent as the tabs draw it, each plan with its agents in brief, and the pins, derived again only for a row that moved, a grace that ended, or a plan whose agents did.
 *
 * Follows the list's pull requests (`task-list-pull-requests.ts`, whose
 * header says how). Each query stands on the rows as the list draws them
 * (`drawn-rows.ts`), so a write the member makes reaches it at once, and on
 * the agents past their starting grace (`pastGrace`), a local-only
 * collection the list writes as each grace ends, so nothing here reads a
 * clock. An agent is joined with its grace and with the agents started from
 * it (`task-list-continuations.ts`), and drawn by a `fn.select` over the
 * three (`listedAgentOf`). A plan is joined with its agents as the pull
 * requests gather them (`agentsByTask`), its pull requests, and the few of
 * its agents past their grace, and its agents are tallied by a `fn.select`
 * over the four (`agentsTallyOf`); its summary is drawn from that tally,
 * outside the query, with what its archived agents held apart from these
 * queries add (`task-list-archived.ts`, `summaryOfTally`). Each derivation
 * is written into a field of the query's row, never spread over it, so a
 * reader takes the derivation's own object, the very object until its row,
 * its grace, or its plan's agents move again, and the lists are built
 * again only after a query's change (`listedOf`). So one row that moves builds again its own agent and its own
 * plan, whatever the account's size, and every other is the object drawn
 * before.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import {
  type AgentsTally,
  type ArchivedActivity,
  agentPinOf,
  agentsTallyOf,
  type GracedAgent,
  listedAgentOf,
  summaryOfTally,
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
import { keyedListLog } from "./list-moves.js";
import type { Continued } from "./task-list-continuations.js";
import type { PlanAgents, PlanPullRequests } from "./task-list-pull-requests.js";
import type { AgentRow, PastGrace, PlanRow } from "./task-list-rows.js";

/** What the list's plans and agents are derived from: the rows as it draws them, and what it derives beside them. */
export interface TaskListSources {
  readonly plans: RowCollection<PlanRow, string>;
  readonly agents: RowCollection<AgentRow, string>;
  /** The agents whose starting grace has ended, by id. */
  readonly pastGrace: Collection<PastGrace, string>;
  /** Each plan's pull requests, and its agents gathered under it (`taskListPullRequests`). */
  readonly pullRequests: QueryCollection<PlanPullRequests>;
  readonly agentsByTask: QueryCollection<PlanAgents>;
  /** The agents started from each agent (`taskListContinuations`). */
  readonly continuations: QueryCollection<Continued>;
  /** What each plan's archived agents, held apart from `agents`, add to its summary (`task-list-archived.ts`). */
  readonly archived: ArchivedSummaries;
}

/** What the archived agents held apart from the list's live queries add to each plan's summary. */
export interface ArchivedSummaries {
  /** What the plan `taskId`'s archived agents add, the very object until one of them moves; none where it has none. */
  readonly activityOf: (taskId: string) => ArchivedActivity | undefined;
  /** How many times what any plan's archived agents add has moved, so a reader knows to draw again. */
  readonly moved: () => number;
}

/** One plan as its query derives it: its row, and its agents but the archived held apart, tallied; none where it has none. */
interface TalliedPlan {
  readonly plan: PlanRow;
  readonly tally: AgentsTally | undefined;
}

/** The task list's plans and agents, as its live queries hold them now. */
export interface TaskListTasks {
  /** The plans newest started first, each with its agents in brief. */
  readonly plans: () => readonly TaskSummary[];
  /** Every agent of `agents`, first started first: the archived held apart from them are not among them. */
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

/** A plan's agents, each with whether its grace has ended, `pastGrace` naming those whose has. */
function gracedOf(
  agents: readonly AgentRow[],
  pastGrace: readonly string[] | undefined,
): readonly GracedAgent[] {
  const ended = new Set(pastGrace);

  return agents.map((row) => ({ row, pastGrace: ended.has(row.id) }));
}

/** The task list's plans and agents over `sources`, for as long as the scope stands. */
export function taskListTasks(
  sources: TaskListSources,
): Effect.Effect<TaskListTasks, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { plans, agents, pastGrace, pullRequests, agentsByTask, continuations, archived } =
      sources;

    // Each agent as the tabs draw it, first started first, and by id among those started at one instant, derived again only as its row, its grace, or those started from it move.
    const listed = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: agents })
            .fullJoin({ grace: pastGrace }, ({ agent, grace }) => eq(agent.id, grace.agentId))
            .fullJoin({ continued: continuations }, ({ agent, continued }) =>
              eq(agent.id, continued.agentId),
            )
            .where(({ agent }) => not(isUndefined(agent.id)))
            .orderBy(({ agent }) => agent.createdAt)
            .orderBy(({ agent }) => agent.id, { stringSort: "lexical" })
            .fn.select(({ agent, grace, continued }) => ({
              listed: listedAgentOf(mainOf(agent), grace !== undefined, continued?.continuedBy),
            })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan with an agent past its grace, once, and those agents gathered under it: a handful, whatever the account's size.
    const gracedPlans = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ grace: pastGrace })
            .groupBy(groupKeys(({ grace }) => grace.taskId))
            .select(({ grace }) => ({ taskId: grace.taskId })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    const graces = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q.from({ plan: gracedPlans }).select(({ plan }) => ({
            taskId: plan.taskId,
            agentIds: toArray(
              q
                .from({ grace: pastGrace })
                .where(({ grace }) => eq(grace.taskId, plan.taskId))
                .select(({ grace }) => grace.agentId),
            ),
          })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan with its agents tallied, newest started first, derived again only as its row, its agents, or their graces move.
    // Note that the summary is drawn from the tally outside the query, with what the plan's archived agents held apart add, because joining that in made every plan's row move through the query again for a whole answer, the most of what an account's archived agents cost it.
    const summaries = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ plan: plans })
            .fullJoin({ group: agentsByTask }, ({ plan, group }) => eq(plan.id, group.taskId))
            .fullJoin({ lines: pullRequests }, ({ plan, lines }) => eq(plan.id, lines.taskId))
            .fullJoin({ graced: graces }, ({ plan, graced }) => eq(plan.id, graced.taskId))
            .where(({ plan }) => not(isUndefined(plan.id)))
            .orderBy(({ plan }) => plan.createdAt, "desc")
            .orderBy(({ plan }) => plan.id, { direction: "desc", stringSort: "lexical" })
            .fn.select(({ plan, group, lines, graced }) => ({
              tallied: {
                plan: mainOf(plan),
                tally:
                  group === undefined
                    ? undefined
                    : agentsTallyOf(
                        gracedOf(group.agents, graced?.agentIds),
                        lines?.listing?.pullRequests.length ?? 0,
                      ),
              } satisfies TalliedPlan,
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

    const tallied = yield* listedOf(summaries, (row) => row.tallied);
    const logged = keyedListLog<TaskSummary>((summary) => summary.id);

    /** Each plan's summary as last drawn, by the tallied plan it was drawn from, with what its archived agents added then. */
    const drawnOf = new WeakMap<
      TalliedPlan,
      { readonly apart: ArchivedActivity | undefined; readonly summary: TaskSummary }
    >();

    let summarized:
      | {
          readonly from: readonly TalliedPlan[];
          readonly at: number;
          readonly list: readonly TaskSummary[];
        }
      | undefined;

    /** Each plan's summary, the very object while its tallied plan and what its archived agents add stand. */
    const summaryOf = (each: TalliedPlan): TaskSummary => {
      const apart = archived.activityOf(each.plan.id);
      const drawn = drawnOf.get(each);

      if (drawn?.apart === apart && drawn !== undefined) return drawn.summary;
      const summary = taskSummaryOf(each.plan, summaryOfTally(each.tally, apart));
      drawnOf.set(each, { apart, summary });

      return summary;
    };

    const summariesNow = (): readonly TaskSummary[] => {
      const from = tallied();
      const at = archived.moved();

      if (summarized?.from !== from || summarized.at !== at) {
        summarized = { from, at, list: logged(from.map(summaryOf)) };
      }

      return summarized.list;
    };

    return {
      plans: summariesNow,
      taskAgents: yield* listedOf(listed, (row) => row.listed),
      taskAgentPins: yield* listedOf(pins, (row) => row.pin),
    };
  });
}
