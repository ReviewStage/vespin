/**
 * metronome-webhook-app.test.ts -- Metronome's webhook as its route answers it: a delivery signed over its date and body under the secret is acknowledged, and one whose signature does not hold, or whose date is past the tolerance, is refused unread. Synthetic secrets and events throughout.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { TestClock } from "effect/testing";
import { BillingEnvironment } from "./billing-environment.js";
import { METRONOME_WEBHOOK_PATH, metronomeWebhookApp } from "./metronome-webhook-app.js";

const SECRET = "metronome-webhook-test-secret";
const NOW = new Date("2026-11-17T12:00:00Z");

const BODY = JSON.stringify({
  id: "event-1",
  type: "invoice.billing_provider_error",
  properties: { invoice_id: "invoice-1" },
});

/** A delivery dated `date`, signed over that date and the body under `secret`, as Metronome signs one. */
function delivery(date: Date, secret: string): Request {
  const dated = date.toUTCString();
  const signature = createHmac("sha256", secret).update(`${dated}\n${BODY}`).digest("hex");

  return new Request(new URL(METRONOME_WEBHOOK_PATH, "https://vespin.test"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      date: dated,
      "metronome-webhook-signature": signature,
    },
    body: BODY,
  });
}

/** The status the route answers the delivery with. */
const answer = Effect.fn(function* (request: Request) {
  const services = Layer.mergeAll(
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    Layer.succeed(BillingEnvironment, {
      metronome: undefined,
      metronomeWebhookSecret: Redacted.make(SECRET),
    }),
  );

  const { handler, dispose } = HttpRouter.toWebHandler(
    metronomeWebhookApp().pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );

  const response = yield* Effect.promise(() => handler(request));
  yield* Effect.promise(() => dispose());

  return response.status;
});

it.effect("acknowledges a signed delivery and refuses a forged or stale one", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW.getTime());

    assert.equal(yield* answer(delivery(NOW, SECRET)), 200);
    assert.equal(yield* answer(delivery(NOW, "another-secret")), 401);
    assert.equal(yield* answer(delivery(new Date(NOW.getTime() - 10 * 60_000), SECRET)), 401);
  }),
);
