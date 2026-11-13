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
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { DRAW_TICK, rowWriteOn } from "./live-collection.js";
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

/** Lets the list's timer fiber run: arm its wait, or draw once that wait ends. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

it.effect(
  "an agent's row that moves draws its own task again, and every other task and agent is the object drawn before",
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
        });

        const plans = [
          planListRow(INVITES, "Teammate invitations"),
          planListRow(BILLING, "Billing"),
        ];

        const invites = { ...agentListRow(INVITES, 1_000), id: "agent-invites" };
        const billing = { ...agentListRow(BILLING, 1_000), id: "agent-billing" };
        yield* collections.answer({ plans, agents: [invites, billing] });
        const before = drawings.at(-1);

        // Only the billing agent moved: a teammate renamed it.
        yield* collections.answer({
          plans,
          agents: [invites, { ...billing, title: "CSV export" }],
        });
        const after = drawings.at(-1);

        const taskOf = (drawing: LiveTaskList | undefined, id: string) =>
          drawing?.list.plans.find((each) => each.id === id);

        const agentOf = (drawing: LiveTaskList | undefined, id: string) =>
          drawing?.taskAgents.find((each) => each.id === id);

        assert.ok(
          taskOf(before, INVITES) !== undefined && agentOf(before, invites.id) !== undefined,
        );
        assert.equal(taskOf(after, INVITES), taskOf(before, INVITES));
        assert.equal(agentOf(after, invites.id), agentOf(before, invites.id));
        assert.equal(agentOf(after, billing.id)?.title, "CSV export");
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
