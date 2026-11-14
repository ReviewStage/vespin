import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { entityPool } from "@repo/sync";
import { TURN_STATUS } from "@repo/wire";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { type AppStateSnapshot, appStateDelivery } from "./app-state.js";
import { initialAppState } from "./client/app-state-store.js";
import { DRAW_TICK, rowWriteOn } from "./live-collection.js";
import { runModeFor } from "./run-mode.js";
import { AGENT, type LiveTaskList, PLAN, taskListCollections } from "./task-list-collections.js";
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

/** The document a window is told, its task list drawn as `drawn`, at `version`. */
function documentOf(drawn: LiveTaskList, version: number): AppStateSnapshot {
  const idle = initialAppState(
    {
      launch: { profile: "idle", captureMode: false, fixtureMode: false },
      runMode: runModeFor({ capture: false, fixture: false }),
      appVersion: "1.2.3",
      packaged: true,
      platform: "darwin",
    },
    true,
    [],
  );

  return {
    ...idle,
    tasks: {
      ...idle.tasks,
      tasks: drawn.list.plans,
      taskAgents: drawn.taskAgents,
      taskPullRequests: drawn.taskPullRequests,
      agentPullRequests: drawn.agentPullRequests,
      taskAgentPins: drawn.taskAgentPins,
    },
    window: { fullScreen: false },
    version,
  };
}

/** Lets the list's timer fiber run: arm its wait, or draw once that wait ends. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

it.effect(
  "an agent's row that moves on an account of thousands draws its own agent and task again, and every other task and agent is the object drawn before",
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

        // Note that this test takes about two seconds, since its point is an account's size.
        // An account of thousands: 1,000 tasks, 2,000 agents that each ran a turn, some pinned, some started from another.
        const plans = Array.from({ length: 1_000 }, (_, at) => ({
          ...planListRow(`task-${at}`, `Task ${at}`),
          createdAt: at,
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

        yield* collections.answer({ plans, agents });
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

        yield* collections.answer(
          { plans: [], agents: [running] },
          { past: "1", next: "2", gone: [] },
        );
        yield* TestClock.adjust(DRAW_TICK);
        const after = drawings.at(-1);
        assert.ok(before !== undefined && after !== undefined && after !== before);
        assert.equal(after.taskAgents.length, agents.length);
        assert.equal(after.list.plans.length, plans.length);

        const newAgents = after.taskAgents.filter((agent, at) => agent !== before.taskAgents[at]);
        const newTasks = after.list.plans.filter((task, at) => task !== before.list.plans[at]);

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

        for (const row of [...after.taskAgents, ...after.list.plans]) {
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

        const delivered = appStateDelivery(documentOf(before, 1), documentOf(after, 2));

        assert.deepEqual(delivered?.moved, {
          tasks: [
            { key: ["tasks"], rows: newTasks },
            { key: ["taskAgents"], rows: newAgents },
          ],
        });
        assert.equal(reads, 0);
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
        yield* collections.answer({ plans: [invites, billing], agents: [] });
        assert.equal(drawings.length, 1);

        // Three answers land 30 ms apart, as a busy account's agents answer.
        const past = (at: number) => ({ past: `${at}`, next: `${at + 1}`, gone: [] });
        yield* collections.answer(
          { plans: [{ ...invites, name: "Invites" }], agents: [] },
          past(1),
        );
        yield* TestClock.adjust("30 millis");
        yield* collections.answer(
          { plans: [{ ...billing, name: "CSV export" }], agents: [] },
          past(2),
        );
        yield* TestClock.adjust("30 millis");
        yield* collections.answer(
          { plans: [{ ...billing, name: "Invoices" }], agents: [] },
          past(3),
        );
        assert.equal(drawings.length, 1);

        yield* TestClock.adjust(DRAW_TICK);
        assert.equal(drawings.length, 2);

        assert.deepEqual(
          drawings
            .at(-1)
            ?.list.plans.map((plan) => plan.name)
            .toSorted(),
          ["Invites", "Invoices"],
        );

        // A rename the member types stands in the list before any tick passes, while the service has yet to answer it.
        yield* Effect.forkChild(
          rowWriteOn(pool, PLAN)(INVITES, () => ({ name: "Seat invites" }), Effect.never),
        );
        yield* Effect.yieldNow;
        assert.equal(drawings.length, 3);
        assert.ok(drawings.at(-1)?.list.plans.some((plan) => plan.name === "Seat invites"));
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

        yield* collections.answer({ plans, agents: [agentListRow(INVITES, 0)] });
        yield* settled;
        const statusOf = () => drawings.at(-1)?.taskAgents.map((agent) => agent.status);
        const billingOf = () => drawings.at(-1)?.list.plans.find((plan) => plan.id === BILLING);
        const billing = billingOf();
        assert.deepEqual(statusOf(), [AGENT_STATUS.STARTING]);

        yield* TestClock.adjust(Duration.millis(STARTING_GRACE_MILLIS));
        yield* settled;
        assert.deepEqual(statusOf(), [AGENT_STATUS.STARTING]);

        yield* TestClock.adjust(Duration.millis(1));
        yield* settled;
        assert.deepEqual(statusOf(), [AGENT_STATUS.FAILED]);
        assert.equal(
          drawings.at(-1)?.list.plans.find((plan) => plan.id === INVITES)?.agents?.working,
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

        yield* collections.answer({ plans, agents: [invites, billing] });
        const before = drawings.at(-1);

        // Only billing's pull request moved: it merged.
        const merged = { ...openPullRequest(8), state: PULL_REQUEST_STATE.MERGED };
        yield* collections.answer({ plans, agents: [invites, { ...billing, published: merged }] });
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
        yield* collections.answer({ plans: [planListRow(BILLING, "Billing")], agents: [] });
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
            collections.cold({ plans: [invites], agents: [kept, deleted] }, earlierMark),
          ),
        );

        const laterRead = yield* Effect.forkChild(
          Effect.andThen(
            Deferred.await(later),
            collections.cold({ plans: [invites], agents: [kept] }, laterMark),
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
        const standing = { plans: [invites], agents: [agent] };

        const collections = yield* taskListCollections({
          pool: yield* entityPool(),
          draw: (read) => {
            drawings.push(read);
          },
          txWait: () => undefined,
          readAgain: () => Effect.succeed(drawn ? standing : { plans: [], agents: [] }),
        });

        yield* collections.answer({ plans: [invites, billing], agents: [agent] });

        // A search is out when the list lets the invites task go, and answers it as it stood before.
        const answered = yield* Deferred.make<void>();
        const mark = collections.mark();

        const read = yield* Effect.forkChild(
          Effect.andThen(Deferred.await(answered), collections.cold(standing, mark)),
        );

        yield* collections.answer({ plans: [billing], agents: [] });
        yield* Deferred.succeed(answered, undefined);
        yield* Fiber.join(read);
        yield* settled;

        const last = drawings.at(-1);

        assert.deepEqual(
          last?.list.plans.map((plan) => plan.id).toSorted(),
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
        yield* collections.answer({ plans, agents });
        const before = drawings.at(-1);

        // A teammate forks billing's agent at a message.
        const billingFork = {
          ...agentListRow(BILLING, 3_000),
          id: "agent-billing-fork",
          title: "Billing, forked",
          startedFrom: { agentId: billing.id, messageId: "message-7", steps: 2, totalSteps: 4 },
        };

        yield* collections.answer({ plans, agents: [...agents, billingFork] });
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
