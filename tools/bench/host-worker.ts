/**
 * host-worker.ts -- one fresh process's measurement of a build's real `taskListCollections` over the large seed, printed as one JSON line.
 *
 * Spawned by `host-bench.ts` with the root of the worktree to time
 * (`--root`), and never run by hand. It loads that worktree's own host,
 * sync, and Effect by path, so what it times is that build's code, and
 * draws every list a window would read:
 *
 * - `kept`: the list stands over a local copy holding every plan and agent,
 *   and the clock runs from standing to the draw that holds every agent,
 *   split where the tasks are drawn (`keptDrawn`): the phone's launch and a
 *   desktop's start;
 * - `answer`: one whole answer of the follow's rows, as a first draw on a
 *   desktop or the web, then `steps` answers past a sync id that each move
 *   one live agent, a turn starting and ending in turn, and `steps` that
 *   each move one live plan's own row. Each step ends once the draw tick
 *   has passed and the list is drawn;
 * - `paged`: the same whole answer as a build that reads pages takes one
 *   (`live-follow.ts`'s `followTakingRows`): its first page, `PAGE_TASKS`
 *   plans, the newest, with their agents and those on no plan, joined on at
 *   once, then every other page together, joined on with the last, which
 *   lets go what no page carried, each ending once the draw tick has passed.
 */

import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type * as EffectModule from "effect";
import type * as TestingModule from "effect/testing";
import type * as AgentWire from "../../packages/features/src/agent-wire.js";
import type * as TaskWire from "../../packages/features/src/task-wire.js";
import type * as KeptLists from "../../packages/host/src/kept-lists.js";
import type * as LiveCollection from "../../packages/host/src/live-collection.js";
import type * as TaskListCollections from "../../packages/host/src/task-list-collections.js";
import type { LiveTaskList } from "../../packages/host/src/task-list-collections.js";
import type { AgentRow, PlanRow } from "../../packages/host/src/task-list-rows.js";
import type * as Sync from "../../packages/sync/src/index.js";
import { NOW, SEED, type SeedConstants, seedRows } from "./host-seed.js";

/** Steps dropped from the front of each run of moves, while the engine warms. */
const WARM_STEPS = 20;

/** What a run measures. */
const MODE = { KEPT: "kept", ANSWER: "answer", PAGED: "paged" } as const;

/** How many plans a page of a whole answer carries, as the service pages the task list (`tasksRead`). */
const PAGE_TASKS = 80;

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    mode: { type: "string" },
    agents: { type: "string", default: "5400" },
    steps: { type: "string", default: "400" },
  },
});

const root = path.resolve(values.root ?? process.cwd());
const mode = Object.values(MODE).find((each) => each === values.mode) ?? MODE.ANSWER;
const agentCount = Number(values.agents);
const steps = Number(values.steps);

/** A module of the worktree at `root`, by its path under it. */
function loadFile<Module>(file: string): Promise<Module> {
  // SAFETY: `Module` is the type of the file's own module, which each caller names.
  return import(pathToFileURL(path.join(root, file)).href) as Promise<Module>;
}

/** A package as the worktree's host resolves it, so the host and this script share one copy of Effect. */
function loadPackage<Module>(name: string): Promise<Module> {
  const resolved = createRequire(path.join(root, "packages/host/package.json")).resolve(name);

  // SAFETY: `Module` is the type of the package's own module, which each caller names.
  return import(pathToFileURL(resolved).href) as Promise<Module>;
}

const [effect, testing, sync, collectionsModule, keptLists, liveCollection, agentWire, taskWire] =
  await Promise.all([
    loadPackage<typeof EffectModule>("effect"),
    loadPackage<typeof TestingModule>("effect/testing"),
    loadFile<typeof Sync>("packages/sync/src/index.ts"),
    loadFile<typeof TaskListCollections>("packages/host/src/task-list-collections.ts"),
    loadFile<typeof KeptLists>("packages/host/src/kept-lists.ts"),
    loadFile<typeof LiveCollection>("packages/host/src/live-collection.ts"),
    loadFile<typeof AgentWire>("packages/features/src/agent-wire.ts"),
    loadFile<typeof TaskWire>("packages/features/src/task-wire.ts"),
  ]);

