/**
 * workspace-billing.test.ts -- where each workspace is billed, over a real dialect: the first Metronome customer recorded stands, its contract is recorded on it, a read answers only the workspaces it names, and a Stripe customer blocks and unblocks its own workspace alone. Synthetic accounts, workspaces, and ids throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  recordMetronomeContract,
  recordMetronomeCustomer,
  recordStripeCustomer,
  setStripeCustomerBlocked,
  workspaceBilling,
  workspaceBillingOfStripeCustomer,
  workspaceBillings,
} from "../workspace-billing.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("workspace billing", (it) => {
  it.effect("keeps the first customer recorded and the contract made on it", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);

      assert.equal(Option.isNone(yield* workspaceBilling(acme)), true);

      const first = yield* recordMetronomeCustomer(acme, "customer-first");
      const second = yield* recordMetronomeCustomer(acme, "customer-second");

      assert.equal(first.metronomeCustomerId, "customer-first");
      assert.equal(second.metronomeCustomerId, "customer-first");

      yield* recordMetronomeContract(acme, "contract-1");

      assert.deepEqual(
        yield* workspaceBilling(acme),
        Option.some({
          organizationId: acme,
          metronomeCustomerId: "customer-first",
          metronomeContractId: "contract-1",
          stripeCustomerId: null,
          blockedAt: null,
        }),
      );
    }),
  );

  it.effect("answers only the workspaces a read names", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const [acme, globex] = [yield* openWorkspace(owner), yield* openWorkspace(owner)];
      yield* recordMetronomeCustomer(acme, "customer-acme");
      yield* recordMetronomeCustomer(globex, "customer-globex");

      const read = yield* workspaceBillings([acme]);

      assert.deepEqual([...read.keys()], [acme]);
      assert.equal(read.get(acme)?.metronomeCustomerId, "customer-acme");
    }),
  );

  it.effect("blocks and unblocks only the workspace whose Stripe customer it is", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const [acme, globex] = [yield* openWorkspace(owner), yield* openWorkspace(owner)];
      const [acmeStripe, globexStripe] = [`cus_${randomUUID()}`, `cus_${randomUUID()}`];

      for (const [workspace, stripe] of [
        [acme, acmeStripe],
        [globex, globexStripe],
      ] as const) {
        yield* recordMetronomeCustomer(workspace, `customer-${workspace}`);
        yield* recordStripeCustomer(workspace, stripe);
      }

      const blockedAt = new Date("2026-12-09T00:00:00Z");

      assert.equal(yield* setStripeCustomerBlocked(acmeStripe, blockedAt), true);
      assert.equal(yield* setStripeCustomerBlocked(`cus_${randomUUID()}`, blockedAt), false);

      const blocked = yield* workspaceBillings([acme, globex]);

      assert.deepEqual(blocked.get(acme)?.blockedAt, blockedAt);
      assert.equal(blocked.get(globex)?.blockedAt, null);
      assert.deepEqual(
        Option.map(
          yield* workspaceBillingOfStripeCustomer(globexStripe),
          (row) => row.organizationId,
        ),
        Option.some(globex),
      );

      yield* setStripeCustomerBlocked(acmeStripe, null);

      assert.equal((yield* workspaceBillings([acme])).get(acme)?.blockedAt, null);
    }),
  );
});
