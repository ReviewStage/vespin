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
 * (`drawnPerTick`), since every draw pushes the list to every window; a
 * write, a whole answer, and an edge draw at once.
 *
 * Everything the list derives is a TanStack DB live query: its plans and
 * agents with their pins (`task-list-tasks.ts`), the agents' pull requests
 * (`task-list-pull-requests.ts`), the agents started from each
 * (`task-list-continuations.ts`), and the agents whose status waits on a
 * grace (`waiting`). Each stands on the plans and agents as the list draws
 * them (`drawn-rows.ts`), which take only the keys the pool names as moved:
 * those an answer moved, took up, or let go, and those a write drew again.
 * So each drawing builds again only the plans and agents a moved row or an
 * ended grace reaches, and every other is the object drawn before, whatever
 * the account's size.
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
 *
 * The follow answers a task deleted and one that only left its set alike,
 * as gone, so a cold read that answers a task the follow let go while it
 * was out cannot say which it was. Such a task is read again
 * (`readAgain`), asked after the let-go, and that answer settles it: a task
 * deleted answers nothing, one that left lands. A task let go again while
 * that read is out is read again a few times at most (`RECHECKS`), then
 * left undrawn.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { agentGraceEnd, standsLive, type TaskListLiveRows } from "@repo/features/task-list-live";
import type {
  ListedPullRequest,
  TaskAgentPin,
  TaskListAnswer,
  TaskPullRequests,
} from "@repo/features/task-wire";
import {
  type Answered,
  type Confirmation,
  type EntityPool,
  fieldKind,
  type HeldRows,
  KEPT_BY_SCOPE,
  type PoolRead,
  scopedCollection,
} from "@repo/sync";
import {
  createCollection,
  createLiveQueryCollection,
  localOnlyCollectionOptions,
} from "@tanstack/db";
import { Effect, FiberSet, type Scope } from "effect";
import { drawnRows } from "./drawn-rows.js";
import { drawnAtEdges, drawnPerTick } from "./live-collection.js";
import { confirmWrite, type SyncStanding, syncIdOf, type TxWait } from "./live-follow.js";
import { taskListContinuations } from "./task-list-continuations.js";
import { taskListPullRequests } from "./task-list-pull-requests.js";
import { taskListTasks } from "./task-list-tasks.js";
import { timeOrdered } from "./time-ordered.js";

/** How many times a task the follow let go while a cold read of it was out is read again before it is left undrawn. */
const RECHECKS = 3;

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["tasks"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** A plan as the pool holds it, by its id. */
export const PLAN = fieldKind((row: PlanRow) => row.id);

/** An agent as the pool holds it, by its id. */
export const AGENT = fieldKind((row: AgentRow) => row.id);

/** An agent whose starting grace has ended, by its id, with its plan's, as the list holds it beside the agents' rows. */
export interface PastGrace {
  readonly agentId: string;
  readonly taskId: string;
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
  /** The task or the agent `id` names read again from the service with the task's agents, as a cold read reads it; none where the service did not answer. */
  readonly readAgain: (id: string) => Effect.Effect<TaskListLiveRows | undefined>;
}

/** The account's task list standing in the pool, for as long as its scope stands. */
export interface TaskListCollections {
  /**
   * Takes one answer of the list's follow, both its parts, whole or past a
   * sync id, and draws it, answering whether a row the list holds moved, or
   * it took one up or let one go. Where it names the `liveSince` the service
   * bound it at, each task that no longer stands live by it (`standsLive`)
   * is let go with its agents. One past a sync id that carries no row and
   * lets none go is neither taken nor drawn.
   */
  readonly answer: (
    rows: TaskListLiveRows,
    standing?: SyncStanding,
    liveSince?: number,
  ) => Effect.Effect<boolean>;
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
   * `mark` is read again rather than drawn from an answer read before it
   * went, and each a read asked later already drew stands as that one drew
   * it.
   */
  readonly cold: (rows: TaskListLiveRows, mark: ColdMark) => Effect.Effect<void>;
}

/** Where a read outside the list was asked: the follow's answers given by then, and how many such reads were asked before it. */
export interface ColdMark {
  readonly answers: number;
  readonly asked: number;
}

/** The most rows the list's live queries take in one stretch, so a first answer of a large account never holds the process for the whole build. */
const DRAWN_CHUNK = 500;

/** Hands `keys` to `draw` a chunk at a time, yielding between chunks; at once where they fit one. */
function inChunks(
  keys: readonly string[],
  draw: (keys: readonly string[]) => void,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let at = 0; at < keys.length; at += DRAWN_CHUNK) {
      if (at > 0) yield* Effect.yieldNow;
      draw(keys.slice(at, at + DRAWN_CHUNK));
    }
  });
}

