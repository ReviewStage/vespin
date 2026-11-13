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
 * The agents' pull requests and the agents started from each are TanStack
 * DB live queries instead (`task-list-pull-requests.ts`,
 * `task-list-continuations.ts`), standing on the agents as the list draws
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
 *
 * A task a window opens that the list does not hold is read once from the
 * service with its agents (`compose-tasks.ts`) and stands in the pool on
 * reads of its own, the cold ones (`cold`), drawn into the list beside the
 * rows its follow answers and kept for as long as the scope stands, so a
 * second open reads nothing. They are one row with the list's where both
 * hold it, so a write draws over a cold task as over any, and a cold task
 * the follow comes to answer, as one edited or reopened does, is the list's
 * again and no longer cold.
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
import { taskListContinuations } from "./task-list-continuations.js";
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
  /** Whether the list draws the task or the agent `id` names, from its follow or as a cold one. */
  readonly holds: (id: string) => boolean;
  /** Marks a read outside the list as it is asked: where the follow's answers stand, and its own place among such reads. */
  readonly mark: () => ColdMark;
  /**
   * Takes one task read outside the list, its plan and its agents, as cold
   * rows drawn beside the list's, and draws it, the read asked at `mark`;
   * each the follow holds is the follow's alone, each it let go since
   * `mark` is gone, not drawn back by an answer read before it went, and
   * each a read asked later already drew stands as that one drew it.
   */
  readonly cold: (rows: TaskListLiveRows, mark: ColdMark) => Effect.Effect<void>;
}

/** Where a read outside the list was asked: the follow's answers given by then, and how many such reads were asked before it. */
export interface ColdMark {
  readonly answers: number;
  readonly asked: number;
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
    /** How many answers the follow gave, and the answer each id it let go was let go at. */
    let answers = 0;
    const letGoAt = new Map<string, number>();
    /** How many reads outside the list were asked, and the newest read each cold row was drawn from. */
    let coldAsked = 0;
    const coldDrawnBy = new Map<string, number>();
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
    const continuedOf = yield* taskListContinuations(drawnAgents.collection);

    // Note that an agent the follow does not hold is drawn as its cold read left it, where one did.
    const agentsDrawn = (keys: readonly string[]) =>
      drawnAgents.drawn(keys, (key) => agents.row(key) ?? coldAgents.row(key));

    const agentsRedraw: PoolRead<AgentRow>["redraw"] = (keys) =>
      Effect.suspend(() => {
        agentsDrawn(keys);

        return ticks.drawn;
      });

    const agents: HeldRows<AgentRow> = yield* pool.stand(AGENT, {
      redraw: agentsRedraw,
      confirmation,
    });

    /** The tasks read outside the list and their agents, by id, which the list's follow does not hold. */
    let coldPlanKeys: readonly string[] = [];
    let coldAgentKeys: readonly string[] = [];
    const coldPlans: HeldRows<PlanRow> = yield* pool.stand(PLAN, { redraw, confirmation });

    const coldAgents: HeldRows<AgentRow> = yield* pool.stand(AGENT, {
      redraw: agentsRedraw,
      confirmation,
    });

    /** The rows `live` shows, then each of `cold`'s it does not. */
    const beside = <Row extends { readonly id: string }>(
      live: HeldRows<Row>,
      cold: HeldRows<Row>,
    ): readonly Row[] => {
      const coldRows = cold.rows().filter((row) => !live.holds(row.id));

      return coldRows.length === 0 ? live.rows() : [...live.rows(), ...coldRows];
    };

    /** The cold keys the list's follow holds no more of, standing on the cold reads alone. */
    const settleCold = Effect.suspend(() => {
      const planKeys = coldPlanKeys.filter((id) => !plans.holds(id));
      const agentKeys = coldAgentKeys.filter((id) => !agents.holds(id));

      if (planKeys.length === coldPlanKeys.length && agentKeys.length === coldAgentKeys.length) {
        return Effect.void;
      }

      coldPlanKeys = planKeys;
      coldAgentKeys = agentKeys;

      return Effect.asVoid(
        Effect.all([
          coldPlans.answer([], { held: coldPlanKeys }),
          coldAgents.answer([], { held: coldAgentKeys }),
        ]),
      );
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
      const rows = { plans: beside(plans, coldPlans), agents: beside(agents, coldAgents) };
      const edge = gracesAt(rows.agents, at);

      dependencies.draw({
        ...drawing(rows, pastGrace, pullRequests.linesOf, continuedOf),
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
          answers += 1;
          const kept = new Set([...nextPlans, ...nextAgents]);

          for (const id of [...planKeys, ...agentKeys]) {
            if (!kept.has(id)) letGoAt.set(id, answers);
          }

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
            // Note that a cold task the follow now answers is the follow's alone, so one it later lets go is gone from the list too.
            yield* settleCold;
            agentsDrawn(agentsMoved);
            // Note that a whole answer, the list's first or one read again, draws at once, and one past a sync id rides the tick, since a busy account's agents answer many a second.
            yield* standing?.past === undefined ? ticks.drawn : ticks.soon;

            return plansMoved.length + agentsMoved.length > 0;
          });
        }),
      synced: () => ({ plans: plans.synced(), agents: agents.synced() }),
      holds: (id) =>
        plans.holds(id) || agents.holds(id) || coldPlans.holds(id) || coldAgents.holds(id),
      mark: () => {
        coldAsked += 1;

        return { answers, asked: coldAsked };
      },
      cold: (rows, mark) =>
        Effect.gen(function* () {
          // Note that two reads outside the list may answer one row, a task's and one of its agents', so a row a later-asked read drew is not drawn back as an earlier one read it.
          const standing = (row: { readonly id: string }) =>
            (letGoAt.get(row.id) ?? 0) <= mark.answers &&
            (coldDrawnBy.get(row.id) ?? 0) <= mark.asked;

          const planRows = rows.plans.filter((row) => !plans.holds(row.id) && standing(row));

          // Note that an agent stands only where its task's snapshot does, so an earlier read draws back no agent a later one of its task left out.
          const agentRows = rows.agents.filter(
            (row) =>
              !agents.holds(row.id) &&
              standing(row) &&
              (row.planId === null || standing({ id: row.planId })),
          );

          if (planRows.length + agentRows.length === 0) return;

          // Note that a task's snapshot answers every agent of it, so a cold agent of a task drawn here that it leaves out is gone, and marked so an earlier read draws it not back.
          const tasksDrawn = new Set(planRows.map((row) => row.id));
          const answered = new Set(agentRows.map((row) => row.id));
          const inSnapshot = new Set(rows.agents.map((row) => row.id));

          const omitted = coldAgentKeys.filter(
            (id) => !inSnapshot.has(id) && tasksDrawn.has(coldAgents.row(id)?.planId ?? ""),
          );

          for (const id of [...tasksDrawn, ...answered, ...omitted]) {
            coldDrawnBy.set(id, mark.asked);
          }

          const gone = new Set(omitted);
          coldPlanKeys = [...new Set([...coldPlanKeys, ...tasksDrawn])];
          coldAgentKeys = [...new Set([...coldAgentKeys, ...answered])].filter(
            (id) => !gone.has(id),
          );
          yield* coldPlans.answer(planRows, { held: coldPlanKeys });
          yield* coldAgents.answer(agentRows, { held: coldAgentKeys });
          agentsDrawn([...answered, ...omitted]);
          yield* redraw();
        }),
    };
  });
}
