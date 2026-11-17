/**
 * metronome-webhook-app.ts -- Metronome's webhook: an invoice Metronome could not hand to Stripe logged as an error, and every other event acknowledged unread.
 *
 * Metronome signs each delivery with the webhook's secret
 * (`METRONOME_WEBHOOK_SECRET`, `billing-environment.ts`): the
 * `Metronome-Webhook-Signature` header is the hex HMAC-SHA256 of the
 * `X-Metronome-Date` header (or `Date`, where that is all a delivery
 * carries), a newline, and the body's own bytes, and a delivery whose date
 * is more than five minutes off our clock is refused as a replay. Nothing of a delivery is read before its signature
 * holds, and a deployment with no secret refuses every delivery.
 *
 * `invoice.billing_provider_error` says an invoice did not reach Stripe,
 * such as one for a Stripe customer that no longer stands
 * (https://docs.metronome.com/integrations/invoice-integrations/stripe); it
 * is logged as an error by its event's id, its type, and the invoice's id
 * alone. Metronome sends no paid or failed event of its own: those come from
 * Stripe's webhook.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { HTTP_METHOD } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Duration, Effect, Layer, Redacted, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { EXCESS_KEYS } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { BillingEnvironment } from "./billing-environment.js";

/** The path Metronome delivers to, under the deployment's origin. */
export const METRONOME_WEBHOOK_PATH = "/api/billing/metronome-webhook";

/** Metronome's events are small; bounded all the same before anything is read. */
const MAXIMUM_DELIVERY_BYTES = 1024 * 1024;

/** The headers a delivery is signed under: Metronome's own date, or the standard one it still signs for older endpoints, which a proxy may rewrite. */
const DELIVERY_HEADER = {
  DATE: "x-metronome-date",
  LEGACY_DATE: "date",
  SIGNATURE: "metronome-webhook-signature",
} as const;

/** How far a delivery's `Date` may stand from our clock, either way, as Metronome's SDK allows. */
const DATE_TOLERANCE = Duration.minutes(5);

/** The events read; every other is acknowledged unread. */
const METRONOME_EVENT = {
  BILLING_PROVIDER_ERROR: "invoice.billing_provider_error",
} as const;

/** A delivery as far as it is read: its id, its type, and the invoice it names where it names one. */
const DeliverySchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  type: Schema.String,
  properties: Schema.optionalKey(Schema.Struct({ invoice_id: Schema.optionalKey(Schema.String) })),
});

const readDelivery = readEither(DeliverySchema, { excess: EXCESS_KEYS.DROP });

/** Whether the signature is the hex HMAC-SHA256 of the date, a newline, and the body under the secret, compared in constant time. */
function signatureMatches(
  date: string,
  body: Uint8Array,
  signature: string,
  secret: Redacted.Redacted,
): boolean {
  const offered = Buffer.from(signature, "hex");

  // The secret is revealed here alone, into the HMAC the compare reads.
  const wanted = createHmac("sha256", Redacted.value(secret))
    .update(`${date}\n`)
    .update(body)
    .digest();

  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/** POST: one delivery, its signature and date confirmed before anything of it is read. */
const deliveryEndpoint = /* @__PURE__ */ Effect.fn("web/metronomeWebhookEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | BillingEnvironment
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }

    const { metronomeWebhookSecret } = yield* BillingEnvironment;

    if (metronomeWebhookSecret === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }

    const body = yield* readBodyBytesEffect(MAXIMUM_DELIVERY_BYTES);

    const date =
      request.headers[DELIVERY_HEADER.DATE] ?? request.headers[DELIVERY_HEADER.LEGACY_DATE] ?? "";

    const signature = request.headers[DELIVERY_HEADER.SIGNATURE] ?? "";
    const sentAt = Date.parse(date);
    const now = yield* Clock.currentTimeMillis;

    if (
      Number.isNaN(sentAt) ||
      Math.abs(now - sentAt) > Duration.toMillis(DATE_TOLERANCE) ||
      !signatureMatches(date, body, signature, metronomeWebhookSecret)
    ) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }

    const delivery = readDelivery(yield* parseJsonBytes(body));

    if (Result.isFailure(delivery)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const event = delivery.success;

    if (event.type === METRONOME_EVENT.BILLING_PROVIDER_ERROR) {
      yield* Effect.logError(
        `Metronome could not hand an invoice to its billing provider: event ${event.id ?? "unnamed"}, invoice ${event.properties?.invoice_id ?? "unnamed"}`,
      );
    }

    return hostedJsonResponse(200, { received: true });
  },
);

/** The group: the one delivery path, and the hosted vocabulary's own refusal for any other. */
export function metronomeWebhookApp(): WebRoutes<BillingEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, METRONOME_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint())),
    hostedNotFoundRoute,
  );
}
