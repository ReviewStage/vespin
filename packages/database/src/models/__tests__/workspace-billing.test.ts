/**
 * workspace-billing.test.ts -- where each workspace is billed, over a real dialect: the first Metronome customer recorded stands, its contract is recorded on it, and a read answers only the workspaces it names. Synthetic accounts, workspaces, and ids throughout.
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
  workspaceBilling,
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
});
