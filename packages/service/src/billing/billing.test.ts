/**
 * billing.test.ts -- a workspace's billing to its owner, over the test's own database and a faked Stripe: while billing is off, setting it up and managing it refuse and nothing reaches Stripe; while it is on, setting up opens Checkout in setup mode, and once set up the Portal opens on the workspace's own customer; an account outside the workspace, or a member who is no owner or admin, reads and opens none of it. Synthetic accounts, workspaces, and ids throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  recordMetronomeCustomer,
  recordStripeCustomer,
} from "@repo/database/models/workspace-billing";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@repo/database/testing";
import { INCLUDED_USAGE_MICRO_USD } from "@repo/database/usage-vocabulary";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import { afterEach, vi } from "vitest";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { billingPortal, billingSetup, billingStatus } from "./billing.js";
import { BillingEnvironment, type BillingEnvironmentValues } from "./billing-environment.js";

const ORIGIN = "https://vespin.test";

/** A Stripe request as the fake saw it: its path and its form. */
interface SentToStripe {
  readonly path: string;
  readonly form: URLSearchParams;
}

/** A faked Stripe that answers every session with a page address, keeping each request. */
function stripe() {
  const sent: SentToStripe[] = [];

  const layer = fakeHttpClientLayer((url, init) => {
    const path = new URL(url).pathname;
    sent.push({ path, form: new URLSearchParams(String(init.body)) });

    return new Response(JSON.stringify({ url: `https://stripe.test${path}` }), { status: 200 });
  });

  return { layer, sent };
}

function environment(live: boolean): Layer.Layer<BillingEnvironment> {
  const values: BillingEnvironmentValues = {
    live,
    metronome: undefined,
    metronomeWebhookSecret: undefined,
    stripeSecretKey: Redacted.make("stripe-test-key"),
    stripeWebhookSecret: undefined,
    exemptWorkspaceId: undefined,
  };

  return Layer.succeed(BillingEnvironment, values);
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("a workspace's billing", (it) => {
  it.effect(
    "refuses to set billing up or manage it, and calls no Stripe, while billing is off",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("APP_DEPLOYMENT_ORIGIN", ORIGIN);
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);
        const fake = stripe();
        const services = Layer.merge(fake.layer, environment(false));

        assert.deepEqual(yield* billingStatus(owner, acme).pipe(Effect.provide(services)), {
          live: false,
          setUp: false,
          blocked: false,
          usage: [],
          includedMicroUsd: INCLUDED_USAGE_MICRO_USD,
          owedMicroUsd: 0,
        });
        assert.deepEqual(
          yield* billingSetup(owner, acme).pipe(Effect.provide(services), Effect.flip),
          HOSTED_REFUSAL.UNAVAILABLE,
        );
        assert.deepEqual(
          yield* billingPortal(owner, acme).pipe(Effect.provide(services), Effect.flip),
          HOSTED_REFUSAL.UNAVAILABLE,
        );
        assert.deepEqual(fake.sent, []);
      }),
  );

  it.effect(
    "opens Checkout in setup mode, and once set up opens the Portal on the workspace's customer",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("APP_DEPLOYMENT_ORIGIN", ORIGIN);
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);
        const fake = stripe();
        const services = Layer.merge(fake.layer, environment(true));

        assert.deepEqual(
          yield* billingPortal(owner, acme).pipe(Effect.provide(services), Effect.flip),
          HOSTED_REFUSAL.NOT_FOUND,
        );
        assert.deepEqual(yield* billingSetup(owner, acme).pipe(Effect.provide(services)), {
          url: "https://stripe.test/v1/checkout/sessions",
        });
        assert.deepEqual(Object.fromEntries(fake.sent[0]?.form ?? []), {
          mode: "setup",
          currency: "usd",
          client_reference_id: acme,
          success_url: `${ORIGIN}/app`,
          cancel_url: `${ORIGIN}/app`,
          customer_creation: "always",
        });

        const customer = `cus_${randomUUID()}`;
        yield* recordMetronomeCustomer(acme, `customer-${acme}`);
        yield* recordStripeCustomer(acme, customer);

        assert.equal(
          (yield* billingStatus(owner, acme).pipe(Effect.provide(services))).setUp,
          true,
        );
        yield* billingSetup(owner, acme).pipe(Effect.provide(services));
        assert.equal(fake.sent[1]?.form.get("customer"), customer);
        assert.deepEqual(yield* billingPortal(owner, acme).pipe(Effect.provide(services)), {
          url: "https://stripe.test/v1/billing_portal/sessions",
        });
        assert.deepEqual(Object.fromEntries(fake.sent[2]?.form ?? []), {
          customer,
          return_url: `${ORIGIN}/app`,
        });
      }),
  );

  it.effect("refuses an outsider and a member who is no owner or admin, and calls no Stripe", () =>
    Effect.gen(function* () {
      vi.stubEnv("APP_DEPLOYMENT_ORIGIN", ORIGIN);
      const owner = yield* openAccount;
      const member = yield* openAccount;
      const outsider = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      yield* joinWorkspace(acme, member, WORKSPACE_ROLE.MEMBER);
      yield* recordMetronomeCustomer(acme, `customer-${acme}`);
      yield* recordStripeCustomer(acme, `cus_${randomUUID()}`);
      const fake = stripe();
      const services = Layer.merge(fake.layer, environment(true));

      for (const [caller, refusal] of [
        [outsider, HOSTED_REFUSAL.NOT_FOUND],
        [member, HOSTED_REFUSAL.NOT_PERMITTED],
      ] as const) {
        for (const operation of [billingStatus, billingSetup, billingPortal]) {
          assert.deepEqual(
            yield* operation(caller, acme).pipe(Effect.provide(services), Effect.flip),
            refusal,
          );
        }
      }

      assert.deepEqual(fake.sent, []);
    }),
  );
});
