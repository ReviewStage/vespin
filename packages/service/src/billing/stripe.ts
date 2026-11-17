/**
 * stripe.ts -- the calls we make to Stripe, which collects what Metronome invoices: a Checkout page in setup mode to save a card, the Customer Portal to change it and see invoices, and a customer's default card kept set.
 *
 * Stripe's API takes form-encoded bodies (https://docs.stripe.com/api), so
 * these go over the plain `HttpClient` rather than our JSON call. Every call
 * carries the deployment's secret key as its bearer; a refusal fails with
 * its path, its status, and Stripe's own error type and message, never the
 * key. Nothing here is tried again: each caller is a press of a member's,
 * or a webhook Stripe delivers again where we answer an error.
 */

import type { UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Data, Effect, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { EXCESS_KEYS } from "../core.js";

/** Stripe's API, as https://docs.stripe.com/api names it. */
const STRIPE = {
  BASE_URL: "https://api.stripe.com",
  CHECKOUT_SESSIONS_PATH: "/v1/checkout/sessions",
  PORTAL_SESSIONS_PATH: "/v1/billing_portal/sessions",
  SETUP_INTENTS_PATH: "/v1/setup_intents",
  CUSTOMERS_PATH: "/v1/customers",
} as const;

/** What a Checkout Session in setup mode saves a card for: Metronome's invoices, in dollars. */
const SETUP_SESSION = {
  MODE: "setup",
  CURRENCY: "usd",
  /** Where no Stripe customer is kept yet, Checkout makes one as the session completes. */
  CUSTOMER_CREATION: "always",
} as const;

/** The longest of Stripe's own message a failure keeps. */
const MESSAGE_LIMIT = 300;

/** A call Stripe refused or never answered: its path, its status where it answered, and Stripe's own error type and message where it gave them. */
export class StripeCallFailed extends Data.TaggedError("StripeCallFailed")<{
  readonly path: string;
  readonly status: number | undefined;
  readonly message: string;
}> {}

/** A form body as Stripe reads it: each key already bracketed where it is nested (`metadata[workspace_id]`). */
type StripeForm = readonly (readonly [string, string])[];

const UrlSchema = Schema.Struct({ url: Schema.String });

const readUrl = readEither(UrlSchema, { excess: EXCESS_KEYS.DROP });

const SetupIntentSchema = Schema.Struct({ payment_method: Schema.NullOr(Schema.String) });

const readSetupIntent = readEither(SetupIntentSchema, { excess: EXCESS_KEYS.DROP });

const PaymentMethodsSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

const readPaymentMethods = readEither(PaymentMethodsSchema, { excess: EXCESS_KEYS.DROP });

const ErrorSchema = Schema.Struct({
  error: Schema.Struct({ type: Schema.String, message: Schema.optionalKey(Schema.String) }),
});

const readError = readEither(ErrorSchema, { excess: EXCESS_KEYS.DROP });

/** A body as JSON, or nothing where it is not JSON at all. */
function jsonOrNothing(body: string): UnparsedWireValue {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** One request to Stripe under the key, answered with its JSON where it was 2xx. */
function stripeRequest(
  key: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  path: string,
): Effect.Effect<UnparsedWireValue, StripeCallFailed, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      // The key is revealed here alone, into the header the request carries.
      HttpClientRequest.bearerToken(request, Redacted.value(key)),
    ).pipe(
      Effect.mapError(
        (error) => new StripeCallFailed({ path, status: undefined, message: error.reason._tag }),
      ),
    );

    const read = jsonOrNothing(yield* response.text.pipe(Effect.orElseSucceed(() => "")));

    if (response.status >= 200 && response.status < 300) return read;
    const refusal = readError(read);

    return yield* new StripeCallFailed({
      path,
      status: response.status,
      message: Result.isSuccess(refusal)
        ? `${refusal.success.error.type}: ${refusal.success.error.message ?? ""}`.slice(
            0,
            MESSAGE_LIMIT,
          )
        : "",
    });
  });
}

/** A POST of the form to the path. */
function stripePost(key: Redacted.Redacted, path: string, form: StripeForm) {
  return stripeRequest(
    key,
    HttpClientRequest.bodyUrlParams(HttpClientRequest.post(`${STRIPE.BASE_URL}${path}`), form),
    path,
  );
}

