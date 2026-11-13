import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { entityPool } from "@repo/sync";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { DRAW_TICK, rowWriteOn } from "./live-collection.js";
import { type LiveTaskList, PLAN, taskListCollections } from "./task-list-collections.js";
import { agentListRow, planListRow } from "./testing/task-list-rows.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

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
