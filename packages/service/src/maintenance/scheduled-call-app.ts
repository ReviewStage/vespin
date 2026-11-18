/**
 * scheduled-call-app.ts -- a job Vercel's cron calls once a day, as its one path answers it: a GET under the deployment's `CRON_SECRET`, answered with what the job did.
 *
 * Each daily job's group (`workspace-drive-cleanup-app.ts`) is this with its
 * path and its job. The secret is
 * compared in constant time, as the minute sweep's is; a deployment missing
 * it answers unavailable and runs nothing, and a call that is not a GET or
 * not the cron's runs nothing.
 */

import { Effect, Layer, type Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/** The job as its endpoint answers it: a GET under the deployment's secret, answered with what the job did. */
const handleScheduledCall = /* @__PURE__ */ Effect.fn("web/handleScheduledCall")(function* <
  A extends object,
  E,
  R,
>(
  request: Request,
  cronSecret: Redacted.Redacted | undefined,
  job: Effect.Effect<A, E, R>,
): Effect.fn.Return<Response, E, R> {
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  if (cronSecret === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  if (!bearerMatchesSecret(request, cronSecret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* job);
});

/** The daily job's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function scheduledCallApp<A extends object, E, R>(
  path: HttpRouter.PathInput,
  job: Effect.Effect<A, E, R>,
): WebRoutes<R | HostedEnvironment> {
  const answer = Effect.fn("web/scheduledCallEffect")(function* (request: Request) {
    const environment = yield* HostedEnvironment;

    return yield* handleScheduledCall(request, environment.cronSecret, job);
  });

  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, path, effectPassthrough(answer)),
    hostedNotFoundRoute,
  );
}
