import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import {
  agentPullRequestsOfLiveRows,
  type TaskListLiveRows,
  taskAgentsOfLiveRows,
  taskListOfLiveRows,
} from "@repo/features/task-list-live";
import { type ListedPullRequest, TASK_STATUS } from "@repo/features/task-wire";
import type { TaskListParts } from "@repo/features/tasks-view";
import { type EntityPool, entityPool } from "@repo/sync";
import { TURN_STATUS } from "@repo/wire";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { taskListDelivery } from "./app-state.js";
import { KEPT_LIST } from "./kept-lists.js";
import { DRAW_TICK, rowWriteOn } from "./live-collection.js";
import { heldApart } from "./task-list-archived.js";
import { AGENT, type LiveTaskList, PLAN, taskListCollections } from "./task-list-collections.js";
import { taskListMoved } from "./task-list-moved.js";
import { agentListRow, planListRow } from "./testing/task-list-rows.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** An open pull request with passing checks, numbered `number`. */
function openPullRequest(number: number): AgentPullRequest {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
  };
}

/** The task list's lists as `drawn` holds them, as the store holds them beside the document. */
function listsOf(drawn: LiveTaskList): TaskListParts {
  return {
    tasks: drawn.list.tasks,
    taskAgents: drawn.taskAgents,
    taskPullRequests: drawn.taskPullRequests,
    agentPullRequests: drawn.agentPullRequests,
  };
}

/** `pool`, counting each row a read standing on it reads of it, and each key an answer hands it as all the read holds. */
function countedPool(pool: EntityPool) {
  const work = { rowsRead: 0, keysHeld: 0 };

  const counted: EntityPool = {
    ...pool,
    stand: (kind, read) =>
      Effect.map(pool.stand(kind, read), (held) => ({
        ...held,
        row: (key) => {
          work.rowsRead += 1;

          return held.row(key);
        },
        answer: (rows, answered) => {
          work.keysHeld += answered?.held?.length ?? 0;

          return held.answer(rows, answered);
        },
      })),
  };

  return { pool: counted, work };
}

