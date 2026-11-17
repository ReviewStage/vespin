/**
 * stripe-webhook-app.ts -- Stripe's webhook: a card saved through Checkout made the workspace's default and its Metronome contract linked to Stripe, a card kept default after a Portal change, and a workspace blocked while an invoice it owes is uncollectible.
 *
 * Stripe signs each delivery with the endpoint's secret
 * (`STRIPE_WEBHOOK_SECRET`, `billing-environment.ts`): the `Stripe-Signature`
 * header carries a timestamp `t` and one or more `v1` signatures, each the
 * hex HMAC-SHA256 of `t`, a dot, and the body's own bytes
 * (https://docs.stripe.com/webhooks#verify-manually); one must match, and a
 * timestamp more than five minutes off our clock is refused as a replay.
 * Nothing of a delivery is read before its signature holds, and a
 * deployment with no secret refuses every delivery. While billing is off,
 * a verified delivery is acknowledged unread, so nothing here calls Stripe.
 *
 * - `checkout.session.completed` in setup mode: the SetupIntent's card is
 *   made the customer's `invoice_settings.default_payment_method`, which
 *   Metronome's `charge_automatically` needs, then the workspace's Metronome
 *   contract (made here where it has none yet, from this month) is linked
 *   to the Stripe customer from the start of its current period, and the
 *   customer is recorded, which is what "set up" means. A workspace already
 *   linked to that customer only has its card made default again.
 * - `customer.updated` for a workspace's customer left with no default card,
 *   as one removed in the Portal leaves it: its newest card is made default.
 * - `invoice.marked_uncollectible` blocks the workspace; `invoice.paid`
 *   lifts the block.
 *
 * Every other event is acknowledged at once, `invoice.created` among them,
 * since Stripe holds an invoice's charge while its delivery fails. A step
 * that fails is logged and answered unavailable, so Stripe delivers the
 * event again; each step may be taken twice.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  recordStripeCustomer,
  setStripeCustomerBlocked,
  workspaceBilling,
  workspaceBillingOfStripeCustomer,
} from "@repo/database/models/workspace-billing";
import { HTTP_METHOD, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import { EXCESS_KEYS } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { BillingEnvironment, type BillingEnvironmentValues } from "./billing-environment.js";
import { linkMetronomeToStripe, MetronomeCallFailed } from "./metronome.js";
import {
  newestPaymentMethod,
  StripeCallFailed,
  setDefaultPaymentMethod,
  setupIntentPaymentMethod,
} from "./stripe.js";
import { workspaceContract } from "./workspace-contract.js";

/** The path Stripe delivers to, under the deployment's origin. */
export const STRIPE_WEBHOOK_PATH = "/api/billing/stripe-webhook";

/** Stripe's events are small; bounded all the same before anything is read. */
const MAXIMUM_DELIVERY_BYTES = 1024 * 1024;

const SIGNATURE_HEADER = "stripe-signature";

/** The parts of `Stripe-Signature` read: the timestamp and the signatures of the scheme Stripe signs with. */
const SIGNATURE_PART = {
  TIMESTAMP: "t",
  V1: "v1",
} as const;

/** How far a delivery's timestamp may stand from our clock, as Stripe's libraries allow. */
const TIMESTAMP_TOLERANCE = Duration.minutes(5);

/** The events read; every other is acknowledged unread. */
const STRIPE_EVENT = {
  CHECKOUT_COMPLETED: "checkout.session.completed",
  CUSTOMER_UPDATED: "customer.updated",
  INVOICE_UNCOLLECTIBLE: "invoice.marked_uncollectible",
  INVOICE_PAID: "invoice.paid",
} as const;

/** The Checkout mode a card is saved in. */
const SETUP_MODE = "setup";

const MILLIS_PER_SECOND = 1000;

/** An event as far as its type is read; its object is read by the type's own schema. */
const EventSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({ object: Schema.Unknown }),
});

const readEvent = readEither(EventSchema, { excess: EXCESS_KEYS.DROP });

