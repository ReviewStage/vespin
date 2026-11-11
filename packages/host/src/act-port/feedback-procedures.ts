/**
 * feedback-procedures.ts -- a note to the people who make the app as the act port carries it for a client with no main process to send it, the iOS app's: delivered to the service's feedback endpoint over the HTTP client the client hands in.
 *
 * The desktop's main process sends a note (`telemetry-service.ts`) and the
 * web's tab sends one over its own fetch (`web-host.ts`); the iOS app runs
 * the host in its own process, so it spreads these over the refused
 * platform kinds (`refusedPlatformProcedures`), and `client-parity.ts`
 * offers Send feedback there. What is sent is the submission the form drew
 * (`@repo/features/feedback`), and what came of it is answered, never
 * thrown, as the delivery answers it.
 */

import { feedbackDelivery } from "@repo/features/feedback";
import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { WINDOW_SURFACE_ACT_KIND } from "../contract/index.js";
import { actPortFor, type PlatformActProcedures } from "./base.js";

/** The one platform kind these answer. */
type FeedbackKind = typeof WINDOW_SURFACE_ACT_KIND.FEEDBACK_SEND;

/** Feedback's send, carried to the feedback endpoint on `baseUrl`, the service's origin, over `http`. */
export function feedbackProcedures<Sender>(
  http: HttpClient.HttpClient,
  baseUrl: string,
): Pick<PlatformActProcedures<Sender>, FeedbackKind> {
  const port = actPortFor<Sender>();
  const feedback = feedbackDelivery({ baseUrl });
  const KIND = WINDOW_SURFACE_ACT_KIND;

  return {
    [KIND.FEEDBACK_SEND]: port[KIND.FEEDBACK_SEND].effect(function* ({ input }) {
      return yield* Effect.provideService(
        feedback.deliver(input.submission),
        HttpClient.HttpClient,
        http,
      );
    }),
  };
}