/** Lets the list's timer fiber run: arm its wait, or draw once that wait ends. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

it.effect(
  "a list the phone kept for an account of thousands stands before its rows are drawn, then draws every task, then every agent behind them",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Note that this test takes a few seconds, since its point is the size of the account that held a phone's start: 3,200 tasks and 5,400 agents.
        const plans = Array.from({ length: 3_200 }, (_, at) => ({
          ...planListRow(`task-${at}`, `Task ${at}`),
          createdAt: at,
        }));

        const agents = Array.from({ length: 5_400 }, (_, at) => ({
          ...agentListRow(`task-${at % plans.length}`, at),
          id: `agent-${at}`,
          turnId: `turn-${at}`,
          turnStatus: TURN_STATUS.SETTLED,
          queuedAt: at,
          startedAt: at,
          settledAt: at + 1,
        }));

        const kept = new Map<string, readonly unknown[]>([
          [KEPT_LIST.TASK_LIST_PLANS.name, plans],
          [KEPT_LIST.TASK_LIST_AGENTS.name, agents],
        ]);

        const pool = yield* entityPool({
          mintKey: () => "key",
          replayRefused: Effect.void,
          store: {
            rows: {
              answered: () => Effect.void,
              loaded: (name) =>
                Effect.succeed({ rows: kept.get(name.read) ?? [], cursor: { at: "1" } }),
            },
          },
        });

        const drawings: LiveTaskList[] = [];

        yield* taskListCollections({
          pool,
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        // Standing drew nothing, so the host's first document never waits on the list.
        assert.equal(drawings.length, 0);

        yield* Effect.repeat(Effect.yieldNow, {
          until: () => drawings.at(-1)?.taskAgents.length === agents.length,
          times: 10_000,
        });

        // The tasks are drawn first, whole, for a task's row and the Inbox's threads under it, and their agents fill in behind.
        const first = drawings[0];
        assert.equal(first?.list.tasks.length, plans.length);
        assert.ok((first?.taskAgents.length ?? 0) < agents.length);

        const drawn = drawings.at(-1);
        assert.equal(drawn?.list.tasks.length, plans.length);
        assert.equal(drawn?.taskAgents.length, agents.length);
      }),
    ),
);

it.effect(
  "an agent's row that moves on an account of thousands draws its own agent and task again, reading no other row, every other task and agent the object drawn before, and the Done tasks the live set's instant passes leave with no row moving",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];
        const { pool, work } = countedPool(yield* entityPool());

        const collections = yield* taskListCollections({
          pool,
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        // Note that this test takes about two seconds, since its point is an account's size.
        // An account of thousands: 1,000 tasks, a third of them Done and each touched at its own instant past the live set's, and 2,000 agents that each ran a turn, some pinned, some started from another.
        const liveSince = 1_000_000;
        const done = (at: number) => at % 3 === 0;

        const plans = Array.from({ length: 1_000 }, (_, at) => ({
          ...planListRow(`task-${at}`, `Task ${at}`),
          createdAt: at,
          updatedAt: liveSince + ((at * 7_919) % 1_000),
          ...(done(at) ? { status: TASK_STATUS.DONE } : undefined),
        }));

        const agents = Array.from({ length: 2_000 }, (_, at) => ({
          ...agentListRow(`task-${at % plans.length}`, at),
          id: `agent-${at}`,
          title: `Agent ${at}`,
          turnId: `turn-${at}`,
          turnStatus: TURN_STATUS.SETTLED,
          queuedAt: at,
          startedAt: at,
          settledAt: at + 1,
          ...(at % 7 === 0 ? { pinnedAt: at, pinPosition: `a${at}` } : undefined),
          ...(at >= 1_500
            ? { startedFrom: { agentId: `agent-${at - 1_500}`, steps: 1, totalSteps: 1 } }
            : undefined),
        }));

        yield* collections.answer({ tasks: plans, agents }, undefined, liveSince);
        const before = drawings.at(-1);

        // Only one agent moved, one nothing was started from and started from none, as the follow answers past a sync id: a teammate sent it a line, so it runs again.
        const moved = agents[1_234];
        assert.ok(moved !== undefined);

        const running = {
          ...moved,
          turnId: "turn-next",
          turnStatus: TURN_STATUS.RUNNING,
          settledAt: null,
        };

        work.rowsRead = 0;
        work.keysHeld = 0;

        yield* collections.answer(
          { tasks: [], agents: [running] },
          { past: "1", next: "2", gone: [] },
          liveSince,
        );
        yield* TestClock.adjust(DRAW_TICK);
        const after = drawings.at(-1);

        // Taking the one row reads the pool for that agent and its task alone, and hands it no list of all the list holds.
        assert.ok(work.rowsRead <= 4, `read ${work.rowsRead} rows`);
        assert.equal(work.keysHeld, 0);
        assert.ok(before !== undefined && after !== undefined && after !== before);
        assert.equal(after.taskAgents.length, agents.length);
        assert.equal(after.list.tasks.length, plans.length);

        const newAgents = after.taskAgents.filter((agent, at) => agent !== before.taskAgents[at]);
        const newTasks = after.list.tasks.filter((task, at) => task !== before.list.tasks[at]);

        assert.deepEqual(
          newAgents.map((agent) => [agent.id, agent.status]),
          [[moved.id, AGENT_STATUS.RUNNING]],
        );
        assert.deepEqual(
          newTasks.map((task) => [task.id, task.agents?.working]),
          [[moved.taskId, 1]],
        );
        assert.equal(after.taskAgentPins, before.taskAgentPins);

        // The delivery that brings a window holding the list before to the list after names the moved agent and its task alone, and reads no other row of either list.
        let reads = 0;
        const drawnAgain = new Set<object>([...newAgents, ...newTasks]);

        for (const row of [...after.taskAgents, ...after.list.tasks]) {
          if (drawnAgain.has(row)) continue;
          const { id } = row;

          Object.defineProperty(row, "id", {
            enumerable: true,
            get: () => {
              reads += 1;

              return id;
            },
          });
        }

        const delivered = taskListDelivery(listsOf(before), listsOf(after), 2);

        assert.deepEqual(delivered?.moved, [
          { key: ["tasks"], rows: newTasks },
          { key: ["taskAgents"], rows: newAgents },
        ]);
        assert.equal(reads, 0);

        // The service binds the live set half its stretch later and answers no row: each Done task touched before then leaves, but one pinned through an agent.
        const pinnedThroughAgent = (at: number) => at % 7 === 0 || (at + 1_000) % 7 === 0;

        const stays = plans.filter(
          (plan, at) => !done(at) || plan.updatedAt >= liveSince + 500 || pinnedThroughAgent(at),
        );

        yield* collections.answer(
          { tasks: [], agents: [] },
          { past: "2", next: "3", gone: [] },
          liveSince + 500,
        );
        yield* TestClock.adjust(DRAW_TICK);

        assert.deepEqual(
          drawings
            .at(-1)
            ?.list.tasks.map((plan) => plan.id)
            .toSorted(),
          stays.map((plan) => plan.id).toSorted(),
        );
      }),
    ),
);

it.effect(
  "an account of thousands whose agents are mostly archived draws every agent, every task's agents in brief, and every agent's pull request as the held read does, in its order, before and after agents move into and out of their archive and tasks none of whose agents stands live move, gain one, lose their last, or go",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        // Note that this test takes a few seconds, since its point is the size of the developer's account: 3,200 tasks, 200 with no agent, and 5,400 agents, 82% of them archived.
        const plans = Array.from({ length: 3_200 }, (_, at) => ({
          ...planListRow(`task-${at}`, `Task ${at}`),
          createdAt: at,
        }));

        // Some agents fail, some never ran a turn and wait on their starting grace, some opened a pull request, and some were started from another; two start at each instant.
        const agents = Array.from({ length: 5_400 }, (_, at) => ({
          ...agentListRow(`task-${(at * 7) % 3_000}`, Math.floor(at / 2)),
          id: `agent-${at}`,
          title: `Agent ${at}`,
          ...(at % 97 === 0
            ? undefined
            : {
                turnId: `turn-${at}`,
                turnStatus: at % 13 === 0 ? TURN_STATUS.FAILED : TURN_STATUS.SETTLED,
                queuedAt: at,
                startedAt: at,
                settledAt: at + 1 + (at % 11) * 1_000,
              }),
          ...(at % 50 < 41 ? { archivedAt: at + 2 } : undefined),
          ...(at % 3 === 0 ? { published: openPullRequest(at) } : undefined),
          ...(at % 10 === 0 && at > 0
            ? { startedFrom: { agentId: `agent-${at - 10}`, steps: 1, totalSteps: 1 } }
            : undefined),
        }));

        const byAgent = (listed: readonly ListedPullRequest[] | undefined) =>
          listed?.toSorted((a, b) => (a.agentId < b.agentId ? -1 : 1));

        // What the held read answers for `rows` at this instant, every agent's grace still to end.
        const drawsAsHeld = (rows: TaskListLiveRows) => {
          const drawn = drawings.at(-1);
          assert.deepEqual(drawn?.taskAgents, taskAgentsOfLiveRows(rows, 0));
          assert.deepEqual(drawn?.list.tasks, taskListOfLiveRows(rows, 0).tasks);
          assert.deepEqual(
            byAgent(drawn?.agentPullRequests),
            byAgent(agentPullRequestsOfLiveRows(rows)),
          );
        };

        yield* collections.answer({ tasks: plans, agents }, undefined, undefined);
        drawsAsHeld({ tasks: plans, agents });
        const before = drawings.at(-1);

        // One agent is brought back, the only one of task-7 standing live then; one archived; one renamed in its archive; and one started from an archived agent.
        const [restored, archived, renamed] = [agents[1], agents[45], agents[2]];
        assert.ok(restored !== undefined && archived !== undefined && renamed !== undefined);

        // The one agent standing live of a task whose every other agent is archived, so archiving it leaves the task none.
        const liveOf = new Map<string | null, (typeof agents)[number][]>();

        for (const row of agents) {
          if (!heldApart(row)) liveOf.set(row.taskId, [...(liveOf.get(row.taskId) ?? []), row]);
        }

        const lastLive = [...liveOf.values()].find(
          (live) => live.length === 1 && live[0]?.taskId !== "task-7",
        )?.[0];

        assert.ok(lastLive !== undefined);

        const moved = [
          { ...restored, archivedAt: null },
          { ...archived, archivedAt: 9_000 },
          { ...renamed, title: "Renamed in its archive" },
          {
            ...agentListRow("task-7", 9_000),
            id: "agent-continued",
            startedFrom: { agentId: "agent-3", steps: 1, totalSteps: 1 },
          },
          { ...lastLive, archivedAt: 9_000 },
          // A task with no agent gains one, which a new agent on an old task is.
          { ...agentListRow("task-3100", 9_001), id: "agent-new" },
        ];

        // A task with no agent standing live is renamed, finished, pinned, and read, and another is deleted.
        const changedPlan = plans[3150];
        assert.ok(changedPlan !== undefined);

        const changed = {
          ...changedPlan,
          name: "Renamed with no agent",
          status: TASK_STATUS.DONE,
          pinnedAt: 9_000,
          pinPosition: "a0",
          readThrough: 9_000,
          updatedAt: 9_000,
        };

        yield* collections.answer(
          { tasks: [changed], agents: moved },
          { past: "1", next: "2", gone: ["task-3199"] },
          undefined,
        );
        yield* TestClock.adjust(DRAW_TICK);
        const after = drawings.at(-1);

        const movedRows = new Map(moved.map((row) => [row.id, row]));

        drawsAsHeld({
          tasks: plans
            .filter((row) => row.id !== "task-3199")
            .map((row) => (row.id === changed.id ? changed : row)),
          agents: [
            ...agents.map((row) => movedRows.get(row.id) ?? row),
            ...moved.filter((row) => row.id === "agent-continued" || row.id === "agent-new"),
          ],
        });

        // The drawing after is told what moved since the one before, the agent continued from among them, rather than walked whole.
        assert.ok(before !== undefined && after !== undefined);

        const drawnAt = (drawn: LiveTaskList) => ({
          tasks: drawn.list.tasks,
          taskAgents: drawn.taskAgents,
        });

        const told = taskListMoved(drawnAt(before), drawnAt(after));
        assert.equal(told.whole, false);
        assert.deepEqual(
          [
            ...new Set(told.whole ? [] : told.agents.map((move) => (move.now ?? move.was)?.id)),
          ].toSorted(),
          [
            "agent-1",
            "agent-2",
            "agent-3",
            "agent-45",
            "agent-continued",
            lastLive.id,
            "agent-new",
          ].toSorted(),
        );
      }),
    ),
);

it.effect(
  "answers past a sync id within one tick draw the list once, and a write the member makes draws at once",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pool = yield* entityPool();
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool,
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        const invites = planListRow(INVITES, "Teammate invitations");
        const billing = planListRow(BILLING, "Billing");
        yield* collections.answer({ tasks: [invites, billing], agents: [] });
        assert.equal(drawings.length, 1);

        // Three answers land 30 ms apart, as a busy account's agents answer.
        const past = (at: number) => ({ past: `${at}`, next: `${at + 1}`, gone: [] });
        yield* collections.answer(
          { tasks: [{ ...invites, name: "Invites" }], agents: [] },
          past(1),
        );
        yield* TestClock.adjust("30 millis");
        yield* collections.answer(
          { tasks: [{ ...billing, name: "CSV export" }], agents: [] },
          past(2),
        );
        yield* TestClock.adjust("30 millis");
        yield* collections.answer(
          { tasks: [{ ...billing, name: "Invoices" }], agents: [] },
          past(3),
        );
        assert.equal(drawings.length, 1);

        yield* TestClock.adjust(DRAW_TICK);
        assert.equal(drawings.length, 2);

        assert.deepEqual(
          drawings
            .at(-1)
            ?.list.tasks.map((plan) => plan.name)
            .toSorted(),
          ["Invites", "Invoices"],
        );

        // A rename the member types stands in the list before any tick passes, while the service has yet to answer it.
        yield* Effect.forkChild(
          rowWriteOn(pool, PLAN)(INVITES, () => ({ name: "Seat invites" }), Effect.never),
        );
        yield* Effect.yieldNow;
        assert.equal(drawings.length, 3);
        assert.ok(drawings.at(-1)?.list.tasks.some((plan) => plan.name === "Seat invites"));
      }),
    ),
);

it.effect(
  "the pages of a whole answer join the list, each leaving the rows held standing, and its last lets go every task and agent held that no page carried",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pool = yield* entityPool();
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool,
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        const invites = planListRow(INVITES, "Teammate invitations");
        yield* collections.answer({
          tasks: [invites, planListRow(BILLING, "Billing")],
          agents: [agentListRow(BILLING, 0)],
        });

        yield* collections.answer(
          { tasks: [{ ...invites, name: "Invites" }], agents: [] },
          { past: "", next: "", gone: [], paged: true },
        );
        yield* TestClock.adjust(DRAW_TICK);
        assert.deepEqual(
          drawings
            .at(-1)
            ?.list.tasks.map((plan) => plan.name)
            .toSorted(),
          ["Billing", "Invites"],
        );

        yield* collections.answer(
          { tasks: [], agents: [] },
          { past: "", next: "9", gone: [], paged: true, carried: new Set([INVITES]) },
        );
        yield* TestClock.adjust(DRAW_TICK);
        assert.deepEqual(
          drawings.at(-1)?.list.tasks.map((plan) => plan.name),
          ["Invites"],
        );
        assert.deepEqual(drawings.at(-1)?.taskAgents, []);
      }),
    ),
);

it.effect(
  "an agent with no turn reads failed the instant its starting grace ends, with no row moving, and every other task is the object drawn before",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        // The invites agent started at 0 and has no turn yet; the billing task has no agent.
        const plans = [
          planListRow(INVITES, "Teammate invitations"),
          planListRow(BILLING, "Billing"),
        ];

        yield* collections.answer({ tasks: plans, agents: [agentListRow(INVITES, 0)] });
        yield* settled;
        const statusOf = () => drawings.at(-1)?.taskAgents.map((agent) => agent.status);
        const billingOf = () => drawings.at(-1)?.list.tasks.find((plan) => plan.id === BILLING);
        const billing = billingOf();
        assert.deepEqual(statusOf(), [AGENT_STATUS.STARTING]);

        yield* TestClock.adjust(Duration.millis(STARTING_GRACE_MILLIS));
        yield* settled;
        assert.deepEqual(statusOf(), [AGENT_STATUS.STARTING]);

        yield* TestClock.adjust(Duration.millis(1));
        yield* settled;
        assert.deepEqual(statusOf(), [AGENT_STATUS.FAILED]);
        assert.equal(
          drawings.at(-1)?.list.tasks.find((plan) => plan.id === INVITES)?.agents?.working,
          0,
        );
        assert.equal(billingOf(), billing);
      }),
    ),
);

it.effect(
  "an agent's pull request that moves derives only its own entries again, and an archive the member makes takes its pull requests off its task at once",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pool = yield* entityPool();
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool,
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        const plans = [
          planListRow(INVITES, "Teammate invitations"),
          planListRow(BILLING, "Billing"),
        ];

        const invites = {
          ...agentListRow(INVITES, 1_000),
          id: "agent-invites",
          published: openPullRequest(7),
        };

        const billing = {
          ...agentListRow(BILLING, 1_000),
          id: "agent-billing",
          published: openPullRequest(8),
        };

        yield* collections.answer({ tasks: plans, agents: [invites, billing] });
        const before = drawings.at(-1);

        // Only billing's pull request moved: it merged.
        const merged = { ...openPullRequest(8), state: PULL_REQUEST_STATE.MERGED };
        yield* collections.answer({
          tasks: plans,
          agents: [invites, { ...billing, published: merged }],
        });
        const after = drawings.at(-1);

        const ofAgent = (drawing: LiveTaskList | undefined, agentId: string) =>
          drawing?.agentPullRequests.find((each) => each.agentId === agentId);

        const ofTask = (drawing: LiveTaskList | undefined, taskId: string) =>
          drawing?.taskPullRequests.find((each) => each.taskId === taskId);

        assert.ok(
          ofAgent(before, invites.id) !== undefined && ofTask(before, INVITES) !== undefined,
        );
        assert.equal(ofAgent(after, invites.id), ofAgent(before, invites.id));
        assert.equal(ofTask(after, INVITES), ofTask(before, INVITES));
        assert.equal(ofAgent(after, billing.id)?.pullRequest.state, PULL_REQUEST_STATE.MERGED);
        assert.equal(ofTask(after, BILLING)?.pullRequests[0]?.state, PULL_REQUEST_STATE.MERGED);

        // The member archives billing's agent, which the service has yet to answer.
        yield* Effect.forkChild(
          rowWriteOn(pool, AGENT)(billing.id, () => ({ archivedAt: 5_000 }), Effect.never),
        );
        yield* Effect.yieldNow;
        const archived = drawings.at(-1);

        assert.equal(ofTask(archived, BILLING), undefined);
        assert.equal(ofTask(archived, INVITES), ofTask(before, INVITES));
        assert.equal(ofAgent(archived, billing.id)?.pullRequest.number, 8);
      }),
    ),
);

it.effect(
  "an earlier read of a task outside the list, answered last, draws back no agent a later read of it left out",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        // The list holds the billing task alone, so the invites task is read outside it.
        yield* collections.answer({ tasks: [planListRow(BILLING, "Billing")], agents: [] });
        const invites = planListRow(INVITES, "Teammate invitations");
        const kept = { ...agentListRow(INVITES, 1_000), id: "agent-kept" };
        const deleted = { ...agentListRow(INVITES, 2_000), id: "agent-deleted" };

        // Two reads of the task are out at once: the earlier one asked while both agents stood, the later one after one was deleted.
        const earlier = yield* Deferred.make<void>();
        const later = yield* Deferred.make<void>();
        const earlierMark = collections.mark();
        const laterMark = collections.mark();

        const earlierRead = yield* Effect.forkChild(
          Effect.andThen(
            Deferred.await(earlier),
            collections.cold({ tasks: [invites], agents: [kept, deleted] }, earlierMark),
          ),
        );

        const laterRead = yield* Effect.forkChild(
          Effect.andThen(
            Deferred.await(later),
            collections.cold({ tasks: [invites], agents: [kept] }, laterMark),
          ),
        );

        // The later read answers first, then the earlier one.
        yield* Deferred.succeed(later, undefined);
        yield* Fiber.join(laterRead);
        yield* Deferred.succeed(earlier, undefined);
        yield* Fiber.join(earlierRead);

        const agentsDrawn = drawings.at(-1)?.taskAgents.map((agent) => agent.id);

        assert.deepEqual(agentsDrawn, [kept.id]);
      }),
    ),
);

it.effect.each([
  { case: "only left the list's set", service: "answers it still", drawn: true },
  { case: "was deleted", service: "answers it no more", drawn: false },
])(
  "a task the list lets go while a read of it is out, which $case, is drawn from that read only where the service $service",
  ({ drawn }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];
        const invites = planListRow(INVITES, "Teammate invitations");
        const agent = { ...agentListRow(INVITES, 1_000), id: "agent-invites" };
        const billing = planListRow(BILLING, "Billing");
        const standing = { tasks: [invites], agents: [agent] };

        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(drawn ? standing : { tasks: [], agents: [] }),
        });

        yield* collections.answer({ tasks: [invites, billing], agents: [agent] });

        // A search is out when the list lets the invites task go, and answers it as it stood before.
        const answered = yield* Deferred.make<void>();
        const mark = collections.mark();

        const read = yield* Effect.forkChild(
          Effect.andThen(Deferred.await(answered), collections.cold(standing, mark)),
        );

        yield* collections.answer({ tasks: [billing], agents: [] });
        yield* Deferred.succeed(answered, undefined);
        yield* Fiber.join(read);
        yield* settled;

        const last = drawings.at(-1);

        assert.deepEqual(
          last?.list.tasks.map((plan) => plan.id).toSorted(),
          drawn ? [INVITES, BILLING].toSorted() : [BILLING],
        );
        assert.deepEqual(
          last?.taskAgents.map((each) => each.id),
          drawn ? [agent.id] : [],
        );
      }),
    ),
);

it.effect(
  "an agent started from another lists it under its source, first started first, and every other agent's continuations are the object drawn before",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawings: LiveTaskList[] = [];

        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(undefined),
        });

        const plans = [
          planListRow(INVITES, "Teammate invitations"),
          planListRow(BILLING, "Billing"),
        ];

        const invites = { ...agentListRow(INVITES, 1_000), id: "agent-invites" };
        const billing = { ...agentListRow(BILLING, 1_000), id: "agent-billing" };

        const invitesAgain = {
          ...agentListRow(INVITES, 2_000),
          id: "agent-invites-again",
          title: "Invite flow, continued",
          startedFrom: { agentId: invites.id, steps: 4, totalSteps: 4 },
        };

        const billingAgain = {
          ...agentListRow(BILLING, 2_000),
          id: "agent-billing-again",
          title: "Billing, continued",
          startedFrom: { agentId: billing.id, steps: 4, totalSteps: 4 },
        };

        const agents = [invites, billing, invitesAgain, billingAgain];
        yield* collections.answer({ tasks: plans, agents });
        const before = drawings.at(-1);

        // A teammate forks billing's agent at a message.
        const billingFork = {
          ...agentListRow(BILLING, 3_000),
          id: "agent-billing-fork",
          title: "Billing, forked",
          startedFrom: { agentId: billing.id, messageId: "message-7", steps: 2, totalSteps: 4 },
        };

        yield* collections.answer({ tasks: plans, agents: [...agents, billingFork] });
        const after = drawings.at(-1);

        const agentOf = (drawing: LiveTaskList | undefined, id: string) =>
          drawing?.taskAgents.find((each) => each.id === id);

        assert.deepEqual(agentOf(before, invites.id)?.continuedBy, [
          { agentId: invitesAgain.id, title: "Invite flow, continued", forked: false },
        ]);
        assert.equal(agentOf(after, invites.id), agentOf(before, invites.id));

        assert.deepEqual(agentOf(after, billing.id)?.continuedBy, [
          { agentId: billingAgain.id, title: "Billing, continued", forked: false },
          {
            agentId: billingFork.id,
            title: "Billing, forked",
            forked: true,
            messageId: "message-7",
          },
        ]);
      }),
    ),
);