const { Effect } = effect;
const { TestClock } = testing;

const constants: SeedConstants = {
  agentArchiver: agentWire.AGENT_ARCHIVER,
  agentBrief: agentWire.AGENT_BRIEF,
  taskPriority: taskWire.TASK_PRIORITY,
  taskStatus: taskWire.TASK_STATUS,
};

const median = (list: readonly number[]) =>
  [...list].sort((one, other) => one - other)[Math.floor(list.length / 2)] ?? 0;

const p95 = (list: readonly number[]) =>
  [...list].sort((one, other) => one - other)[Math.floor(list.length * 0.95)] ?? 0;

const round = (value: number) => Math.round(value * 100) / 100;

/** A step's costs, as the median, the p95, and the mean of those past the warm steps. */
function summary(costs: readonly number[]) {
  const timed = costs.slice(WARM_STEPS);

  return {
    median: round(median(timed)),
    p95: round(p95(timed)),
    mean: round(timed.reduce((sum, cost) => sum + cost, 0) / timed.length),
  };
}

const program = Effect.gen(function* () {
  const { plans, agents } = seedRows(constants, agentCount);

  const kept = new Map<string, readonly unknown[]>(
    mode === MODE.KEPT
      ? [
          [keptLists.KEPT_LIST.TASK_LIST_PLANS.name, plans],
          [keptLists.KEPT_LIST.TASK_LIST_AGENTS.name, agents],
        ]
      : [],
  );

  const pool = yield* sync.entityPool({
    mintKey: () => "key",
    replayRefused: Effect.void,
    store: {
      rows: {
        answered: () => Effect.void,
        loaded: (name) => Effect.succeed({ rows: kept.get(name.read) ?? [], cursor: { at: "1" } }),
      },
    },
  });

  let last: LiveTaskList | undefined;
  let draws = 0;
  const standStarted = performance.now();

  const collections = yield* collectionsModule.taskListCollections({
    pool,
    draw: (read) => {
      last = read;
      draws += 1;

      // Note that a window reads each list a draw hands it, so each is read here as one would be.
      void read.list.tasks.length;
      void read.taskAgents.length;
      void read.taskPullRequests.length;
      void read.agentPullRequests.length;
    },
    txWait: () => undefined,
    readAgain: () => Effect.succeed(undefined),
  });

  if (mode === MODE.KEPT) {
    let tasksDrawnAt = Number.NaN;

    yield* Effect.forkScoped(
      Effect.tap(collections.keptDrawn, () =>
        Effect.sync(() => {
          tasksDrawnAt = performance.now();
        }),
      ),
    );

    yield* Effect.repeat(Effect.yieldNow, {
      until: () => last?.taskAgents.length === agentCount,
      times: 1_000_000,
    });

    const drawnAt = performance.now();

    return {
      keptDraw: round(drawnAt - standStarted),
      keptTasks: round(tasksDrawnAt - standStarted),
      keptAgents: round(drawnAt - tasksDrawnAt),
    };
  }

  if (mode === MODE.PAGED) {
    const newestFirst = plans.toSorted(
      (one, other) => other.createdAt - one.createdAt || (other.id < one.id ? -1 : 1),
    );

    const firstIds = new Set(newestFirst.slice(0, PAGE_TASKS).map((plan) => plan.id));
    const ofFirst = (agent: AgentRow) => agent.taskId === null || firstIds.has(agent.taskId);
    const carried = new Set([...plans, ...agents].map((row) => row.id));

    // Note that a build that reads pages takes the first at once and every other with the last (`followTakingRows`), so the list takes two answers.
    const firstStarted = performance.now();

    yield* collections.answer(
      { tasks: newestFirst.slice(0, PAGE_TASKS), agents: agents.filter(ofFirst) },
      { past: "", next: "", gone: [], paged: true },
      0,
    );
    yield* TestClock.adjust(liveCollection.DRAW_TICK);
    const pagedFirst = performance.now() - firstStarted;
    const restStarted = performance.now();

    yield* collections.answer(
      {
        tasks: newestFirst.slice(PAGE_TASKS),
        agents: agents.filter((agent) => !ofFirst(agent)),
      },
      { past: "", next: "1", gone: [], paged: true, carried },
      0,
    );
    yield* TestClock.adjust(liveCollection.DRAW_TICK);
    const pagedRest = performance.now() - restStarted;

    if (last?.taskAgents.length !== agentCount) throw new Error("the pages drew not every agent");

    return { pagedFirst: round(pagedFirst), pagedRest: round(pagedRest) };
  }

  const answerStarted = performance.now();
  yield* collections.answer({ tasks: plans, agents }, undefined, 0);
  const firstAnswer = round(performance.now() - answerStarted);

  if (last?.taskAgents.length !== agentCount) throw new Error("the first answer drew no agents");

  const livePlans = plans.filter((plan) => plan.status !== taskWire.TASK_STATUS.DONE);
  const liveAgents = agents.filter((agent) => agent.archivedAt === null);
  let syncId = 1;

  /** One answer past a sync id carrying `rows`, timed to the draw it brings. */
  const step = (rows: { tasks: PlanRow[]; agents: AgentRow[] }) =>
    Effect.gen(function* () {
      const before = draws;
      const started = performance.now();

      yield* collections.answer(
        rows,
        { past: String(syncId), next: String(syncId + 1), gone: [] },
        0,
      );
      yield* TestClock.adjust(liveCollection.DRAW_TICK);

      const cost = performance.now() - started;
      syncId += 1;

      if (draws === before) throw new Error("a step drew nothing");

      return cost;
    });

  // A live agent's turn starts, then ends on the next pass over them, as a running agent moves its row.
  const agentCosts: number[] = [];

  for (let at = 0; at < steps; at += 1) {
    // SAFETY: the index is taken modulo the list's length, and the live agents are never none.
    const agent = liveAgents[at % liveAgents.length] as AgentRow;
    const starting = Math.floor(at / liveAgents.length) % 2 === 0;

    // SAFETY: the spread keeps every field of the row, and the turn fields it sets are the row's own.
    const moved = {
      ...agent,
      turnId: `turn-step-${at}`,
      turnStatus: starting ? "running" : "completed",
      settledAt: starting ? null : NOW + at,
      lastSettledAt: starting ? agent.lastSettledAt : NOW + at,
    } as AgentRow;

    agentCosts.push(yield* step({ tasks: [], agents: [moved] }));
  }

  // A live plan's own row moves: its status alternates and its update time advances.
  const taskCosts: number[] = [];

  for (let at = 0; at < steps; at += 1) {
    // SAFETY: the index is taken modulo the list's length, and the live plans are never none.
    const plan = livePlans[at % livePlans.length] as PlanRow;
    const todo = Math.floor(at / livePlans.length) % 2 === 0;

    // SAFETY: the spread keeps every field of the row, and the status is one of its own.
    const moved = {
      ...plan,
      status: todo ? taskWire.TASK_STATUS.TODO : taskWire.TASK_STATUS.IN_PROGRESS,
      updatedAt: NOW + at,
    } as PlanRow;

    taskCosts.push(yield* step({ tasks: [moved], agents: [] }));
  }

  return { firstAnswer, agentStep: summary(agentCosts), taskStep: summary(taskCosts) };
});

const result = await Effect.runPromise(
  program.pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

const line = JSON.stringify({ mode, agents: agentCount, plans: SEED.PLANS, ...result });

if (process.env.OUT !== undefined) appendFileSync(process.env.OUT, `${line}\n`);

process.stdout.write(`${line}\n`);
