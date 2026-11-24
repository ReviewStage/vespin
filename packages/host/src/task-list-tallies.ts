/**
 * task-list-tallies.ts -- each plan's agents that stand in the task list's live queries, held by plan outside them: their tally for the plan's summary and the plan's pull requests, derived again only for a plan whose agents or their graces moved.
 *
 * A plan's summary counts its agents together (`agentsTallyOf`) and its
 * pull requests are listed from all of them (`pullRequestLinesOf`), so a
 * live query of them gathers each plan's agents under it. That gathering
 * (an include, `toArray`) was most of what a busy account's first draw of
 * its live agents cost: it hashes and copies every agent's row into its join,
 * and a plan's whole group then went through the plans' query again for
 * every move. Folding the tally into one per-plan query cost each move more
 * than it saved. So the agents that stand in the queries, every agent but
 * the archived held apart (`task-list-archived.ts`), are held here too, by
 * plan, in a plain map, as the archived are: each plan's tally and lines are
 * derived again only once one of its agents or their graces moved, read
 * when the list draws, and kept the very objects while they come out equal.
 *
 * A plan moves into the plans' query as it comes to hold its first agent
 * here, and back out as its last one leaves (`task-list-collections.ts`
 * draws both), so a plan's tally is never asked of a plan with none.
 */

import { type AgentsTally, agentsTallyOf, pullRequestLinesOf } from "@repo/features/task-list-live";
import type { TaskPullRequests } from "@repo/features/task-wire";
import { deepEquals } from "@tanstack/db";
import type { AgentRow, PastGrace } from "./task-list-rows.js";

/** What one plan's agents derive together: their tally, and the plan's pull requests, none where they opened none. */
interface PlanDerived {
  readonly tally: AgentsTally;
  readonly listing: TaskPullRequests | undefined;
}

/** Each plan's agents that stand in the list's live queries, held by plan outside them. */
export interface PlanTallies {
  /**
   * Takes each of `keys` as `rowOf` draws it now: held under its plan where
   * it names a row on one, let go where it names none or a row on no plan,
   * and the plans it left or joined derived again. Answers each plan that
   * came to hold its first agent or let go of its last.
   */
  readonly drawn: (
    keys: readonly string[],
    rowOf: (key: string) => AgentRow | undefined,
  ) => readonly string[];
  /** Derives again the plan of each agent past its grace that moved, as it stood or stands now. */
  readonly graced: (moved: Iterable<PastGrace>) => void;
  /** Whether the plan `taskId` holds an agent that stands in the live queries. */
  readonly holds: (taskId: string) => boolean;
  /** What the plan `taskId`'s agents tally, the very object while it comes out equal; none where it holds none. */
  readonly tallyOf: (taskId: string) => AgentsTally | undefined;
  /** How many times what any plan's agents tally has moved, so a reader knows to draw again. */
  readonly moved: () => number;
  /** Every pull request of each plan that has one, those still open first, the newest agent's first within each; the very list until one moves. */
  readonly taskPullRequests: () => readonly TaskPullRequests[];
}

