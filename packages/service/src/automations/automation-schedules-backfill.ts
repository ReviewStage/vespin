import type { DatabaseServices } from "@repo/database/core/query";
import {
  type ScheduledAutomation,
  scheduledAutomations,
} from "@repo/database/models/automation-store";
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
import { MAINTENANCE_AUTOMATION_SCHEDULES_PATH } from "../maintenance/maintenance-bounds.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { AutomationCadence } from "./automation-cadence.js";

/**
 * automation-schedules-backfill.ts -- the one-off keeping of every scheduled automation's Vercel schedule, asked by hand under the deployment's `CRON_SECRET`.
 *
 * An automation saved before its schedule moved to Vercel Schedules has
 * none, so this keeps each one's as a save would (`automation-cadence.ts`),
 * a page at a time in id order: each call keeps up to `PAGE` and answers
 * how many it kept, how many Vercel refused, and the id to ask after next,
 * none once the last page is kept (`scripts/backfill-automation-schedules.sh`
 * walks the pages). Keeping a schedule twice writes it as it stands, so a
 * page asked again is no harm. It runs on the deployment, under the
 * deployment's own token, because a schedule belongs to the environment
 * whose deployment keeps it; off production the cadence keeps nothing.
 */

const BACKFILL = {
  /** The most automations one call keeps, inside Vercel's request limits and the function's bound. */
  PAGE: 100,
  /** How many are kept at once. */
  CONCURRENCY: 4,
  /** The query naming the id the page starts after. */
  AFTER: "after",
} as const;

interface AutomationSchedulesBackfillOptions {
  readonly request: Request;
  /** CRON_SECRET, sealed; undefined means the deployment holds none and the route is off. */
  readonly cronSecret: Redacted.Redacted | undefined;
}

/** Each automation's schedule kept, answering per automation whether it was; a refusal is logged by its code and the rest are still kept. */
const keepEach = Effect.fnUntraced(function* (automations: readonly ScheduledAutomation[]) {
  const cadence = yield* AutomationCadence;
  return yield* Effect.forEach(
    automations,
    (automation) =>
      cadence.keep(automation).pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(
              `an automation's schedule was not kept: ${failure.code ?? "unreachable"}`,
            ),
            false,
          ),
        ),
      ),
    { concurrency: BACKFILL.CONCURRENCY },
  );
});

/** One page kept: how many schedules were kept, how many Vercel refused, and where the next page starts. */
const keepPage = Effect.fnUntraced(function* (after: string | null) {
  const page = yield* scheduledAutomations(after, BACKFILL.PAGE);
  const kept = yield* keepEach(page);
  const last = page.at(-1);
  return {
    kept: kept.filter(Boolean).length,
    refused: kept.filter((each) => !each).length,
    next: page.length < BACKFILL.PAGE || last === undefined ? null : last.id,
  };
});

/**
 * The minute sweep's backfill: the scheduled automations walked a page at a
 * time from the first, each call anew, until a page holds some with no
 * schedule standing, which are kept and the walk ends; answers how many it
 * kept. Note that it starts from the first page every call rather than
 * carrying a cursor, because a full pass is cheap (one query and one list
 * per workspace a page, eleven automations in one workspace on production)
 * and keeps nothing once every schedule stands, so it needs no row of its
 * own. A schedule Vercel refuses is logged and asked again the next minute,
 * and a page whose every missing schedule was refused is walked past, so one
 * refused schedule never holds back the pages after it.
 *
 * Temporary: it leaves with this module, the route, and
 * `scripts/backfill-automation-schedules.sh` once production holds every
 * scheduled automation's schedule.
 */
export const keepMissingSchedules = Effect.fnUntraced(function* () {
  const cadence = yield* AutomationCadence;
  let after: string | null = null;
  while (true) {
    const page: readonly ScheduledAutomation[] = yield* scheduledAutomations(after, BACKFILL.PAGE);
    const missing = yield* cadence.unscheduled(page);
    const kept = (yield* keepEach(missing)).filter(Boolean).length;
    if (kept > 0) return kept;
    const last = page.at(-1);
    if (page.length < BACKFILL.PAGE || last === undefined) return 0;
    after = last.id;
  }
});

/** POST: one page of the backfill, under the deployment's secret. */
const handleAutomationSchedulesBackfill = /* @__PURE__ */ Effect.fn(
  "web/handleAutomationSchedulesBackfill",
)(function* (
  options: AutomationSchedulesBackfillOptions,
): Effect.fn.Return<Response, unknown, DatabaseServices> {
  const { request } = options;
  if (request.method !== "POST") {
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
  // The first page names no id to start after.
  const after = new URL(request.url).searchParams.get(BACKFILL.AFTER) || null;
  return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* keepPage(after));
});

/** The backfill's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function automationSchedulesBackfillApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_AUTOMATION_SCHEDULES_PATH,
      effectPassthrough((request: Request) =>
        Effect.flatMap(HostedEnvironment, (environment) =>
          handleAutomationSchedulesBackfill({ request, cronSecret: environment.cronSecret }),
        ),
      ),
    ),
    hostedNotFoundRoute,
  );
}
