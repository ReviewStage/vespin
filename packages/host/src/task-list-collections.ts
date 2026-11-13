/**
 * task-list-collections.ts -- the account's task list, its plans and its agents each rows of the sync engine's pool: fed by the list's follow, built at the host's own instant, and changed by a write to one row the moment it is asked.
 *
 * A plan and an agent are kinds of the pool (`@repo/sync`), one row however
 * many reads hold it, and the list stands on the rows its follow answers for
 * the signed-in session. The list is built from them as the held read built
 * it (`@repo/features/task-list-live`). The one fact of it the clock alone
 * moves, an agent with no turn yet whose starting grace ends, is held as
 * data beside the rows rather than read off a clock, since a live query
 * reads none: a local-only collection of the agents past their grace
 * (`pastGrace`), keyed by agent id, never a field written onto a synced
 * row. The one clock left here writes it, armed for the nearest grace still
 * to end while such an agent stands, and draws the list again as it does.
 * The follow's answers past a sync id are drawn once a tick
 * (`drawnPerTick`), since every draw
 * builds the whole list and pushes it to every window; a write, a whole
 * answer, and an edge draw at once. One drawer stands for
 * the scope (`taskListDrawer`), so each drawing builds again only the plans
 * and agents a moved row or that instant reaches, and every other is the
 * object drawn before.
 *
 * The agents' pull requests are TanStack DB live queries instead
 * (`task-list-pull-requests.ts`), standing on the agents as the list draws
 * them (`drawn-rows.ts`), which take only the keys the pool names as moved:
 * those an answer moved, took up, or let go, and those a write drew again.
 *
 * A write to one row, a plan's or an agent's, is a write the pool draws over
 * it at once (`compose-tasks.ts` and `compose-agents.ts` declare them),
 * standing until the list carries its transaction, or taken back where the
 * service refused it; where the list hands no wait yet, the row as the
 * write's own answer leaves it is taken in the list's place. A task started
 * is a row made on the pool under the id the host minted for it
 * (`compose-tasks.ts`), which the list shows while it stands, so it stands in
 * the list from the press, before the service answers. The tasks a write
 * stands over are the list's pending ones.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import {
  agentGraceEnd,
  type TaskListLiveRows,
  taskListDrawer,
} from "@repo/features/task-list-live";
import type {
  ListedPullRequest,
  TaskAgentPin,
  TaskListAnswer,
  TaskPullRequests,
} from "@repo/features/task-wire";
import {
  type Confirmation,
  type EntityPool,
  fieldKind,
  type HeldRows,
  type PoolRead,
  scopedCollection,
} from "@repo/sync";
import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { Effect, type Scope } from "effect";
import { drawnRows } from "./drawn-rows.js";
import { drawnAtEdges, drawnPerTick } from "./live-collection.js";
import { confirmWrite, type SyncStanding, syncIdOf, type TxWait } from "./live-follow.js";
import { taskListPullRequests } from "./task-list-pull-requests.js";

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["plans"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** A plan as the pool holds it, by its id. */
export const PLAN = fieldKind((row: PlanRow) => row.id);

/** An agent as the pool holds it, by its id. */
export const AGENT = fieldKind((row: AgentRow) => row.id);

/** An agent whose starting grace has ended, by its id, as the list holds it beside the agents' rows. */
interface PastGrace {
  readonly agentId: string;
}

/** The list as the rows make it, every agent on a plan beside it, and the plans a write stands over. */
export interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly ListedAgent[];
  readonly taskPullRequests: readonly TaskPullRequests[];
  readonly agentPullRequests: readonly ListedPullRequest[];
  readonly taskAgentPins: readonly TaskAgentPin[];
  readonly pendingTasks: readonly string[];
}

