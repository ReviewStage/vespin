/**
 * analytics-erasure.ts -- what of an account PostHog is asked to erase when the account is deleted.
 *
 * Two distinct ids hold an account's analytics: its own id, which its session
 * replay, and the counts and survey answers recorded before they stopped
 * naming it, are filed under, and the keyed hash of that id the service's own counts are
 * filed under now (`analytics-distinct-id.ts`). One request asks PostHog to
 * erase the people behind both, with their events and recordings; a
 * deployment without the hash's key never filed a count under one, so it asks
 * after the account's own id alone. The apps' counted events and the survey
 * answers recorded now go under random ids that name no account, so nothing
 * here reaches them (`PRIVACY.md`).
 */

import { Effect, Redacted } from "effect";
import type { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { analyticsDistinctIdOf } from "../events/analytics-distinct-id.js";
import { forgetPosthogPersonEffect } from "../providers/posthog.js";

/** Erases the account's analytics people, where the deployment holds both halves of the analytics deletion configuration; never fails, and says on stderr why one did not complete. */
export const forgetAnalytics = /* @__PURE__ */ Effect.fn("web/forgetAnalytics")(function* (
  userId: string,
): Effect.fn.Return<void, never, HostedEnvironment | HttpClient.HttpClient> {
  const environment = yield* HostedEnvironment;

  if (!environment.posthogPersonalApiKey || !environment.posthogProjectId) return;
  const personalApiKey = Redacted.value(environment.posthogPersonalApiKey);
  const projectId = environment.posthogProjectId;
  const host = environment.posthogApiHost;
  const idKey = environment.posthogDistinctIdKey;

  const distinctIds =
    idKey === undefined ? [userId] : [userId, analyticsDistinctIdOf(idKey, userId)];

  yield* forgetPosthogPersonEffect(distinctIds, {
    personalApiKey,
    projectId,
    ...(host ? { host } : undefined),
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        process.stderr.write(`Analytics erasure did not complete: ${error.message}\n`),
      ),
    ),
  );
});