const CheckoutSchema = Schema.Struct({
  mode: Schema.String,
  customer: Schema.NullOr(Schema.String),
  setup_intent: Schema.NullOr(Schema.String),
  client_reference_id: Schema.NullOr(Schema.String),
});

const readCheckout = readEither(CheckoutSchema, { excess: EXCESS_KEYS.DROP });

const CustomerSchema = Schema.Struct({
  id: Schema.String,
  invoice_settings: Schema.Struct({ default_payment_method: Schema.NullOr(Schema.String) }),
});

const readCustomer = readEither(CustomerSchema, { excess: EXCESS_KEYS.DROP });

const InvoiceSchema = Schema.Struct({ customer: Schema.NullOr(Schema.String) });

const readInvoice = readEither(InvoiceSchema, { excess: EXCESS_KEYS.DROP });

/** Whether one of the header's `v1` signatures is the hex HMAC-SHA256 of its timestamp, a dot, and the body under the secret, compared in constant time; answers the timestamp in seconds where one is. */
function signedAt(header: string, body: Uint8Array, secret: Redacted.Redacted): number | undefined {
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === SIGNATURE_PART.TIMESTAMP)?.[1];

  if (timestamp === undefined || !/^\d+$/.test(timestamp)) return undefined;

  // The secret is revealed here alone, into the HMAC the compare reads.
  const wanted = createHmac("sha256", Redacted.value(secret))
    .update(`${timestamp}.`)
    .update(body)
    .digest();

  const matched = parts.some(([key, value]) => {
    if (key !== SIGNATURE_PART.V1 || value === undefined) return false;
    const offered = Buffer.from(value, "hex");

    return offered.length === wanted.length && timingSafeEqual(offered, wanted);
  });

  return matched ? Number(timestamp) : undefined;
}

/** A failed step, logged by what failed and answered unavailable, so Stripe delivers the event again. */
function stepFailed(failure: StripeCallFailed | MetronomeCallFailed) {
  return Effect.logError(
    `a Stripe event's billing step failed, to be delivered again: ${failure.path} answered ${failure.status ?? "nothing"}: ${failure.message}`,
  ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)));
}

/** An event's object read by its schema, or nothing where it does not read. */
function objectOf<A>(
  read: (value: UnparsedWireValue) => Result.Result<A, unknown>,
  object: UnparsedWireValue,
): A | undefined {
  const result = read(object);

  return Result.isSuccess(result) ? result.success : undefined;
}

/** A card saved through Checkout made default, and the workspace's Metronome contract linked to its Stripe customer, once. */
const checkoutCompleted = Effect.fn("web/stripeCheckoutCompleted")(function* (
  environment: BillingEnvironmentValues,
  key: Redacted.Redacted,
  object: UnparsedWireValue,
) {
  const session = objectOf(readCheckout, object);

  if (
    session === undefined ||
    session.mode !== SETUP_MODE ||
    session.customer === null ||
    session.client_reference_id === null
  ) {
    return;
  }

  const customer = session.customer;
  const workspaceId = session.client_reference_id;

  const card =
    session.setup_intent === null
      ? null
      : yield* setupIntentPaymentMethod(key, session.setup_intent);

  if (card !== null) yield* setDefaultPaymentMethod(key, customer, card);

  const standing = Option.getOrUndefined(
    yield* hostedStoreOrUnavailable(workspaceBilling(workspaceId)),
  );

  if (standing?.stripeCustomerId === customer) return;

  if (environment.metronome === undefined) {
    yield* Effect.logError(
      "a workspace set billing up, but no Metronome account is configured to link",
    );

    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }

  const now = new Date(yield* Clock.currentTimeMillis);

  const contract = yield* workspaceContract(environment.metronome, workspaceId, standing, now).pipe(
    Effect.tapError((failure) =>
      failure instanceof MetronomeCallFailed
        ? Effect.void
        : Effect.logError("a workspace's Metronome contract could not be recorded"),
    ),
    Effect.mapError((failure) =>
      failure instanceof MetronomeCallFailed ? failure : HOSTED_REFUSAL.UNAVAILABLE,
    ),
  );

  yield* linkMetronomeToStripe(environment.metronome, { ...contract, stripeCustomerId: customer });
  yield* hostedStoreOrUnavailable(recordStripeCustomer(workspaceId, customer));
});

