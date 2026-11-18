/**
 * billing-gate.test.ts -- the start gate over a real dialect: a workspace past the month's included usage with no billing is refused only while billing is on, starts again once billing is set up or the month turns, is refused as blocked once an invoice is given up on, and Stage's own workspace never is. Synthetic accounts, workspaces, and sessions throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { recordUsageCharges } from "@repo/database/models/usage-charges";
import {
  recordMetronomeCustomer,
  recordStripeCustomer,
  setStripeCustomerBlocked,
} from "@repo/database/models/workspace-billing";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, sessionCharge } from "@repo/database/testing";
import { BILLING_REFUSAL } from "@repo/features/billing-refusal-wire";
import { Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR } from "../http/http.js";
import { BillingEnvironment } from "./billing-environment.js";
import { cloudStartGate } from "./billing-gate.js";

/** Midway through November 2026. */
const NOW = Date.UTC(2026, 10, 16, 12);

/** The first instant of December 2026, when November's usage no longer counts. */
const DECEMBER = Date.UTC(2026, 11, 1);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

function environment(live: boolean, exemptWorkspaceId?: string): Layer.Layer<BillingEnvironment> {
  return Layer.succeed(BillingEnvironment, {
    live,
    metronome: undefined,
    metronomeWebhookSecret: undefined,
    stripeSecretKey: undefined,
    stripeWebhookSecret: undefined,
    exemptWorkspaceId,
  });
}

/** What the gate answers the member's cloud Start in the workspace: nothing where it starts, else the refusal. */
const gateOf = (userId: string, workspaceId: string, billing: Layer.Layer<BillingEnvironment>) =>
  Effect.map(Effect.exit(Effect.provide(cloudStartGate(userId, workspaceId), billing)), (exit) =>
    Exit.isSuccess(exit) ? undefined : Exit.findErrorOption(exit),
  );

it.layer(getTestDB())("the billing gate on cloud starts", (it) => {
  it.effect(
    "refuses a workspace past $10 with no billing, until billing is set up or the month turns",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const [ada, grace] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(ada);
        yield* joinWorkspace(acme, grace);
        const live = environment(true);

        yield* recordUsageCharges([sessionCharge(acme, ada, 9.99, "2026-11-02T00:00:00Z")]);

        assert.equal(yield* gateOf(ada, acme, live), undefined);

        yield* recordUsageCharges([sessionCharge(acme, grace, 0.01, "2026-11-03T00:00:00Z")]);
        const refused = yield* gateOf(ada, acme, live);

        assert.deepEqual(refused?._tag === "Some" ? refused.value : undefined, {
          error: HOSTED_API_ERROR.BILLING_REQUIRED,
          billingRefusal: BILLING_REFUSAL.SET_UP,
          billingManager: true,
        });

        // A member who is neither an owner nor an admin is told so, offered nothing to set up.
        const toMember = yield* gateOf(grace, acme, live);

        assert.equal(toMember?._tag === "Some" && toMember.value.billingManager, false);

        yield* TestClock.setTime(DECEMBER);

        assert.equal(yield* gateOf(ada, acme, live), undefined);

        yield* TestClock.setTime(NOW);
        const stripeCustomer = `cus_${randomUUID()}`;
        yield* recordMetronomeCustomer(acme, `customer-${acme}`);
        yield* recordStripeCustomer(acme, stripeCustomer);

        assert.equal(yield* gateOf(ada, acme, live), undefined);

        yield* setStripeCustomerBlocked(stripeCustomer, new Date(NOW));
        const blocked = yield* gateOf(ada, acme, live);

        assert.equal(
          blocked?._tag === "Some" && blocked.value.billingRefusal,
          BILLING_REFUSAL.BLOCKED,
        );

        // Stage's own workspace starts whatever it owes.
        assert.equal(yield* gateOf(ada, acme, environment(true, acme)), undefined);
      }),
  );

  it.effect("refuses nothing while billing is off", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const ada = yield* openAccount;
      const globex = yield* openWorkspace(ada);

      yield* recordUsageCharges([sessionCharge(globex, ada, 25, "2026-11-04T00:00:00Z")]);

      assert.equal(yield* gateOf(ada, globex, environment(false)), undefined);
    }),
  );
});