/** A GET of the path. */
function stripeGet(key: Redacted.Redacted, path: string, query: StripeForm = []) {
  return stripeRequest(
    key,
    HttpClientRequest.setUrlParams(HttpClientRequest.get(`${STRIPE.BASE_URL}${path}`), query),
    path,
  );
}

/** The answer read by its schema, or a failure where it does not read. */
function readAnswer<A>(
  path: string,
  read: (input: UnparsedWireValue) => Result.Result<A, unknown>,
  answer: UnparsedWireValue,
): Effect.Effect<A, StripeCallFailed> {
  const result = read(answer);

  return Result.isSuccess(result)
    ? Effect.succeed(result.success)
    : Effect.fail(new StripeCallFailed({ path, status: undefined, message: "unreadable answer" }));
}

/**
 * A Checkout Session in setup mode that saves a card for the workspace,
 * answered as the page's address
 * (https://docs.stripe.com/payments/checkout/save-and-reuse). It names the
 * workspace's Stripe customer where one is kept, and otherwise asks Checkout
 * to make one as the session completes, so a session left unfinished leaves
 * no customer behind. The workspace's id rides as its reference, which the
 * webhook reads back.
 */
export const createSetupCheckout = Effect.fn("web/createStripeSetupCheckout")(function* (
  key: Redacted.Redacted,
  session: {
    readonly workspaceId: string;
    readonly stripeCustomerId: string | null;
    readonly returnUrl: string;
  },
) {
  const form: StripeForm = [
    ["mode", SETUP_SESSION.MODE],
    ["currency", SETUP_SESSION.CURRENCY],
    ["client_reference_id", session.workspaceId],
    ["success_url", session.returnUrl],
    ["cancel_url", session.returnUrl],
    session.stripeCustomerId === null
      ? ["customer_creation", SETUP_SESSION.CUSTOMER_CREATION]
      : ["customer", session.stripeCustomerId],
  ];

  const answer = yield* stripePost(key, STRIPE.CHECKOUT_SESSIONS_PATH, form);

  return (yield* readAnswer(STRIPE.CHECKOUT_SESSIONS_PATH, readUrl, answer)).url;
});

/** A Customer Portal session for the customer, answered as the page's address; the portal's own settings say what it offers. */
export const createPortalSession = Effect.fn("web/createStripePortalSession")(function* (
  key: Redacted.Redacted,
  stripeCustomerId: string,
  returnUrl: string,
) {
  const answer = yield* stripePost(key, STRIPE.PORTAL_SESSIONS_PATH, [
    ["customer", stripeCustomerId],
    ["return_url", returnUrl],
  ]);

  return (yield* readAnswer(STRIPE.PORTAL_SESSIONS_PATH, readUrl, answer)).url;
});

/** The card a SetupIntent saved; none where it saved none. */
export const setupIntentPaymentMethod = Effect.fn("web/stripeSetupIntentPaymentMethod")(function* (
  key: Redacted.Redacted,
  setupIntentId: string,
) {
  const path = `${STRIPE.SETUP_INTENTS_PATH}/${encodeURIComponent(setupIntentId)}`;
  const answer = yield* stripeGet(key, path);

  return (yield* readAnswer(path, readSetupIntent, answer)).payment_method;
});

/** The customer's newest saved card; none where it has none. */
export const newestPaymentMethod = Effect.fn("web/stripeNewestPaymentMethod")(function* (
  key: Redacted.Redacted,
  stripeCustomerId: string,
) {
  const path = `${STRIPE.CUSTOMERS_PATH}/${encodeURIComponent(stripeCustomerId)}/payment_methods`;
  const answer = yield* stripeGet(key, path, [["limit", "1"]]);

  return (yield* readAnswer(path, readPaymentMethods, answer)).data[0]?.id ?? null;
});

/** Makes the card the one the customer's invoices are charged to, as Metronome's `charge_automatically` needs. */
export const setDefaultPaymentMethod = Effect.fn("web/stripeSetDefaultPaymentMethod")(function* (
  key: Redacted.Redacted,
  stripeCustomerId: string,
  paymentMethodId: string,
) {
  yield* stripePost(key, `${STRIPE.CUSTOMERS_PATH}/${encodeURIComponent(stripeCustomerId)}`, [
    ["invoice_settings[default_payment_method]", paymentMethodId],
  ]);
});
