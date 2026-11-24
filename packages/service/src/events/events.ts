import { randomUUID } from "node:crypto";
import type { productEventsAnswerSchema } from "@repo/features/analytics";
import { Clock, Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  PRODUCT_EVENT_MAXIMUM_AGE_MS,
  PRODUCT_PLATFORM,
  type ProductClientPlatform,
  type ProductEventBatch,
  type ProductEventBuild,
  productEventBatchFromWire,
  productEventBuildFromWire,
  productEventInstallIdFromWire,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import { HOSTED_REFUSAL, type HostedRefusal, upstreamRefused } from "../http/http-effect.js";
import { createRateBrake } from "../http/rate-brake.js";
import {
  type PosthogBatch,
  type PosthogBatchItem,
  type PosthogUpstreamOptions,
  postBatchEffect,
} from "../providers/posthog.js";

/**
 * Records what a signed-in app counted about its own use. No app talks to
 * the analytics processor for its counts: each posts an allowlisted batch
 * here, which is accepted only from a signed-in caller, resolved from the
 * same bearer token the voice and review endpoints trust, and braked by that
 * account. The account goes no further than that. The batch is filed under
 * the random id the install it came from made for itself
 * (`productEventInstallIdFromWire`), as a personless event, and never under
 * the account, its name, its email, or its workspace.
 *
 * Note that this is what keeps the counts apart from the session replay,
 * which stays filed under the account's id, name, and email
 * (`packages/panel/src/session-replay.ts`), as do the service's own counts
 * (`server-events.ts`): the counts share no distinct id with either, and no
 * workspace group either, since a workspace's group is filed beside both and
 * a workspace of one is a person. `PRIVACY.md` says what is left, which is
 * when each was recorded.
 *
 * What the reader admits is the whole vocabulary: `productEventBatchFromWire`
 * builds each event from the event's own property allowlist rather than from
 * what arrived, so a `distinct_id`, an `$ip`, a `$set`, or a `$groups` on the
 * way in is not copied forward, and no property can hold free text.
 */

/** The group type a workspace is filed under in PostHog, one of the project's five: the service's own counts (`server-events.ts`) and the session replay file under it, and this endpoint's never do. */
export const WORKSPACE_GROUP_TYPE = "workspace";

/** The `$lib` tag a batch is stamped with, by the platform that sent it. */
const PRODUCT_EVENT_LIB = {
  [PRODUCT_PLATFORM.DESKTOP]: "vespin-desktop",
  [PRODUCT_PLATFORM.WEB]: "vespin-web",
  [PRODUCT_PLATFORM.IOS]: "vespin-ios",
} as const satisfies Record<ProductClientPlatform, string>;

/** The property every forwarded event names its platform under. */
const PLATFORM_PROPERTY = "platform";

/** The property every forwarded event names the deployment that recorded it under. */
const ENVIRONMENT_PROPERTY = "environment";

/** The environment stamped where Vercel names none, as a local `vercel dev` or a test; Sentry's own fallback. */
const UNNAMED_DEPLOYMENT = "development";

/** Vercel's own name for the deployment: `production`, `preview`, or `development`. */
export const DEPLOYMENT_VARIABLE = "VERCEL_ENV";

/** What the shared brake holds this endpoint to; a batch spends its own event count. */
const RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_EVENTS_PER_WINDOW: 120,
  /** The counter map is bounded; past this it forgets rather than grows. */
  MAX_TRACKED_USERS: 10_000,
} as const;

