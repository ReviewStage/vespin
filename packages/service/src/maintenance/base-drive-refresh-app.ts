/**
 * base-drive-refresh-app.ts -- the daily base drive refresh as Vercel's cron calls it, under the deployment's `CRON_SECRET`.
 *
 * The refresh (`agents/base-drive-refresh.ts`) is a group of its own, kept
 * out of the sweep's so its function's longer bound is its alone. It answers
 * a GET under the deployment's own `CRON_SECRET`, compared in constant time,
 * as the sweep does; a deployment missing the secret answers unavailable and
 * refreshes nothing. It answers what the run did, and an error status where
 * any drive's refill failed, so the cron's log shows it.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Sandbox } from "@repo/sandbox";
import { Effect, Layer, type Redacted } from "effect";
import { type HttpClient, HttpRouter } from "effect/http";
import { refreshBaseDrives } from "../agents/base-drive-refresh.js";
import type { AgentImage } from "../agents/coder-host/agent-image.js";
import type { SandboxRunner } from "../agents/machine/sandbox-machine.js";
import { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { BASE_DRIVE_REFRESH_PATH } from "./maintenance-bounds.js";

type RefreshServices = DatabaseServices | GitHubApp | HttpClient.HttpClient | Sandbox;

/** What the group is made with: the edge's runner a refill's checkout runs through, and the agents' image the function ships. */
export interface BaseDriveRefreshAppOptions {
  readonly run: SandboxRunner;
  readonly image: Layer.Layer<AgentImage>;
}

/** What the refresh's endpoint is handed: the request, the deployment's secret, and the refresh to run. */
interface BaseDriveRefreshOptions<E> {
  readonly request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  readonly cronSecret: Redacted.Redacted | undefined;
  readonly refresh: Effect.Effect<{ readonly failed: number }, E, RefreshServices>;
}

/** The refresh as its endpoint answers it: a GET under the deployment's secret, answered with what the run did. */
const handleBaseDriveRefresh = /* @__PURE__ */ Effect.fn("web/handleBaseDriveRefresh")(function* <
  E,
>(options: BaseDriveRefreshOptions<E>): Effect.fn.Return<Response, E, RefreshServices> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  if (options.cronSecret === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!bearerMatchesSecret(request, options.cronSecret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  // Note that no member waits on the refresh, so what it asks GitHub waits in the background lane (`github-rate-gate.ts`).
  const refreshed = yield* options.refresh.pipe(Effect.provideService(GitHubBackground, true));
  return jsonResponse(
    refreshed.failed > 0 ? HOSTED_HTTP_STATUS.INTERNAL_ERROR : HOSTED_HTTP_STATUS.OK,
    refreshed,
  );
});

/** The refresh's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function baseDriveRefreshApp(
  options: BaseDriveRefreshAppOptions,
): WebRoutes<RefreshServices | HostedEnvironment> {
  const refreshEffect = Effect.fn("web/baseDriveRefreshEffect")(function* (request: Request) {
    const environment = yield* HostedEnvironment;
    return yield* handleBaseDriveRefresh({
      request,
      cronSecret: environment.cronSecret,
      refresh: refreshBaseDrives(options.run).pipe(Effect.provide(options.image)),
    });
  });
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, BASE_DRIVE_REFRESH_PATH, effectPassthrough(refreshEffect)),
    hostedNotFoundRoute,
  );
}
