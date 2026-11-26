import type { Cause } from "effect";
import { Effect, Option } from "effect";
import { auth } from "./auth.js";
import { SessionCookies } from "./session-cookies.js";
import { CREDENTIAL_HEADER } from "./session-credential.js";

/**
 * browser-session.ts -- the account a Better Auth session names: a browser's own cookie, for the few routes a web page calls and for any hosted route reached with no `Authorization` (`bearer.ts`'s `requestUserId`), or the Mac's signed session bearer, which the bearer plugin reads as that cookie.
 *
 * Better Auth's `getSession` is a promise of somebody else's, so it is
 * wrapped once here. Its failure propagates, so a route can answer an auth
 * outage as unavailable rather than as a signed-out browser sent to a
 * sign-in that cannot succeed. It reads the headers alone, so a caller may
 * hand it a request or only the headers it chose to carry on.
 */

/** The one endpoint of a Better Auth instance a session read reaches, as it answers with its headers. */
interface SessionReader {
  readonly getSession: (input: {
    headers: Headers;
    returnHeaders: true;
    query?: { disableRefresh?: boolean };
  }) => Promise<{ headers: Headers; response: { user: { id: string } } | null }>;
}

/**
 * The session read over `api`, on three terms:
 *
 * - a browser's read, by its cookie, where the request has a place for
 *   cookies (`session-cookies.ts`), keeps the cookies Better Auth answered it
 *   with for the request's own answer, as its own `/get-session` would have
 *   set them, the session's daily extension among them;
 * - a browser's read where the request has no such place, a relay's upgrade,
 *   a route outside the hosted handler, or a read held by design, asks Better
 *   Auth not to extend the session (`disableRefresh`), because the cookie that
 *   extension sets would reach no browser, and the extension waits for a read
 *   whose answer carries it;
 * - a read by the Mac's session bearer keeps no cookie, since no browser
 *   holds what one would set, and extends the session as it always has.
 */
export function browserSessionUserId(api: SessionReader) {
  return (input: { headers: Headers }): Effect.Effect<Option.Option<string>, Cause.UnknownError> =>
    Effect.gen(function* () {
      const place = yield* Effect.serviceOption(SessionCookies);
      const byCookie = !input.headers.has(CREDENTIAL_HEADER.AUTHORIZATION);
      const unkept = byCookie && Option.isNone(place);

      const answer = yield* Effect.tryPromise(() =>
        api.getSession({
          headers: input.headers,
          returnHeaders: true,
          ...(unkept && { query: { disableRefresh: true } }),
        }),
      );

      if (byCookie && Option.isSome(place)) place.value.kept.push(...answer.headers.getSetCookie());

      return Option.fromNullishOr(answer.response?.user.id);
    });
}

/** The session read over the deployment's own auth service. */
export const resolveBrowserSessionUserId = browserSessionUserId(auth.api);