const eventsBrake = createRateBrake({
  windowMs: RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: RATE_LIMIT.MAX_EVENTS_PER_WINDOW,
  maxTrackedUsers: RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface EventsOptions {
  /** The analytics project token, from the deployment environment, trimmed and present. */
  projectApiKey: string;
  /** A deployment-configured ingestion host; the shared default otherwise. */
  host?: string;
  /**
   * The deployment's own `VERCEL_ENV` (`production`, `preview`, or
   * `development`), stamped on every event as `environment` so a preview's
   * or a local service's counts can be told from production's.
   */
  deployment?: string | undefined;
}

/**
 * Builds the documented batch document. Three of its fields keep the counts
 * anonymous, and each fails silently if got wrong: `distinct_id` sits at each
 * item's top level, where PostHog's capture docs ask for it, and is the
 * install's id, never the account's; `$process_person_profile` false is
 * PostHog's anonymous event, which makes and updates no person, so nothing
 * can be set on one; and `$geoip_disable` keeps the processor from resolving
 * an event with no address to the data center's own location.
 * `historical_migration` stays false because this is live traffic rather
 * than a backfill.
 *
 * Every event is also stamped with the deployment that recorded it and with
 * what the app said about the build the batch came from, so a preview's,
 * a local service's, or a development build's counts can be filtered from
 * production's. A batch that names no platform comes from a build older than
 * the label, which was the desktop alone, so it reads as desktop. They go
 * under the event's own properties, so an event that names its own
 * `app_version` keeps it.
 */
function batchDocument(
  events: ProductEventBatch,
  stamp: ProductEventBuild & {
    readonly [ENVIRONMENT_PROPERTY]: string;
    readonly [PLATFORM_PROPERTY]: ProductClientPlatform;
  },
  projectApiKey: string,
  installId: string,
  now: number,
): PosthogBatch {
  return {
    api_key: projectApiKey,
    historical_migration: false,
    batch: events.map((event) => ({
      event: event.name,
      distinct_id: installId,
      timestamp: new Date(
        // Clamped into the shared window ending at this reader's own clock
        // — the same principle the review answer follows by stamping
        // `decidedAt` here rather than trusting the sender.
        Math.min(now, Math.max(event.at, now - PRODUCT_EVENT_MAXIMUM_AGE_MS)),
      ).toISOString(),
      properties: {
        ...stamp,
        ...event.properties,
        $geoip_disable: true,
        $process_person_profile: false,
        $lib: PRODUCT_EVENT_LIB[stamp.platform],
      },
    })) satisfies PosthogBatchItem[],
  };
}

/** The environment an event is stamped with: the deployment's own name, or `development` where it names none. */
export function deploymentNamed(deployment: string | undefined): string {
  return trimmedText(deployment) ?? UNNAMED_DEPLOYMENT;
}

/**
 * One batch from the account the caller resolved to: read through the
 * allowlist, braked by that account, stamped, and forwarded under the
 * install's id. The caller, the kill
 * switch, and the body's size are the route's to settle before this runs
 * (`events-procedures.ts`).
 */
export function recordEvents(
  userId: string,
  payload: UnparsedWireValue,
  options: EventsOptions,
): Effect.Effect<typeof productEventsAnswerSchema.Type, HostedRefusal, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    // The reader owns the batch limit as well as the vocabulary, and refuses an
    // oversized batch whole rather than trimming it.
    const events = productEventBatchFromWire(payload);

    if (!events) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

    // Note that a batch of nothing but retired names is accepted with nothing
    // to post, because the older build that sent it is not at fault.
    if (events.length === 0) return { accepted: 0 };
    const build = productEventBuildFromWire(payload);

    const stamp = {
      ...build,
      [PLATFORM_PROPERTY]: build.platform ?? PRODUCT_PLATFORM.DESKTOP,
      [ENVIRONMENT_PROPERTY]: deploymentNamed(options.deployment),
    };

    const now = yield* Clock.currentTimeMillis;

    if (!(yield* eventsBrake.check(userId, events.length))) {
      return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
    }

    const upstream: PosthogUpstreamOptions = {};

    if (options.host !== undefined) upstream.host = options.host;

    // Note that a build from before the install id is filed under an id of
    // its own for each batch, because the account is no longer one to file it under.
    const installId = productEventInstallIdFromWire(payload) ?? randomUUID();

    const response = yield* postBatchEffect(
      batchDocument(events, stamp, options.projectApiKey, installId, now),
      upstream,
    );

    if (!response) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);

    // Status alone diagnoses the upstream without carrying its body onward.
    if (!response.ok) return yield* Effect.fail(upstreamRefused(response.status));

    // The desktop drops the batch whichever way this lands; the distinction is
    // for the tests and alerts that watch this endpoint.
    return { accepted: events.length };
  });
}
