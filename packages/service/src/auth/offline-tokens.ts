/**
 * offline-tokens.ts -- an `offline_access` sign-in's refreshed tokens stand apart from the browser session that consented, as a Better Auth plugin.
 *
 * An OAuth sign-in (the Mac's, the iPhone's, the CLI's, an MCP client's) is
 * minted under the browser session that consented, and Better Auth's OAuth
 * provider copies that session onto every token a refresh mints after it.
 * Its userinfo and introspection, which every hosted route's bearer read
 * goes through (`bearer.ts`), refuse a token whose session has expired, yet
 * its `refresh_token` grant never reads the session at all. So once the
 * browser session's seven days ran out, each refresh still answered fresh
 * tokens and each was refused on its first call: the app read as signed in
 * while nothing it asked was answered, renewing on every call until the
 * auth rate limit refused the renewals too.
 *
 * A refresh token is issued only under `offline_access`, the scope OpenID
 * Connect defines as access that outlasts the end user's session, and Auth0,
 * Okta, and Keycloak's offline tokens each give such a token a lifetime of
 * its own. So the tokens a refresh grant just minted are unbound from the
 * session here: the refresh token and the opaque access token beside it
 * name no session, and the sign-in lives on the refresh token's own thirty
 * days, renewed with each refresh. Browser sessions keep their own lifetime
 * and are never touched. A family already bound to an expired session
 * recovers on its next refresh, since the grant is the provider's own
 * verdict that the family still stands. Note that a JWT access token, which
 * the provider mints only for a named resource, carries its session in its
 * own claims and is left as it was minted; the refresh token beside it is
 * unbound, so the next refresh answers one that names none.
 */

import { createHash } from "node:crypto";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { Schema } from "effect";

/** The provider's token endpoint, where a refresh grant is answered. */
const TOKEN_PATH = "/oauth2/token";

/** The grant this plugin follows. */
const REFRESH_GRANT = "refresh_token";

/** The scope a refresh token is issued under, OpenID Connect's access beyond the session. */
const OFFLINE_ACCESS = "offline_access";

/** A token endpoint answer that carries a refresh token, read leniently: the token and the scopes granted. */
const isRefreshAnswer = Schema.is(
  Schema.Struct({ refresh_token: Schema.NonEmptyString, scope: Schema.String }),
);

/** A refresh token row, read leniently: only its id is wanted. */
const isRefreshRow = Schema.is(Schema.Struct({ id: Schema.NonEmptyString }));

/**
 * A refresh token as the provider stores it: its default `storeTokens:
 * "hashed"`, the SHA-256 of the token in unpadded base64url. Note that this
 * restates the provider's own hasher, which it does not export, so a change
 * of its storage would find no row here and unbind nothing; the sign-in
 * tests refresh past a session's expiry and would fail on it.
 */
function storedRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Unbinds from its session the refresh token a grant just answered, and the access token minted beside it. */
async function unbindFromSession(context: AuthContext, storedToken: string): Promise<void> {
  const refresh = await context.adapter.findOne({
    model: "oauthRefreshToken",
    where: [{ field: "token", value: storedToken }],
  });

  if (!isRefreshRow(refresh)) return;

  await context.adapter.update({
    model: "oauthRefreshToken",
    where: [{ field: "id", value: refresh.id }],
    update: { sessionId: null },
  });

  await context.adapter.updateMany({
    model: "oauthAccessToken",
    where: [{ field: "refreshId", value: refresh.id }],
    update: { sessionId: null },
  });
}

/** Unbinds the tokens of an `offline_access` refresh grant the provider just answered. */
const unbindRefreshedTokens = createAuthMiddleware(async (ctx) => {
  const answered = ctx.context.returned;

  if (ctx.body?.grant_type !== REFRESH_GRANT || !isRefreshAnswer(answered)) return;

  if (!answered.scope.split(" ").includes(OFFLINE_ACCESS)) return;
  await unbindFromSession(ctx.context, storedRefreshToken(answered.refresh_token));
});

/** Better Auth's plugin that gives a refreshed `offline_access` sign-in a lifetime of its own, as an after hook of the token endpoint. */
export const offlineTokensOutliveSession = () =>
  ({
    id: "offline-tokens-outlive-session",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === TOKEN_PATH,
          handler: unbindRefreshedTokens,
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
