/**
 * github-refusal.ts -- a GitHub read carried onto the hosted answer channel, and written down by its kind alone.
 *
 * A read of a workspace's installation fails in two kinds: an App or a
 * GitHub the service could not reach, or a store that could not name the
 * installation. Both are an outage the caller may retry, refused as
 * unavailable, and logged by kind: nothing of a token, the request that
 * carried it, or GitHub's body reaches a line. Where the read is whether
 * the workspace reaches a task's repository, a GitHub that did not answer,
 * or refused the read, is refused as its own kind, so the desktop says
 * GitHub, not the service, failed.
 */

import type { GitHubFailure } from "@repo/github";
import { Effect, Match } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { GitHubReadFailure, GitHubWorkspaceReadFailure } from "./github-app.js";

/** Every tag a request to GitHub's API fails with, as `@repo/github` says it. */
export const GITHUB_API_FAILURE_TAGS = [
  "GitHubUnavailable",
  "GitHubRateLimited",
  "GitHubNotFound",
  "GitHubForbidden",
  "GitHubUnauthorized",
  "GitHubRejected",
  "GitHubUnreadable",
] as const satisfies ReadonlyArray<GitHubFailure["_tag"]>;

/** Every tag a read of GitHub fails with apart from the store: no App, its OAuth endpoints, and the API's. */
export const GITHUB_READ_FAILURE_TAGS = [
  "GitHubAppNotConfigured",
  ...GITHUB_API_FAILURE_TAGS,
] as const satisfies ReadonlyArray<GitHubReadFailure["_tag"]>;

/** The tags of a GitHub that did not answer the read, or refused it: every GitHub failure but an App not configured. */
const UNANSWERED_TAGS: ReadonlySet<string> = new Set(
  GITHUB_READ_FAILURE_TAGS.filter((tag) => tag !== "GitHubAppNotConfigured"),
);

/** The failure as one warning line of kinds alone. */
export function logGitHubReadFailure(failure: GitHubReadFailure): Effect.Effect<void> {
  return Effect.logWarning(`GitHub App read failed: ${failure.message}`);
}

/** A workspace read's failure as one warning line of kinds alone. */
export function logWorkspaceReadFailure(failure: GitHubWorkspaceReadFailure): Effect.Effect<void> {
  return Match.value(failure).pipe(
    Match.tag(...GITHUB_READ_FAILURE_TAGS, logGitHubReadFailure),
    Match.tag("GitHubMemberTokensUnavailable", (unavailable) =>
      Effect.logWarning(`Hosted store unavailable: ${unavailable.message}`),
    ),
    Match.orElse(logStoreFailure),
  );
}

/** A read of the workspace's installation the handler cannot answer without, refused on the terms above. */
export function githubReadOrRefusal<A, R>(
  effect: Effect.Effect<A, GitHubWorkspaceReadFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

/** A read of whether the workspace reaches a repository, refused on the terms above, a GitHub that did not answer as unanswered. */
export function githubReachOrRefusal<A, R>(
  effect: Effect.Effect<A, GitHubWorkspaceReadFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.mapError((failure) =>
      UNANSWERED_TAGS.has(failure._tag)
        ? HOSTED_REFUSAL.GITHUB_UNANSWERED
        : HOSTED_REFUSAL.UNAVAILABLE,
    ),
  );
}
