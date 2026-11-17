import { metronomeWebhookApp } from "@repo/service/billing/metronome-webhook-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Metronome's webhook, which Metronome delivers its invoice events to. It
 * only publishes: the logic lives in
 * `packages/service/src/billing/metronome-webhook-app.ts`.
 */
export default routeFromHttpRouter(metronomeWebhookApp());