/** The task list's plans' agents, none held yet, each agent's grace read by `pastGraceOf`. */
export function planTallies(pastGraceOf: (agentId: string) => PastGrace | undefined): PlanTallies {
  /** The agents held under each plan, by the plan's id, then the agent's. */
  const rowsOf = new Map<string, Map<string, AgentRow>>();
  /** The plan each held agent is held under, by the agent's id. */
  const planOf = new Map<string, string>();
  /** What each plan's agents derived as last taken, and the plans to derive again before the next reading. */
  const derived = new Map<string, PlanDerived>();
  const stale = new Set<string>();
  let tallyMoved = 0;
  let linesMoved = 0;
  let listed: { readonly at: number; readonly list: readonly TaskPullRequests[] } | undefined;

  /** Lets `id` go from the plan it is held under, answering that plan where it held no other. */
  const letGo = (id: string): string | undefined => {
    const was = planOf.get(id);

    if (was === undefined) return undefined;
    const rows = rowsOf.get(was);
    rows?.delete(id);
    planOf.delete(id);
    stale.add(was);

    if (rows?.size !== 0) return undefined;
    rowsOf.delete(was);

    return was;
  };

  /** Derives again what the plan `taskId`'s agents derive, keeping each part that comes out equal as the very object it was. */
  const deriveAgain = (taskId: string) => {
    const rows = [...(rowsOf.get(taskId)?.values() ?? [])];
    const was = derived.get(taskId);

    if (rows.length === 0) {
      if (was === undefined) return;
      derived.delete(taskId);
      tallyMoved += 1;
      linesMoved += was.listing === undefined ? 0 : 1;

      return;
    }

    const pullRequests = pullRequestLinesOf(rows);
    // Note that an agent is past its grace under the plan its grace was marked under alone, since one moved to another is marked again under it.
    const agents = rows.map((row) => ({ row, pastGrace: pastGraceOf(row.id)?.taskId === taskId }));
    const tally = agentsTallyOf(agents, pullRequests.length);

    const listing: TaskPullRequests | undefined =
      pullRequests.length === 0 ? undefined : { taskId, pullRequests };

    const keptTally = was !== undefined && deepEquals(was.tally, tally) ? was.tally : tally;

    const keptListing =
      was !== undefined && deepEquals(was.listing, listing) ? was.listing : listing;

    if (keptTally === was?.tally && keptListing === was.listing) return;
    derived.set(taskId, { tally: keptTally, listing: keptListing });
    tallyMoved += keptTally === was?.tally ? 0 : 1;
    linesMoved += keptListing === was?.listing ? 0 : 1;
  };

  /** Derives again each plan one of whose agents or their graces moved since the last reading. */
  const settle = () => {
    for (const taskId of stale) deriveAgain(taskId);
    stale.clear();
  };

  const drawn = (
    keys: readonly string[],
    rowOf: (key: string) => AgentRow | undefined,
  ): readonly string[] => {
    const turned = new Set<string>();

    for (const key of keys) {
      const row = rowOf(key);
      const taskId = row?.taskId ?? undefined;
      const was = planOf.get(key);

      if (row !== undefined && taskId !== undefined && was === taskId) {
        // Note that a key named again with the very row it holds moves nothing.
        if (rowsOf.get(taskId)?.get(key) === row) continue;
        rowsOf.get(taskId)?.set(key, row);
        stale.add(taskId);
        continue;
      }

      const emptied = letGo(key);

      if (emptied !== undefined) turned.add(emptied);

      if (row === undefined || taskId === undefined) continue;
      const rows = rowsOf.get(taskId);

      if (rows === undefined) {
        rowsOf.set(taskId, new Map([[key, row]]));
        turned.add(taskId);
      } else rows.set(key, row);

      planOf.set(key, taskId);
      stale.add(taskId);
    }

    // Note that a plan that let go of its last agent and took up another in one drawing is answered too, which its reader draws again as it now stands.
    return [...turned];
  };

  const graced = (moved: Iterable<PastGrace>) => {
    for (const { taskId } of moved) if (taskId !== null) stale.add(taskId);
  };

  const tallyOf = (taskId: string): AgentsTally | undefined => {
    settle();

    return derived.get(taskId)?.tally;
  };

  const moved = (): number => {
    settle();

    return tallyMoved;
  };

  const taskPullRequests = (): readonly TaskPullRequests[] => {
    settle();

    if (listed?.at !== linesMoved) {
      listed = {
        at: linesMoved,
        list: [...derived.values()].flatMap(({ listing }) =>
          listing === undefined ? [] : [listing],
        ),
      };
    }

    return listed.list;
  };

  return {
    drawn,
    graced,
    holds: (taskId) => rowsOf.has(taskId),
    tallyOf,
    moved,
    taskPullRequests,
  };
}
