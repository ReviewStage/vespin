/**
 * github-identity.ts -- who a request to GitHub is counted against, as GitHub limits it: the App's JWT, one installation, or one member's token.
 *
 * GitHub sets an installation's primary rate limit per installation, the
 * App's JWT apart from every installation, and a user's token per user
 * (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
 * so each is an identity of its own and one running dry holds no other.
 * GitHub does not say how its secondary limits are scoped, so a secondary
 * refusal under the App holds the App and every installation at once
 * (`RATE_SCOPE_KIND.EVERY_INSTALLATION`). A member's token is named here by
 * its digest alone, never the token.
 */

/** The kinds of identity GitHub counts a request against, and the one a log line may carry. */
export const IDENTITY_KIND = {
  APP: "app",
  INSTALLATION: "installation",
  MEMBER: "member",
} as const;

export type GitHubIdentityKind = (typeof IDENTITY_KIND)[keyof typeof IDENTITY_KIND];

/** One identity GitHub counts requests against. */
export type GitHubIdentity =
  | { readonly kind: typeof IDENTITY_KIND.APP }
  | { readonly kind: typeof IDENTITY_KIND.INSTALLATION; readonly installationId: number }
  | { readonly kind: typeof IDENTITY_KIND.MEMBER; readonly digest: string };

/** The scope a hold beyond one identity covers: the App's JWT and every installation, which a secondary refusal under the App holds. */
export const RATE_SCOPE_KIND = { EVERY_INSTALLATION: "every_installation" } as const;

/** What one rate-limit hold covers: one identity, or the App with every installation. */
export type GitHubRateScope =
  | GitHubIdentity
  | { readonly kind: typeof RATE_SCOPE_KIND.EVERY_INSTALLATION };