/**
 * The tasks of `candidates` that no longer stand live as of `liveSince`
 * (`standsLive`), each read as `planOf` shows it, a task pinned through one
 * of its agents (`pinnedThroughAgent`) standing by that pin.
 */
function agedOut(
  candidates: Iterable<string>,
  planOf: (id: string) => PlanRow | undefined,
  pinnedThroughAgent: (taskId: string) => boolean,
  liveSince: number,
): ReadonlySet<string> {
  const left = new Set<string>();

  for (const id of candidates) {
    const plan = planOf(id);

    if (plan !== undefined && !standsLive(plan, pinnedThroughAgent(id), liveSince)) left.add(id);
  }

  return left;
}

/** The account's task list, empty until its follow first answers. */
export function taskListCollections(
  dependencies: TaskListDependencies,
): Effect.Effect<TaskListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pool } = dependencies;
    /** The plans and the agents the list holds, by id, as its answers joined them, in the order they came. */
    let planKeys = new Set<string>();
    let agentKeys = new Set<string>();
    // Note that an answer past a sync id names only what moved, so the list keeps, as each row is drawn, what it needs to settle one without walking every row: the plans that could age out, by when each was last touched, and the agents of each plan.
    const mayAge = timeOrdered();
    const agentsOfTask = new Map<string, Set<string>>();
    const taskOfAgent = new Map<string, string>();
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

    // The plans and agents as the list draws them, for its live queries to stand on, written only for the keys that moved.
    const drawnPlans = yield* drawnRows<PlanRow>(PLAN.key);
    const drawnAgents = yield* drawnRows<AgentRow>(AGENT.key);

    // Note that a plan the follow does not hold is drawn as its cold read left it, where one did.
    const plansDrawn = (keys: readonly string[]) => {
      for (const key of keys) {
        const row = plans.row(key);

        // Note that a plan stands live at every instant but its last touch only where it is settled and unpinned, so those alone may age out.
        if (row === undefined || standsLive(row, false, Number.POSITIVE_INFINITY)) {
          mayAge.delete(key);
        } else mayAge.set(key, row.updatedAt);
      }

      drawnPlans.drawn(keys, (key) => plans.row(key) ?? coldPlans.row(key));
    };

    const plansRedraw: PoolRead<PlanRow>["redraw"] = (keys) =>
      Effect.suspend(() => {
        plansDrawn(keys);

        return ticks.drawn;
      });

    // Note that every plan made is the list's, since it holds every task the account reaches.
    const plans: HeldRows<PlanRow> = yield* pool.stand(PLAN, {
      redraw: plansRedraw,
      confirmation,
      adopts: () => true,
    });

    // Note that an agent the follow does not hold is drawn as its cold read left it, where one did.
    const agentsDrawn = (keys: readonly string[]) => {
      for (const key of keys) {
        const taskId = agents.row(key)?.taskId ?? undefined;
        const was = taskOfAgent.get(key);

        if (was === taskId) continue;

        if (was !== undefined) agentsOfTask.get(was)?.delete(key);

        if (was !== undefined && agentsOfTask.get(was)?.size === 0) agentsOfTask.delete(was);

        if (taskId === undefined) {
          taskOfAgent.delete(key);
          continue;
        }

        taskOfAgent.set(key, taskId);
        agentsOfTask.set(taskId, (agentsOfTask.get(taskId) ?? new Set()).add(key));
      }

      drawnAgents.drawn(keys, (key) => agents.row(key) ?? coldAgents.row(key));
    };

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

    const coldPlans: HeldRows<PlanRow> = yield* pool.stand(PLAN, {
      redraw: plansRedraw,
      confirmation,
    });

    const coldAgents: HeldRows<AgentRow> = yield* pool.stand(AGENT, {
      redraw: agentsRedraw,
      confirmation,
    });

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

    // The agents whose status waits on a grace, and when each grace ends, derived again only as an agent's row moves.
    const waiting = yield* scopedCollection(() =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ agent: drawnAgents.collection })
            .fn.where(({ agent }) => agentGraceEnd(agent) !== undefined)
            .fn.select(({ agent }) => ({
              agentId: agent.id,
              taskId: agent.taskId,
              end: agentGraceEnd(agent),
            })),
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
      }),
    );

    const pullRequests = yield* taskListPullRequests(drawnAgents.collection);
    const continuations = yield* taskListContinuations(drawnAgents.collection);

    const tasks = yield* taskListTasks({
      plans: drawnPlans.collection,
      agents: drawnAgents.collection,
      pastGrace,
      pullRequests: pullRequests.byTask,
      agentsByTask: pullRequests.agentsByTask,
      continuations,
    });

    /**
     * Marks past its grace every agent whose grace ended by `at`, lets go of
     * those the list no longer holds waiting on one, and answers the nearest
     * grace still to end; none where no agent waits on one.
     */
    const gracesAt = (at: number): number | undefined => {
      const waits = new Set<string>();
      const ended: PastGrace[] = [];
      let next: number | undefined;

      for (const { agentId, taskId, end } of waiting.values()) {
        if (end === undefined) continue;
        waits.add(agentId);

        if (at < end) next = next === undefined ? end : Math.min(next, end);
        else if (pastGrace.get(agentId)?.taskId !== taskId) ended.push({ agentId, taskId });
      }

      // Note that an agent moved to another plan is marked again under it, so it is let go first.
      const gone = [...pastGrace.keys()].filter(
        (id) => !waits.has(id) || ended.some((each) => each.agentId === id),
      );

      if (gone.length > 0) pastGrace.delete(gone);

      if (ended.length > 0) pastGrace.insert(ended);

      return next;
    };

    /** The list as last drawn, one object for as long as its plans are. */
    let list: TaskListAnswer | undefined;

    /** Draws the list as it stands now, what every standing write drew among it, the graces ended by `at` written first, and arms the next grace's end. */
    const drawn: Effect.Effect<void> = yield* drawnAtEdges((at) => {
      if (!open) return undefined;
      const edge = gracesAt(at);
      const listed = tasks.plans();

      if (list?.tasks !== listed) list = { tasks: listed };

      dependencies.draw({
        list,
        taskAgents: tasks.taskAgents(),
        taskAgentPins: tasks.taskAgentPins(),
        taskPullRequests: pullRequests.taskPullRequests(),
        agentPullRequests: pullRequests.agentPullRequests(),
        pendingTasks: plans.pending(),
      });

      return edge;
    });

    const ticks = yield* drawnPerTick(drawn);

    const mark = (): ColdMark => {
      coldAsked += 1;

      return { answers, asked: coldAsked };
    };

    /** The reads again of tasks the follow let go while a cold read of them was out, each drawn by its own mark as any cold read is. */
    const rechecks = yield* FiberSet.make<void>();

    /** Reads the task `id` names again, marked before it is asked, and draws its answer as the `tries`th read again. */
    const recheck = (id: string, tries: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const at = mark();
        const rows = yield* dependencies.readAgain(id);

        if (rows !== undefined && open) yield* drawnCold(rows, at, tries);
      });

    /** Draws one cold read's answer, asked at `at`, which is the `tries`th read again of its tasks; none for a first read. */
    const drawnCold = (rows: TaskListLiveRows, at: ColdMark, tries: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const letGoSince = (id: string) => (letGoAt.get(id) ?? 0) > at.answers;
        // Note that two reads outside the list may answer one row, a task's and one of its agents', so a row a later-asked read drew is not drawn back as an earlier one read it.
        const drawnLater = (id: string) => (coldDrawnBy.get(id) ?? 0) > at.asked;

        const standing = (row: { readonly id: string }) =>
          !letGoSince(row.id) && !drawnLater(row.id);

        // Note that the follow answers a task deleted and one that only left its set alike, as gone, so one it let go while this read was out is neither drawn nor dropped but read again, asked after the let-go, whose answer settles which it was.
        const letGo = new Set([
          ...rows.tasks
            .filter((row) => !plans.holds(row.id) && letGoSince(row.id) && !drawnLater(row.id))
            .map((row) => row.id),
          ...rows.agents
            .filter(
              (row) =>
                !agents.holds(row.id) &&
                !drawnLater(row.id) &&
                (letGoSince(row.id) || (row.taskId !== null && letGoSince(row.taskId))),
            )
            .map((row) => row.taskId ?? row.id),
        ]);

        if (tries < RECHECKS) {
          for (const id of letGo) yield* FiberSet.run(rechecks, recheck(id, tries + 1));
        }

        const planRows = rows.tasks.filter((row) => !plans.holds(row.id) && standing(row));

        // Note that an agent stands only where its task's snapshot does, so an earlier read draws back no agent a later one of its task left out.
        const agentRows = rows.agents.filter(
          (row) =>
            !agents.holds(row.id) &&
            standing(row) &&
            (row.taskId === null || standing({ id: row.taskId })),
        );

        if (planRows.length + agentRows.length === 0) return;

        // Note that a task's snapshot answers every agent of it, so a cold agent of a task drawn here that it leaves out is gone, and marked so an earlier read draws it not back.
        const tasksDrawn = new Set(planRows.map((row) => row.id));
        const answered = new Set(agentRows.map((row) => row.id));
        const inSnapshot = new Set(rows.agents.map((row) => row.id));

        const omitted = coldAgentKeys.filter(
          (id) => !inSnapshot.has(id) && tasksDrawn.has(coldAgents.row(id)?.taskId ?? ""),
        );

        for (const id of [...tasksDrawn, ...answered, ...omitted]) {
          coldDrawnBy.set(id, at.asked);
        }

        const gone = new Set(omitted);
        coldPlanKeys = [...new Set([...coldPlanKeys, ...tasksDrawn])];
        coldAgentKeys = [...new Set([...coldAgentKeys, ...answered])].filter((id) => !gone.has(id));
        yield* coldPlans.answer(planRows, { held: coldPlanKeys });
        yield* coldAgents.answer(agentRows, { held: coldAgentKeys });
        plansDrawn([...tasksDrawn]);
        agentsDrawn([...answered, ...omitted]);
        yield* redraw();
      });

    return {
      answer: (answeredRows, standing, liveSince) =>
        Effect.suspend(() => {
          // Note that one past a sync id joins what it names onto the rows held, less those it lets go, and a whole one holds its rows alone.
          const past = standing?.past !== undefined;
          const gone = new Set(past ? standing.gone : []);
          const answeredPlans = new Map(answeredRows.tasks.map((row) => [row.id, row]));
          const answeredAgents = new Map(answeredRows.agents.map((row) => [row.id, row]));
          const planOf = (id: string) => answeredPlans.get(id) ?? plans.row(id);
          const agentOf = (id: string) => answeredAgents.get(id) ?? agents.row(id);

          const holdsAgent = (id: string) =>
            !gone.has(id) && (answeredAgents.has(id) || (past && agentKeys.has(id)));

          const holdsPlan = (id: string) =>
            !gone.has(id) && (answeredPlans.has(id) || (past && planKeys.has(id)));

          const answeredOfTask = new Map<string, string[]>();

          for (const row of answeredRows.agents) {
            if (row.taskId === null) continue;
            const ofTask = answeredOfTask.get(row.taskId) ?? [];
            ofTask.push(row.id);
            answeredOfTask.set(row.taskId, ofTask);
          }

          /** The agents of `taskId` the list holds once the answer is taken. */
          const agentsOf = (taskId: string): readonly string[] => [
            ...new Set(
              [
                ...(past ? (agentsOfTask.get(taskId) ?? []) : []),
                ...(answeredOfTask.get(taskId) ?? []),
              ].filter((id) => holdsAgent(id) && agentOf(id)?.taskId === taskId),
            ),
          ];

          const pinnedThroughAgent = (taskId: string) =>
            agentsOf(taskId).some((id) => (agentOf(id)?.pinnedAt ?? null) !== null);

          // Note that a task only ages out of the set, which logs nothing, so the list lets it go itself, at the instant the service bound, and its agents with it.
          const left =
            liveSince === undefined
              ? new Set<string>()
              : agedOut(
                  [...(past ? mayAge.before(liveSince) : []), ...answeredPlans.keys()].filter(
                    holdsPlan,
                  ),
                  planOf,
                  pinnedThroughAgent,
                  liveSince,
                );

          const leftAgents = new Set([...left].flatMap(agentsOf));
          const ofStanding = (row: AgentRow) => row.taskId === null || !left.has(row.taskId);

          const rows = {
            plans: answeredRows.tasks.filter((row) => !left.has(row.id)),
            agents: answeredRows.agents.filter(ofStanding),
          };

          // Note that a whole answer lets go every row held but those it answers and keeps.
          const plansGone = past
            ? [...gone, ...left].filter((id) => planKeys.has(id))
            : [...planKeys].filter((id) => !answeredPlans.has(id) || left.has(id));

          const agentsGone = past
            ? [...gone, ...leftAgents].filter((id) => agentKeys.has(id))
            : [...agentKeys].filter((id) => !answeredAgents.has(id) || leftAgents.has(id));

          // Note that an answer past a sync id carrying no row and letting none go moves nothing, as most of a busy service's do, so neither the pool nor the list is walked: the edge armed stands, and a write settles on the follow's wait.
          const still =
            past &&
            rows.plans.length + rows.agents.length === 0 &&
            plansGone.length + agentsGone.length === 0;

          if (still) return Effect.succeed(false);
          answers += 1;

          for (const id of [...plansGone, ...agentsGone]) letGoAt.set(id, answers);

          if (!past) {
            planKeys = new Set();
            agentKeys = new Set();
          }

          for (const id of plansGone) planKeys.delete(id);

          for (const id of agentsGone) agentKeys.delete(id);

          for (const row of rows.plans) if (!gone.has(row.id)) planKeys.add(row.id);

          for (const row of rows.agents) if (!gone.has(row.id)) agentKeys.add(row.id);

          const at = syncIdOf(standing);
          const sinceAt = at === undefined ? undefined : { at };

          // Note that one past a sync id hands the pool only what moved and what it let go, the list's own and any a write's answer laid among its rows, so its work is as large as the change.
          const answered = (held: ReadonlySet<string>, letGo: Iterable<string>): Answered =>
            past ? { gone: [...new Set(letGo)], ...sinceAt } : { held: [...held], ...sinceAt };

          const plansAnswered = answered(planKeys, [...gone, ...left]);
          const agentsAnswered = answered(agentKeys, [...gone, ...leftAgents]);

          return Effect.gen(function* () {
            const plansMoved = yield* plans.answer(rows.plans, plansAnswered);
            const agentsMoved = yield* agents.answer(rows.agents, agentsAnswered);
            // Note that a cold task the follow now answers is the follow's alone, so one it later lets go is gone from the list too.
            yield* settleCold;
            yield* inChunks(plansMoved, plansDrawn);
            yield* inChunks(agentsMoved, agentsDrawn);
            // Note that a whole answer, the list's first or one read again, draws at once, and one past a sync id rides the tick, since a busy account's agents answer many a second.
            yield* past ? ticks.soon : ticks.drawn;

            return plansMoved.length + agentsMoved.length > 0;
          });
        }),
      synced: () => ({ tasks: plans.synced(), agents: agents.synced() }),
      holds: (id) =>
        plans.holds(id) || agents.holds(id) || coldPlans.holds(id) || coldAgents.holds(id),
      mark,
      cold: (rows, at) => drawnCold(rows, at, 0),
    };
  });
}
