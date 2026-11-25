/**
 * analytics-distinct-id.ts -- the id the service's own counts file an account under in PostHog: a keyed hash of its account id, never the id itself.
 *
 * The hash is HMAC-SHA256 of the account id under a key only the deployment
 * holds (`POSTHOG_DISTINCT_ID_KEY`), so the same account always files under
 * the same id, which keeps PostHog's funnels within the service's counts,
 * while nobody holding the PostHog project alone can turn an id back into
 * an account, or an account into its id: a plain hash of an id could be
 * matched by hashing every id the session replay names. The key is this
 * hash's alone, so it signs nothing else's bytes. Account deletion
 * recomputes it to erase the counts (`analytics-erasure.ts`), so a key once
 * in use is never rotated: the counts filed under the old one could no
 * longer be found to erase. Note that the key is a credential under
 * `AGENTS.md`'s Never: it travels as a `Redacted` and reaches no log, trace,
 * counted event, or fixture.
 */

import { createHmac } from "node:crypto";
import { Redacted } from "effect";

/** The id an account's own counts are filed under in PostHog, as lowercase hex. */
export function analyticsDistinctIdOf(key: Redacted.Redacted, userId: string): string {
  return createHmac("sha256", Redacted.value(key)).update(userId).digest("hex");
}
