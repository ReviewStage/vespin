import { stripeWebhookApp } from "@repo/service/billing/stripe-webhook-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Stripe's webhook, which Stripe delivers its Checkout, customer, and
 * invoice events to. It only publishes: the logic lives in
 * `packages/service/src/billing/stripe-webhook-app.ts`.
 */
export default routeFromHttpRouter(stripeWebhookApp());
