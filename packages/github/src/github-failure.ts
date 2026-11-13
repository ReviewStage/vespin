/**
 * github-failure.ts -- the one tagged union every request to GitHub fails with.
 *
 * A caller reads what went wrong by its tag rather than by a status, so a
 * rate-limit 403 is never read as a permission 403: GitHub refuses for a
 * rate limit with a 429, or with a 403 that carries `retry-after`, names
 * `x-ratelimit-remaining: 0`, or says "rate limit" in its message
 * (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit),
 * and a GraphQL answer may say `RATE_LIMITED` with a 200.
 */

import { Schema } from "effect";
import { IDENTITY_KIND } from "./github-identity.js";

const IdentityKind = Schema.Literals([
  IDENTITY_KIND.APP,
  IDENTITY_KIND.INSTALLATION,
  IDENTITY_KIND.MEMBER,
]);

/** GitHub refused for a rate limit, or the module held the request back without sending it because GitHub said to wait. */
export class GitHubRateLimited extends Schema.TaggedError<GitHubRateLimited>()(
  "GitHubRateLimited",
  {
    identity: IdentityKind,
    /** The quota GitHub named (`core`, `graphql`, `search`, …), where it named one. */
    resource: Schema.optional(Schema.String),
    /** When GitHub said it may be asked again, where it said or a hold stands. */
    resetsAt: Schema.optional(Schema.Date),
  },
) {}

/** GitHub answered 404: the thing is not there, or the identity may not see it. */
export class GitHubNotFound extends Schema.TaggedError<GitHubNotFound>()("GitHubNotFound", {
  message: Schema.String,
}) {}

/** GitHub answered 403 for anything but a rate limit: a permission the identity lacks. */
export class GitHubForbidden extends Schema.TaggedError<GitHubForbidden>()("GitHubForbidden", {
  message: Schema.String,
  /**
   * GitHub's `x-github-sso` header, where it answered one: a token not yet
   * authorized for an organization's SAML SSO, and where to authorize it
   * (https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api#saml-sso).
   */
  sso: Schema.optional(Schema.String),
}) {}

/** GitHub answered 401: the token or JWT is not accepted. */
export class GitHubUnauthorized extends Schema.TaggedError<GitHubUnauthorized>()(
  "GitHubUnauthorized",
  { message: Schema.String },
) {}

/** GitHub refused the request itself with another 4xx (a 409 conflict, a 422 validation), or a GraphQL answer named errors. */
export class GitHubRejected extends Schema.TaggedError<GitHubRejected>()("GitHubRejected", {
  status: Schema.Number,
  message: Schema.String,
}) {}

/** GitHub could not be reached, or answered 5xx. */
export class GitHubUnavailable extends Schema.TaggedError<GitHubUnavailable>()(
  "GitHubUnavailable",
  { message: Schema.String },
) {}

/** GitHub answered, but not with what the caller's schema says. */
export class GitHubUnreadable extends Schema.TaggedError<GitHubUnreadable>()("GitHubUnreadable", {
  message: Schema.String,
}) {}

/** Every way a request to GitHub fails. */
export type GitHubFailure =
  | GitHubRateLimited
  | GitHubNotFound
  | GitHubForbidden
  | GitHubUnauthorized
  | GitHubRejected
  | GitHubUnavailable
  | GitHubUnreadable;
