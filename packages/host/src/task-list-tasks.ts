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
 * three (`listedAgentOf`). A plan's agents as the pull requests gather them
 * (`agentsByTask`) are joined with the few of them past their grace, and
 * tallied by one `fn.select` over the two (`agentsTallyOf`), with how many
 * pull requests they opened (`pullRequestLinesOf`). The plan is joined with
 * that one row, and its summary is drawn from the tally, outside the query,
 * with what its archived agents held apart from these queries add
 * (`task-list-archived.ts`, `summaryOfTally`). Each derivation
 * is written into a field of the query's row, never spread over it, so a
 * reader takes the derivation's own object, the very object until its row,
 * its grace, or its plan's agents move again, and the lists are built
 * again only after a query's change (`listedOf`). So one row that moves builds again its own agent and its own
 * plan, whatever the account's size, and every other is the object drawn
 * before.
 *
 * A plan none of whose agents stands in the queries, most of an account's
 * once its agents are archived (`task-list-archived.ts`), would be carried
 * through the plans' query only to be tallied from nothing, so it is held
 * apart from it (`apartPlans`): summed up straight from its row and what its
 * archived agents add, once, the very object until either moves, as the
 * query would sum it, and merged into the query's plans in the query's own
 * order (`mergedNewestFirst`). A plan moves into the query as an agent of
 * it comes to stand there, and back out as its last one leaves, which
 * `task-list-collections.ts` draws.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import {
  type AgentsTally,
  type ArchivedActivity,
  agentPinOf,
  agentsTallyOf,
  type GracedAgent,
  listedAgentOf,
  pullRequestLinesOf,
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
import type { PlanAgents } from "./task-list-pull-requests.js";
import type { AgentRow, PastGrace, PlanRow } from "./task-list-rows.js";

/** The plans held apart from the list's live queries: those none of whose agents stands in them. */
export interface ApartPlans {
  /** Takes each of `keys` as `rowOf` draws it now: held where it names a row, let go where it names none. */
  readonly drawn: (keys: readonly string[], rowOf: (key: string) => PlanRow | undefined) => void;
  /** Every plan held apart, in the plans' query's order (`newestFirst`), the very array until one moves. */
  readonly rows: () => readonly PlanRow[];
}

/** What the list's plans and agents are derived from: the rows as it draws them, and what it derives beside them. */
export interface TaskListSources {
  /** The plans one of whose agents stands in the queries; every other is held apart (`apart`). */
  readonly plans: RowCollection<PlanRow, string>;
  readonly apart: ApartPlans;
  readonly agents: RowCollection<AgentRow, string>;
  /** The agents whose starting grace has ended, by id. */
  readonly pastGrace: Collection<PastGrace, string>;
  /** Each plan's agents gathered under it (`taskListPullRequests`). */
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

/**
 * Whether `one` stands before `other` as the plans' query orders them:
 * the newest started first, and the greater id first among those started at
 * one instant, by its characters' codes, as the query's lexical sort reads it.
 */
function newestFirst(
  one: { readonly createdAt: number; readonly id: string },
  other: { readonly createdAt: number; readonly id: string },
): number {
  if (one.createdAt !== other.createdAt) return other.createdAt - one.createdAt;

  return one.id > other.id ? -1 : one.id < other.id ? 1 : 0;
}

/** The plans held apart from the list's live queries, by id, listed in the plans' query's order as one moves. */
export function apartPlans(): ApartPlans {
  const held = new Map<string, PlanRow>();
  let listed: readonly PlanRow[] | undefined = [];

  return {
    drawn: (keys, rowOf) => {
      for (const key of keys) {
        const row = rowOf(key);

        if (row === undefined) {
          if (held.delete(key)) listed = undefined;
        } else if (held.get(key) !== row) {
          held.set(key, row);
          listed = undefined;
        }
      }
    },
    rows: () => {
      listed ??= [...held.values()].sort(newestFirst);

      return listed;
    },
  };
}

/** The plans' summaries `live` and `apart`, each in the plans' query's order, as one list in that order; `live` itself where none is held apart. */
function mergedNewestFirst(
  live: readonly TaskSummary[],
  apart: readonly TaskSummary[],
): readonly TaskSummary[] {
  if (apart.length === 0) return live;

  if (live.length === 0) return apart;

  const merged: TaskSummary[] = [];
  let right = 0;

  for (const summary of live) {
    // Note that no plan stands in both lists, so none ties.
    for (let next = apart[right]; next !== undefined && newestFirst(next, summary) < 0; ) {
      merged.push(next);
      right += 1;
      next = apart[right];
    }

    merged.push(summary);
  }

  merged.push(...apart.slice(right));

  return merged;
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
    const { plans, apart, agents, pastGrace, agentsByTask, continuations, archived } = sources;

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

    // Each plan's agents tallied with their graces and how many pull requests they opened, derived again only as one of them or their graces move.
    // Note that the pull requests are counted here from the plan's lines, the same `pullRequestLinesOf` the plan's own lines are listed by (`task-list-pull-requests.ts`), so a plan joins one row of its agents rather than their lines too.
    const tallies = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ group: agentsByTask })
            .fullJoin({ graced: graces }, ({ group, graced }) => eq(group.taskId, graced.taskId))
            .where(({ group }) => not(isUndefined(group.taskId)))
            .fn.select(({ group, graced }) => {
              const { taskId, agents: rows } = mainOf(group);

              return {
                taskId,
                tally: agentsTallyOf(
                  gracedOf(rows, graced?.agentIds),
                  pullRequestLinesOf(rows).length,
                ),
              };
            }),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    // Each plan with its agents tallied, newest started first, derived again only as its row or what its agents derive moves.
    // Note that the plan joins its agents' one tallied row, never their group, lines, and graces apiece, because joining the group carried each plan's agents through this query's joins and order again, about a sixth of the time a busy account's kept agents took to draw.
    // Note that the summary is drawn from the tally outside the query, with what the plan's archived agents held apart add, because joining that in made every plan's row move through the query again for a whole answer, the most of what an account's archived agents cost it.
    const summaries = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ plan: plans })
            .fullJoin({ agents: tallies }, ({ plan, agents }) => eq(plan.id, agents.taskId))
            .where(({ plan }) => not(isUndefined(plan.id)))
            .orderBy(({ plan }) => plan.createdAt, "desc")
            .orderBy(({ plan }) => plan.id, { direction: "desc", stringSort: "lexical" })
            .fn.select(({ plan, agents }) => ({
              tallied: { plan: mainOf(plan), tally: agents?.tally } satisfies TalliedPlan,
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

    /** Each plan held apart's summary as last drawn, by its row, with what its archived agents added then. */
    const apartDrawnOf = new WeakMap<
      PlanRow,
      { readonly apart: ArchivedActivity | undefined; readonly summary: TaskSummary }
    >();

    let summarized:
      | {
          readonly from: readonly TalliedPlan[];
          readonly held: readonly PlanRow[];
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

    /** A plan held apart's summary, tallied from no agent, as the query sums up a plan none of whose agents stands in it; the very object while its row and what its archived agents add stand. */
    const apartSummaryOf = (plan: PlanRow): TaskSummary => {
      const activity = archived.activityOf(plan.id);
      const drawn = apartDrawnOf.get(plan);

      if (drawn?.apart === activity && drawn !== undefined) return drawn.summary;
      const summary = taskSummaryOf(plan, summaryOfTally(undefined, activity));
      apartDrawnOf.set(plan, { apart: activity, summary });

      return summary;
    };

    const summariesNow = (): readonly TaskSummary[] => {
      const from = tallied();
      const held = apart.rows();
      const at = archived.moved();

      if (summarized?.from !== from || summarized.held !== held || summarized.at !== at) {
        summarized = {
          from,
          held,
          at,
          list: logged(mergedNewestFirst(from.map(summaryOf), held.map(apartSummaryOf))),
        };
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
