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
 * three (`listedAgentOf`). A plan is ordered by the plans' query, and its
 * summary is drawn outside it, from what its agents that stand in these
 * queries tally, held by plan outside them (`task-list-tallies.ts`), and
 * what its archived agents held apart from them add
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
  isNull,
  isUndefined,
  not,
} from "@tanstack/db";
import { Effect, type Scope } from "effect";
import { listedOf, type QueryCollection } from "./drawn-rows.js";
import { keyedListLog } from "./list-moves.js";
import type { Continued } from "./task-list-continuations.js";
import type { AgentRow, PastGrace, PlanRow } from "./task-list-rows.js";
import type { PlanTallies } from "./task-list-tallies.js";

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
  /** The agents started from each agent (`taskListContinuations`). */
  readonly continuations: QueryCollection<Continued>;
  /** What each plan's archived agents, held apart from `agents`, add to its summary (`task-list-archived.ts`). */
  readonly archived: ArchivedSummaries;
  /** What each plan's agents of `agents` tally, held by plan outside the queries (`task-list-tallies.ts`). */
  readonly tallies: Pick<PlanTallies, "tallyOf" | "moved">;
}

/** What the archived agents held apart from the list's live queries add to each plan's summary. */
export interface ArchivedSummaries {
  /** What the plan `taskId`'s archived agents add, the very object until one of them moves; none where it has none. */
  readonly activityOf: (taskId: string) => ArchivedActivity | undefined;
  /** How many times what any plan's archived agents add has moved, so a reader knows to draw again. */
  readonly moved: () => number;
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

/** The task list's plans and agents over `sources`, for as long as the scope stands. */
export function taskListTasks(
  sources: TaskListSources,
): Effect.Effect<TaskListTasks, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { plans, apart, agents, pastGrace, continuations, archived, tallies } = sources;

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

    // Each plan newest started first, ordered again only as its row moves; its summary is drawn outside the query.
    // Note that the summary is drawn outside the query, from what the plan's agents tally (`task-list-tallies.ts`) and what its archived agents held apart add, because carrying either through it cost more than the plans themselves: a plan's whole group went through it again for each move of one of its agents, and every plan's row for a whole answer.
    const summaries = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ plan: plans })
            .orderBy(({ plan }) => plan.createdAt, "desc")
            .orderBy(({ plan }) => plan.id, { direction: "desc", stringSort: "lexical" })
            .fn.select(({ plan }) => ({ plan })),
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

    const ordered = yield* listedOf(summaries, (row) => row.plan);
    const logged = keyedListLog<TaskSummary>((summary) => summary.id);

    /** Each plan's summary as last drawn, by the plan's row it was drawn from, with what its agents tallied and its archived agents added then. */
    const drawnOf = new WeakMap<
      PlanRow,
      {
        readonly tally: AgentsTally | undefined;
        readonly apart: ArchivedActivity | undefined;
        readonly summary: TaskSummary;
      }
    >();

    /** Each plan held apart's summary as last drawn, by its row, with what its archived agents added then. */
    const apartDrawnOf = new WeakMap<
      PlanRow,
      { readonly apart: ArchivedActivity | undefined; readonly summary: TaskSummary }
    >();

    let summarized:
      | {
          readonly from: readonly PlanRow[];
          readonly held: readonly PlanRow[];
          readonly at: number;
          readonly tallied: number;
          readonly list: readonly TaskSummary[];
        }
      | undefined;

    /** Each plan's summary, the very object while its row, what its agents tally, and what its archived agents add stand. */
    const summaryOf = (plan: PlanRow): TaskSummary => {
      const tally = tallies.tallyOf(plan.id);
      const apart = archived.activityOf(plan.id);
      const drawn = drawnOf.get(plan);

      if (drawn !== undefined && drawn.tally === tally && drawn.apart === apart) {
        return drawn.summary;
      }

      const summary = taskSummaryOf(plan, summaryOfTally(tally, apart));
      drawnOf.set(plan, { tally, apart, summary });

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
      const from = ordered();
      const held = apart.rows();
      const at = archived.moved();
      const tallied = tallies.moved();

      if (
        summarized?.from !== from ||
        summarized.held !== held ||
        summarized.at !== at ||
        summarized.tallied !== tallied
      ) {
        summarized = {
          from,
          held,
          at,
          tallied,
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