export interface TaskListDependencies {
  /** The pool the list's rows stand in. */
  readonly pool: EntityPool;
  /** Draws the list as it now stands. */
  readonly draw: (read: LiveTaskList) => void;
  /** The followed list's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** The account's task list standing in the pool, for as long as its scope stands. */
export interface TaskListCollections {
  /**
   * Takes one answer of the list's follow, both its parts, whole or past a
   * sync id, and draws it, answering whether a row the list holds moved, or
   * it took one up or let one go. One past a sync id that carries no row and
   * lets none go is neither taken nor drawn.
   */
  readonly answer: (rows: TaskListLiveRows, standing?: SyncStanding) => Effect.Effect<boolean>;
  /** The plans and agents the list holds as the service answered them, with no write drawn over them, as the entity store keeps them. */
  readonly synced: () => TaskListLiveRows;
}

/**
 * The ids a part holds after an answer: a whole one's rows alone, and one
 * past a sync id joined onto those held, less those it names gone.
 */
function joined(
  held: readonly string[],
  rows: readonly { readonly id: string }[],
  standing: SyncStanding | undefined,
): readonly string[] {
  const answered = rows.map((row) => row.id);

  if (standing?.past === undefined) return answered;
  const gone = new Set(standing.gone);

  return [...new Set([...held, ...answered])].filter((id) => !gone.has(id));
}

/** The account's task list, empty until its follow first answers. */
export function taskListCollections(
  dependencies: TaskListDependencies,
): Effect.Effect<TaskListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pool } = dependencies;
    /** The plans and the agents the list holds, by id, as its answers joined them. */
    let planKeys: readonly string[] = [];
    let agentKeys: readonly string[] = [];
    // Note that a write still standing once the scope closed draws nothing, since a sign-out closed it and its rows were the account's that left.
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );

    const confirmation = (): Confirmation | undefined => {
      const wait = dependencies.txWait();

      return wait === undefined ? undefined : (txid) => confirmWrite(wait, txid);
    };

    // Note that only the list's own follow stands on these kinds, so the pool redraws them for a write the member made, or its answer taken in the list's place: at once, so a press never waits a tick.
    const redraw = () => Effect.suspend(() => ticks.drawn);

    // Note that every plan made is the list's, since it holds every task the account reaches.
    const plans: HeldRows<PlanRow> = yield* pool.stand(PLAN, {
      redraw,
      confirmation,
      adopts: () => true,
    });

    // The agents as the list draws them, for its live queries to stand on, written only for the keys that moved.
    const drawnAgents = yield* drawnRows<AgentRow>(AGENT.key);
    const pullRequests = yield* taskListPullRequests(drawnAgents.collection);

    const agentsDrawn = (keys: readonly string[]) =>
      drawnAgents.drawn(keys, (key) => agents.row(key));

    const agentsRedraw: PoolRead<AgentRow>["redraw"] = (keys) =>
      Effect.suspend(() => {
        agentsDrawn(keys);

        return ticks.drawn;
      });

    const agents: HeldRows<AgentRow> = yield* pool.stand(AGENT, {
      redraw: agentsRedraw,
      confirmation,
    });

    const pastGrace = yield* scopedCollection(() =>
      createCollection(
        localOnlyCollectionOptions<PastGrace, string>({ getKey: (row) => row.agentId }),
      ),
    );

    /**
     * Marks past its grace every agent whose grace ended by `at`, lets go of
     * those the list no longer holds waiting on one, and answers the nearest
     * grace still to end; none where no agent waits on one.
     */
    const gracesAt = (rows: readonly AgentRow[], at: number): number | undefined => {
      const waiting = new Set<string>();
      const ended: PastGrace[] = [];
      let next: number | undefined;

      for (const row of rows) {
        const end = agentGraceEnd(row);

        if (end === undefined) continue;
        waiting.add(row.id);

        if (at < end) next = next === undefined ? end : Math.min(next, end);
        else if (!pastGrace.has(row.id)) ended.push({ agentId: row.id });
      }

      const gone = [...pastGrace.keys()].filter((id) => !waiting.has(id));

      if (ended.length > 0) pastGrace.insert(ended);

      if (gone.length > 0) pastGrace.delete(gone);

      return next;
    };

    const drawing = taskListDrawer();

    /** Draws the list as it stands now, what every standing write drew among it, the graces ended by `at` written first, and arms the next grace's end. */
    const drawn: Effect.Effect<void> = yield* drawnAtEdges((at) => {
      if (!open) return undefined;
      const rows = { plans: plans.rows(), agents: agents.rows() };
      const edge = gracesAt(rows.agents, at);

      dependencies.draw({
        ...drawing(rows, pastGrace, pullRequests.linesOf),
        taskPullRequests: pullRequests.taskPullRequests(),
        agentPullRequests: pullRequests.agentPullRequests(),
        pendingTasks: plans.pending(),
      });

      return edge;
    });

    const ticks = yield* drawnPerTick(drawn);

    return {
      answer: (rows, standing) =>
        Effect.suspend(() => {
          const nextPlans = joined(planKeys, rows.plans, standing);
          const nextAgents = joined(agentKeys, rows.agents, standing);

          // Note that an answer past a sync id carrying no row and letting none go moves nothing, as most of a busy service's do, so neither the pool nor the list is walked: the edge armed stands, and a write settles on the follow's wait.
          const still =
            standing?.past !== undefined &&
            rows.plans.length + rows.agents.length === 0 &&
            nextPlans.length === planKeys.length &&
            nextAgents.length === agentKeys.length;

          if (still) return Effect.succeed(false);
          planKeys = nextPlans;
          agentKeys = nextAgents;
          const at = syncIdOf(standing);

          const answered = (held: readonly string[]) => ({
            held,
            ...(at === undefined ? undefined : { at }),
          });

          return Effect.gen(function* () {
            const plansMoved = yield* plans.answer(rows.plans, answered(planKeys));
            const agentsMoved = yield* agents.answer(rows.agents, answered(agentKeys));
            agentsDrawn(agentsMoved);
            // Note that a whole answer, the list's first or one read again, draws at once, and one past a sync id rides the tick, since a busy account's agents answer many a second.
            yield* standing?.past === undefined ? ticks.drawn : ticks.soon;

            return plansMoved.length + agentsMoved.length > 0;
          });
        }),
      synced: () => ({ plans: plans.synced(), agents: agents.synced() }),
    };
  });
}
