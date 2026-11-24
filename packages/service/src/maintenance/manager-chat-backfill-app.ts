/**
 * manager-chat-backfill-app.ts -- the one-time backfill of every Manager's chat, asked by hand under the deployment's secret.
 *
 * The backfill (`manager-chat-backfill.ts`) is a group of its own, asked
 * under the deployment's `CRON_SECRET` rather than any account's bearer,
 * and kept out of the maintenance group so its function carries none of
 * what the sweep reaches.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { MAINTENANCE_MANAGER_CHAT_BACKFILL_PATH } from "./maintenance-bounds.js";
import { handleManagerChatBackfill } from "./manager-chat-backfill.js";

/** One batch of the backfill, under the deployment's secret. */
const managerChatBackfillEffect = /* @__PURE__ */ Effect.fn("web/managerChatBackfillEffect")(
  function* (
    request: Request,
  ): Effect.fn.Return<Response, unknown, DatabaseServices | HostedEnvironment> {
    const environment = yield* HostedEnvironment;

    return yield* handleManagerChatBackfill({ request, cronSecret: environment.cronSecret });
  },
);

/** The backfill's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function managerChatBackfillApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_MANAGER_CHAT_BACKFILL_PATH,
      effectPassthrough(managerChatBackfillEffect),
    ),
    hostedNotFoundRoute,
  );
}
