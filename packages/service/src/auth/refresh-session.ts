/**
 * refresh-session.ts -- a refresh grant keeps the session its tokens were minted under alive, as a Better Auth plugin.
 *
 * An OAuth sign-in (the Mac's, the iPhone's, the CLI's, an MCP client's) is
 * minted under the browser session that consented, and every token of its
 * family carries that session. Better Auth's OAuth provider refuses a token
 * whose session has expired at userinfo and introspection, which every
 * hosted route's bearer read goes through (`bearer.ts`), yet its
 * `refresh_token` grant never reads the session at all. So once the
 * session's seven days ran out, each refresh still answered fresh tokens
 * and each was refused on its first call: the app read as signed in while
 * nothing it asked was answered, renewing on every call until the auth
 * rate limit refused the renewals too.
 *
 * The session is held open by the grant instead, as an identity provider
 * whose refresh tokens hang off the login session holds it (Keycloak
 * extends a session's idle timeout on each refresh): a refresh the provider
 * answered moves the session's expiry out to the new refresh token's,
 * thirty days on, and never closer. A sign-in in use stays signed in, one
 * left unused for thirty days lapses with its refresh token, and a session
 * already expired is brought back by the next refresh, since the grant is
 * the provider's own verdict that the family still stands. A session that
 * is gone (a sign-out deleted it) is not made again, and a support sign-in
 * is never extended, though the OAuth doors already refuse to mint from one
 * (`support-access.ts`).
 */

import { createHash } from "node:crypto";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { Schema } from "effect";

/** The provider's token endpoint, where a refresh grant is answered. */
const TOKEN_PATH = "/oauth2/token";

/** The grant this plugin follows. */
const REFRESH_GRANT = "refresh_token";

/** A token endpoint answer that carries a refresh token, read leniently: only the token is wanted. */
const isRefreshAnswer = Schema.is(Schema.Struct({ refresh_token: Schema.NonEmptyString }));

/** A refresh token row, read leniently: the session it hangs off and when it lapses. */
const isRefreshRow = Schema.is(
  Schema.Struct({ sessionId: Schema.NonEmptyString, expiresAt: Schema.Date }),
);

/** A session row, read leniently: its token, its expiry, and whether a maintainer started it. */
const isSessionRow = Schema.is(
  Schema.Struct({
    token: Schema.NonEmptyString,
    expiresAt: Schema.Date,
    impersonatedBy: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

/**
 * A refresh token as the provider stores it: its default `storeTokens:
 * "hashed"`, the SHA-256 of the token in unpadded base64url. Note that this
 * restates the provider's own hasher, which it does not export, so a change
 * of its storage would find no row here and extend nothing; the sign-in
 * tests refresh past a session's expiry and would fail on it.
 */
function storedRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * Moves the session behind a refresh grant the provider just answered out
 * to the new refresh token's expiry, where that is later than its own.
 */
const extendRefreshedSession = createAuthMiddleware(async (ctx) => {
  const answered = ctx.context.returned;

  if (ctx.body?.grant_type !== REFRESH_GRANT || !isRefreshAnswer(answered)) return;
  await extendSession(ctx.context, storedRefreshToken(answered.refresh_token));
});

async function extendSession(context: AuthContext, storedToken: string): Promise<void> {
  const refresh = await context.adapter.findOne({
    model: "oauthRefreshToken",
    where: [{ field: "token", value: storedToken }],
  });

  if (!isRefreshRow(refresh)) return;

  const session = await context.adapter.findOne({
    model: "session",
    where: [{ field: "id", value: refresh.sessionId }],
  });

  if (!isSessionRow(session) || session.impersonatedBy) return;

  if (session.expiresAt.getTime() >= refresh.expiresAt.getTime()) return;
  await context.internalAdapter.updateSession(session.token, { expiresAt: refresh.expiresAt });
}

/** Better Auth's plugin that holds a refreshed sign-in's session open, as an after hook of the token endpoint. */
export const refreshKeepsSession = () =>
  ({
    id: "refresh-keeps-session",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === TOKEN_PATH,
          handler: extendRefreshedSession,
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
