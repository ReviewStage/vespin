/**
 * task-list-collections.ts -- the account's task list, its plans and its agents each rows of the sync engine's pool: fed by the list's follow, built at the host's own instant, and changed by a write to one row the moment it is asked.
 *
 * A plan and an agent are kinds of the pool (`@repo/sync`), one row however
 * many reads hold it, and the list stands on the rows its follow answers for
 * the signed-in session. The list is built from them as the held read built
 * it (`@repo/features/task-list-live`), at the host's own instant, because
 * an agent's status moves with the clock alone and a live query reads no
 * clock. So it is drawn again each time either moves, and at the nearest
 * instant the clock alone moves it (the drawing's `edge`): the one clock
 * left here, armed only while such an agent stands. One drawer stands for
 * the scope (`taskListDrawer`), so each drawing builds again only the plans
 * and agents a moved row or that instant reaches, and every other is the
 * object drawn before.
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
import { type TaskListLiveRows, taskListDrawer } from "@repo/features/task-list-live";
import type {
  ListedPullRequest,
  TaskAgentPin,
  TaskListAnswer,
  TaskPullRequests,
} from "@repo/features/task-wire";
import { type Confirmation, type EntityPool, fieldKind, type HeldRows } from "@repo/sync";
import { Effect, type Scope } from "effect";
import { drawnAtEdges } from "./live-collection.js";
import { confirmWrite, type SyncStanding, syncIdOf, type TxWait } from "./live-follow.js";

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["plans"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** A plan as the pool holds it, by its id. */
export const PLAN = fieldKind((row: PlanRow) => row.id);

/** An agent as the pool holds it, by its id. */
export const AGENT = fieldKind((row: AgentRow) => row.id);

/** The list as the rows make it at one instant, every agent on a plan beside it, and the plans a write stands over. */
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
  /** Where the follow's answers stand now, which a read outside the list is marked with as it is asked. */
  readonly mark: () => number;
  /**
   * Takes one task read outside the list, its plan and its agents, as cold
   * rows drawn beside the list's, and draws it, the read asked at `mark`;
   * each the follow holds is the follow's alone, and each it let go since
   * `mark` is gone, not drawn back by an answer read before it went.
   */
  readonly cold: (rows: TaskListLiveRows, mark: number) => Effect.Effect<void>;
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

    const redraw = () => Effect.suspend(() => drawn);

    // Note that every plan made is the list's, since it holds every task the account reaches.
    const plans: HeldRows<PlanRow> = yield* pool.stand(PLAN, {
      redraw,
      confirmation,
      adopts: () => true,
    });

    const agents: HeldRows<AgentRow> = yield* pool.stand(AGENT, { redraw, confirmation });

    /** The tasks read outside the list and their agents, by id, which the list's follow does not hold. */
    let coldPlanKeys: readonly string[] = [];
    let coldAgentKeys: readonly string[] = [];
    const coldPlans: HeldRows<PlanRow> = yield* pool.stand(PLAN, { redraw, confirmation });
    const coldAgents: HeldRows<AgentRow> = yield* pool.stand(AGENT, { redraw, confirmation });

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

    const drawing = taskListDrawer();

    /** Draws the list as it stands now, what every standing write drew among it, and arms its next edge. */
    const drawn: Effect.Effect<void> = yield* drawnAtEdges((at) => {
      if (!open) return undefined;

      const { edge, ...list } = drawing(
        { plans: beside(plans, coldPlans), agents: beside(agents, coldAgents) },
        at,
      );

      dependencies.draw({ ...list, pendingTasks: plans.pending() });

      return edge;
    });

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
            yield* drawn;

            return plansMoved.length + agentsMoved.length > 0;
          });
        }),
      synced: () => ({ plans: plans.synced(), agents: agents.synced() }),
      holds: (id) =>
        plans.holds(id) || agents.holds(id) || coldPlans.holds(id) || coldAgents.holds(id),
      mark: () => answers,
      cold: (rows, mark) =>
        Effect.gen(function* () {
          const standing = (row: { readonly id: string }) => (letGoAt.get(row.id) ?? 0) <= mark;
          const planRows = rows.plans.filter((row) => !plans.holds(row.id) && standing(row));
          const agentRows = rows.agents.filter((row) => !agents.holds(row.id) && standing(row));

          if (planRows.length + agentRows.length === 0) return;
          coldPlanKeys = [...new Set([...coldPlanKeys, ...planRows.map((row) => row.id)])];
          coldAgentKeys = [...new Set([...coldAgentKeys, ...agentRows.map((row) => row.id)])];
          yield* coldPlans.answer(planRows, { held: coldPlanKeys });
          yield* coldAgents.answer(agentRows, { held: coldAgentKeys });
          yield* redraw();
        }),
    };
  });
}
