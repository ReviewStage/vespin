import type { Cause } from "effect";
import { Effect, Option } from "effect";
import { auth } from "./auth.js";
import { keepSessionCookies } from "./session-cookies.js";
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
  }) => Promise<{ headers: Headers; response: { user: { id: string } } | null }>;
}

/**
 * The session read over `api`. A browser's read, by its cookie, keeps the
 * cookies Better Auth answered it with for the request's own answer
 * (`session-cookies.ts`), as Better Auth's own `/get-session` would have
 * set them; a read by the Mac's session bearer keeps none, since no browser
 * holds what they would set.
 */
export function browserSessionUserId(api: SessionReader) {
  return (input: { headers: Headers }): Effect.Effect<Option.Option<string>, Cause.UnknownError> =>
    Effect.gen(function* () {
      const answer = yield* Effect.tryPromise(() =>
        api.getSession({ headers: input.headers, returnHeaders: true }),
      );

      if (!input.headers.has(CREDENTIAL_HEADER.AUTHORIZATION)) {
        yield* keepSessionCookies(answer.headers);
      }

      return Option.fromNullishOr(answer.response?.user.id);
    });
}

/** The session read over the deployment's own auth service. */
export const resolveBrowserSessionUserId = browserSessionUserId(auth.api);