/** A workspace's customer left with no default card has its newest made default. */
const customerUpdated = Effect.fn("web/stripeCustomerUpdated")(function* (
  key: Redacted.Redacted,
  object: UnparsedWireValue,
) {
  const customer = objectOf(readCustomer, object);

  if (customer === undefined || customer.invoice_settings.default_payment_method !== null) return;
  const known = yield* hostedStoreOrUnavailable(workspaceBillingOfStripeCustomer(customer.id));

  if (Option.isNone(known)) return;
  const newest = yield* newestPaymentMethod(key, customer.id);

  if (newest !== null) yield* setDefaultPaymentMethod(key, customer.id, newest);
});

/** A workspace blocked from the instant its invoice was given up on, or its block lifted once one is paid. */
const invoiceSettled = Effect.fn("web/stripeInvoiceSettled")(function* (
  object: UnparsedWireValue,
  blockedAt: Date | null,
) {
  const customer = objectOf(readInvoice, object)?.customer;

  if (customer == null) return;
  yield* hostedStoreOrUnavailable(setStripeCustomerBlocked(customer, blockedAt));
});

/** POST: one delivery, its signature and timestamp confirmed before anything of it is read. */
const deliveryEndpoint = /* @__PURE__ */ Effect.fn("web/stripeWebhookEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    | HttpServerRequest.HttpServerRequest
    | BillingEnvironment
    | DatabaseServices
    | HttpClient.HttpClient
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }

    const environment = yield* BillingEnvironment;

    if (environment.stripeWebhookSecret === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }

    const body = yield* readBodyBytesEffect(MAXIMUM_DELIVERY_BYTES);

    const at = signedAt(
      request.headers[SIGNATURE_HEADER] ?? "",
      body,
      environment.stripeWebhookSecret,
    );

    const now = yield* Clock.currentTimeMillis;

    if (
      at === undefined ||
      Math.abs(now - at * MILLIS_PER_SECOND) > Duration.toMillis(TIMESTAMP_TOLERANCE)
    ) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }

    const read = readEvent(yield* parseJsonBytes(body));

    if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const event = read.success;
    // SAFETY: the object is a JSON value of the parsed body; each event's own schema reads it.
    const object = event.data.object as UnparsedWireValue;
    const key = environment.stripeSecretKey;

    if (!environment.live || key === undefined) return hostedJsonResponse(200, { received: true });

    const handled = Effect.gen(function* () {
      if (event.type === STRIPE_EVENT.CHECKOUT_COMPLETED) {
        yield* checkoutCompleted(environment, key, object);
      } else if (event.type === STRIPE_EVENT.CUSTOMER_UPDATED) {
        yield* customerUpdated(key, object);
      } else if (event.type === STRIPE_EVENT.INVOICE_UNCOLLECTIBLE) {
        yield* invoiceSettled(object, new Date(now));
      } else if (event.type === STRIPE_EVENT.INVOICE_PAID) {
        yield* invoiceSettled(object, null);
      }
    });

    yield* handled.pipe(
      Effect.catchIf(
        (failure): failure is StripeCallFailed | MetronomeCallFailed =>
          failure instanceof StripeCallFailed || failure instanceof MetronomeCallFailed,
        stepFailed,
      ),
    );

    return hostedJsonResponse(200, { received: true });
  },
);

/** The group: the one delivery path, and the hosted vocabulary's own refusal for any other. */
export function stripeWebhookApp(): WebRoutes<
  BillingEnvironment | DatabaseServices | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, STRIPE_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint())),
    hostedNotFoundRoute,
  );
}
