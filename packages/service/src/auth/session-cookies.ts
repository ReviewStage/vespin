/**
 * session-cookies.ts -- the cookies Better Auth answers a browser's session read with, handed on to that request's own answer.
 *
 * A browser's session is read in process (`browser-session.ts`), and Better
 * Auth answers that read as it answers its own `/get-session`: with the
 * session, and with `Set-Cookie` for what it wrote, its cookie cache
 * (`auth-policy.ts`'s `SESSION_COOKIE_CACHE`) after a read of the account
 * store, the session cookie again once a day as it extends the session, or
 * their deletion once the session is gone. Note that these are handed on
 * rather than dropped, because the browser holds Better Auth's cache: a
 * cookie that never reaches it leaves every request reading the store, and a
 * session the store extended expiring in the browser all the same.
 *
 * The hosted handler (`orpc/handler.ts`) gives each request a place to keep
 * them and writes what was kept onto its answer. A cookie's value is kept
 * there and written there alone, never logged or traced. This module imports
 * nothing of the auth service, so the handler reads it without loading
 * Better Auth.
 */

import { Context, Effect, Option } from "effect";

/** The header an answer carries a cookie in, and the caching an answer carrying one is held to. */
const COOKIE_ANSWER = {
  SET_COOKIE: "set-cookie",
  CACHE_CONTROL: "cache-control",
  PRIVATE: "private, no-store",
} as const;

/** One request's place for the cookies its session read was answered with, in the order they were. */
export class SessionCookies extends Context.Service<SessionCookies, { readonly kept: string[] }>()(
  "SessionCookies",
) {}

/** Keeps the `Set-Cookie` values among `headers` for the request's answer, where the request has a place for them. */
export function keepSessionCookies(headers: Headers): Effect.Effect<void> {
  return Effect.flatMap(Effect.serviceOption(SessionCookies), (place) =>
    Effect.sync(() => {
      if (Option.isSome(place)) place.value.kept.push(...headers.getSetCookie());
    }),
  );
}

/**
 * The answer with the cookies kept for it, each its own `Set-Cookie`, and,
 * where it carries any, held to `private, no-store` whatever caching its
 * procedure asked for, so no shared cache keeps a browser's cookie and hands
 * it to another.
 */
export function answeredWithSessionCookies(response: Response, kept: readonly string[]): Response {
  if (kept.length === 0) return response;

  for (const cookie of kept) response.headers.append(COOKIE_ANSWER.SET_COOKIE, cookie);
  response.headers.set(COOKIE_ANSWER.CACHE_CONTROL, COOKIE_ANSWER.PRIVATE);

  return response;
}
