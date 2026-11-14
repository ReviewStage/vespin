/**
 * workspace-drive-cleanup-app.ts -- the daily workspace drive cleanup as Vercel's cron calls it, under the deployment's `CRON_SECRET`.
 *
 * The cleanup (`agents/workspace-drive-cleanup.ts`) only publishes, one
 * message a workspace on the workspace drive queue, whose consumer prunes
 * each drive. It answers a GET under the deployment's own `CRON_SECRET`,
 * compared in constant time, as the sweep does; a deployment missing the
 * secret answers unavailable and publishes nothing. It answers how many
 * cleanups it published.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { Effect, Layer, type Redacted } from "effect";
import { HttpRouter } from "effect/http";
import type { WorkspaceDriveBuildServices } from "../agents/workspace-drive-builds.js";
import { publishWorkspaceDriveCleanups } from "../agents/workspace-drive-cleanup.js";
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
import { WORKSPACE_DRIVE_CLEANUP_PATH } from "./maintenance-bounds.js";

type CleanupServices = DatabaseServices | WorkspaceDriveBuildServices;

/** What the cleanup's endpoint is handed: the request, the deployment's secret, and the cleanup to run. */
interface WorkspaceDriveCleanupOptions<E> {
  readonly request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  readonly cronSecret: Redacted.Redacted | undefined;
  readonly cleanup: Effect.Effect<{ readonly published: number }, E, CleanupServices>;
}

/** The cleanup as its endpoint answers it: a GET under the deployment's secret, answered with how many cleanups it published. */
const handleWorkspaceDriveCleanup = /* @__PURE__ */ Effect.fn("web/handleWorkspaceDriveCleanup")(
  function* <E>(
    options: WorkspaceDriveCleanupOptions<E>,
  ): Effect.fn.Return<Response, E, CleanupServices> {
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

    return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* options.cleanup);
  },
);

/** The cleanup's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function workspaceDriveCleanupApp(): WebRoutes<CleanupServices | HostedEnvironment> {
  const cleanupEffect = Effect.fn("web/workspaceDriveCleanupEffect")(function* (request: Request) {
    const environment = yield* HostedEnvironment;

    return yield* handleWorkspaceDriveCleanup({
      request,
      cronSecret: environment.cronSecret,
      cleanup: publishWorkspaceDriveCleanups(),
    });
  });

  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACE_DRIVE_CLEANUP_PATH, effectPassthrough(cleanupEffect)),
    hostedNotFoundRoute,
  );
}
