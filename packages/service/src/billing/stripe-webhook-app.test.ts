/**
 * stripe-webhook-app.test.ts -- Stripe's webhook as its route answers it, over the test's own database and a faked Stripe and Metronome: a completed setup makes the saved card default, links the workspace's Metronome contract to Stripe, and records it set up; an uncollectible invoice blocks the workspace and a paid one lifts the block; a forged delivery is refused; and while billing is off nothing is called. Synthetic secrets, accounts, workspaces, and ids throughout.
 */

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  recordMetronomeCustomer,
  recordStripeCustomer,
  workspaceBilling,
} from "@repo/database/models/workspace-billing";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { BillingEnvironment, type BillingEnvironmentValues } from "./billing-environment.js";
import { STRIPE_WEBHOOK_PATH, stripeWebhookApp } from "./stripe-webhook-app.js";

const SECRET = "whsec_test";
const NOW = new Date("2026-11-17T12:00:00Z");

/** A request one of the fakes was sent: its host, path, and body as text. */
interface Sent {
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

/** Faked Stripe and Metronome together: a SetupIntent that saved `pm_saved`, and every other call taken, a create answered with a new id. */
function upstreams() {
  const sent: Sent[] = [];

  const layer = fakeHttpClientLayer((url, init) => {
    const { host, pathname } = new URL(url);
    sent.push({
      host,
      method: init.method ?? "GET",
      path: pathname,
      body: String(init.body ?? ""),
    });

    const answer = pathname.startsWith("/v1/setup_intents/")
      ? { payment_method: "pm_saved" }
      : { data: { id: randomUUID() } };

    return new Response(JSON.stringify(answer), { status: 200 });
  });

  return { layer, sent };
}

function environment(live: boolean): BillingEnvironmentValues {
  return {
    live,
    metronome: {
      apiToken: Redacted.make("metronome-test-token"),
      rateCardId: "rate-card-1",
      creditProductId: "credit-product-1",
    },
    metronomeWebhookSecret: undefined,
    stripeSecretKey: Redacted.make("stripe-test-key"),
    stripeWebhookSecret: Redacted.make(SECRET),
  };
}

/** The fields of the Stripe objects these events carry, as the webhook reads them. */
interface EventObject {
  readonly mode?: string;
  readonly customer?: string;
  readonly setup_intent?: string;
  readonly client_reference_id?: string;
}

/** An event delivered as Stripe signs one, at `now`, under `secret`. */
function delivery(type: string, object: EventObject, secret = SECRET): Request {
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, type, data: { object } });
  const timestamp = Math.floor(NOW.getTime() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  return new Request(new URL(STRIPE_WEBHOOK_PATH, "https://vespin.test"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body,
  });
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** The status the route answers the delivery with, over the fakes and the billing environment given. */
const answer = Effect.fn(function* (
  request: Request,
  fakes: ReturnType<typeof upstreams>,
  billing: BillingEnvironmentValues,
) {
  const services = Layer.mergeAll(
    fakes.layer,
    Layer.succeed(BillingEnvironment, billing),
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
  );

  const { handler, dispose } = HttpRouter.toWebHandler(
    stripeWebhookApp().pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );

  const response = yield* Effect.promise(() => handler(request));
  yield* Effect.promise(() => dispose());

  return response.status;
});

it.layer(getTestDB())("Stripe's webhook", (it) => {
  it.effect(
    "on a completed setup, makes the card default, links Metronome to Stripe, and records the workspace set up",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);
        const customer = `cus_${randomUUID()}`;
        const fakes = upstreams();

        const status = yield* answer(
          delivery("checkout.session.completed", {
            mode: "setup",
            customer,
            setup_intent: "seti_1",
            client_reference_id: acme,
          }),
          fakes,
          environment(true),
        );

        assert.equal(status, 200);
        assert.deepEqual(
          fakes.sent.map((request) => [request.host, request.method, request.path]),
          [
            ["api.stripe.com", "GET", "/v1/setup_intents/seti_1"],
            ["api.stripe.com", "POST", `/v1/customers/${customer}`],
            ["api.metronome.com", "POST", "/v1/customers"],
            ["api.metronome.com", "POST", "/v1/contracts/create"],
            ["api.metronome.com", "POST", "/v1/setCustomerBillingProviderConfigurations"],
            ["api.metronome.com", "POST", "/v2/contracts/edit"],
          ],
        );
        assert.equal(
          new URLSearchParams(fakes.sent[1]?.body).get("invoice_settings[default_payment_method]"),
          "pm_saved",
        );
        assert.deepEqual(JSON.parse(fakes.sent[4]?.body ?? "").data[0].configuration, {
          stripe_customer_id: customer,
          stripe_collection_method: "charge_automatically",
        });
        assert.deepEqual(
          JSON.parse(fakes.sent[5]?.body ?? "").add_billing_provider_configuration_update.schedule,
          { effective_at: "START_OF_CURRENT_PERIOD" },
        );
        assert.equal(Option.getOrThrow(yield* workspaceBilling(acme)).stripeCustomerId, customer);
      }),
  );

  it.effect(
    "blocks a workspace on an uncollectible invoice and lifts the block once one is paid",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);
        const customer = `cus_${randomUUID()}`;
        yield* recordMetronomeCustomer(acme, `customer-${acme}`);
        yield* recordStripeCustomer(acme, customer);

        const blockedAt = Effect.map(
          workspaceBilling(acme),
          (row) => Option.getOrThrow(row).blockedAt,
        );

        yield* answer(
          delivery("invoice.marked_uncollectible", { customer }),
          upstreams(),
          environment(true),
        );
        assert.deepEqual(yield* blockedAt, NOW);

        yield* answer(delivery("invoice.paid", { customer }), upstreams(), environment(true));
        assert.equal(yield* blockedAt, null);
      }),
  );

  it.effect("refuses a forged delivery, and reads nothing while billing is off", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW.getTime());
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      const customer = `cus_${randomUUID()}`;
      yield* recordMetronomeCustomer(acme, `customer-${acme}`);
      yield* recordStripeCustomer(acme, customer);
      const fakes = upstreams();

      const forged = delivery("invoice.marked_uncollectible", { customer }, "whsec_other");
      assert.equal(yield* answer(forged, fakes, environment(true)), 401);

      const checkout = delivery("checkout.session.completed", {
        mode: "setup",
        customer,
        setup_intent: "seti_1",
        client_reference_id: acme,
      });

      assert.equal(yield* answer(checkout, fakes, environment(false)), 200);

      const unread = delivery("invoice.marked_uncollectible", { customer });
      assert.equal(yield* answer(unread, fakes, environment(false)), 200);

      assert.deepEqual(fakes.sent, []);
      assert.equal(Option.getOrThrow(yield* workspaceBilling(acme)).blockedAt, null);
    }),
  );
});
