import { HTTP_METHOD, text } from "@repo/wire";
import { Effect, type Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, NO_CREDENTIAL } from "../account-call.js";
import { LINK_ORIGIN } from "../link-home.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import type { FeedbackResult, FeedbackSubmission } from "./submission.js";

const FEEDBACK_ENVIRONMENT = {
  /** Overrides the origin feedback is posted to, for local testing of the delivery path. */
  ORIGIN: "APP_FEEDBACK_ORIGIN",
} as const;

const FEEDBACK_DEFAULTS = {
  /**
   * The one place a submission goes: a small endpoint on our own site that
   * forwards it as email to the founders. Fixed here rather than passed in, so
   * the renderer names an intent and never an address.
   */
  ORIGIN: LINK_ORIGIN,
  // Generous next to the evaluator's timeout, because a submission can carry
  // screenshots and a send that dies mid-upload costs the user a retry.
  REQUEST_TIMEOUT_MS: 30_000,
} as const;

/** What the send failed as, in words the composer can put under its field. */
const FEEDBACK_REFUSAL = {
  UNREACHABLE: "Could not reach the feedback service. Check the connection and try again.",
  REFUSED: "The feedback service did not take that. Try again.",
} as const;

interface FeedbackDeliveryOptions {
  /** The origin feedback is posted to, in place of our own site's. */
  baseUrl?: string;
  requestTimeoutMs?: number;
}

/** A line about the path, on the console: the desktop's main process and a browser tab both have one, and only Node has `process`. */
function report(message: string): void {
  console.error(message);
}

/**
 * Carries one submission to the fixed endpoint through the one call to our
 * own service (`account-call.ts`), which takes no credential here, bounded by
 * the call's own deadline, and answers in the user's terms. A refusal is an
 * answer, never a failure: sending feedback is the user's own action, and
 * what became of it belongs beside the field it left. Nothing about the
 * submission is ever logged — a message to the founders is the user's words,
 * and status codes alone diagnose the path.
 */
interface FeedbackDeliveryEffects {
  deliver(
    submission: FeedbackSubmission,
  ): Effect.Effect<FeedbackResult, never, HttpClient.HttpClient>;
}

/** The delivery as effects over `effect/http`'s `HttpClient` tag, which the caller provides: a browser tab's is its own same-origin fetch. */
export function feedbackDelivery(options: FeedbackDeliveryOptions = {}): FeedbackDeliveryEffects {
  const call = accountCall({
    baseUrl: text(options.baseUrl) ?? FEEDBACK_DEFAULTS.ORIGIN,
    credential: NO_CREDENTIAL,
    requestTimeoutMs: options.requestTimeoutMs ?? FEEDBACK_DEFAULTS.REQUEST_TIMEOUT_MS,
  });

  return {
    deliver: (submission) =>
      Effect.map(
        call.send({
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.FEEDBACK,
          body: JSON.stringify(submission),
        }),
        (answer): FeedbackResult => {
          if (!callAnswered(answer)) {
            report(`Feedback delivery did not complete: ${answer.errorName ?? "unknown error"}`);

            return { delivered: false, reason: FEEDBACK_REFUSAL.UNREACHABLE };
          }

          if (answer.response.ok) return { delivered: true };
          report(`Feedback delivery failed with status ${answer.response.status}`);

          return { delivered: false, reason: FEEDBACK_REFUSAL.REFUSED };
        },
      ),
  };
}

export interface FeedbackDeliveryFetchOptions extends FeedbackDeliveryOptions {
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

/**
 * {@link FeedbackDeliveryEffects} with its `HttpClient` already provided, so
 * what a caller holds is one effect per submission and nothing left to hand
 * it. The run is the caller's own runtime edge.
 */
export interface AmbientFeedbackDelivery {
  deliver(submission: FeedbackSubmission): Effect.Effect<FeedbackResult>;
}

/**
 * Builds the delivery every run gets. There is no key to be missing — the
 * endpoint is public and the destination is fixed — so unlike the evaluator
 * this never answers with nothing; only the origin can be overridden, for
 * testing the path against a local server.
 */
export function feedbackDeliveryFromEnvironment(
  options: FeedbackDeliveryFetchOptions = {},
): AmbientFeedbackDelivery {
  const baseUrl = text(options.baseUrl) ?? text(process.env[FEEDBACK_ENVIRONMENT.ORIGIN]);

  const delivery = feedbackDelivery({
    ...(baseUrl === undefined ? undefined : { baseUrl }),
    ...(options.requestTimeoutMs === undefined
      ? undefined
      : { requestTimeoutMs: options.requestTimeoutMs }),
  });

  const client = options.httpClient ?? FetchHttpClient.layer;

  return {
    deliver: (submission) => Effect.provide(delivery.deliver(submission), client),
  };
}
