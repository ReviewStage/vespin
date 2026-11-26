/**
 * session-cookies.ts -- the cookies Better Auth answers a browser's session read with, handed on to that request's own answer while it is still the browser's latest word.
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
 * Note too that a cookie is handed on only by an answer that leaves soon
 * after the request came, because a browser may sign out, or into another
 * account, from another tab while an answer is held (a live read holds up to
 * 25 s), and a late answer's cookies would overwrite the ones that sign-in
 * set. A read held by design is given no place for cookies at all
 * (`withoutSessionCookies`), so it reads the session without extending it,
 * and the extension waits for an answer that can carry it.
 *
 * The hosted handler (`orpc/handler.ts`) gives each request a place to keep
 * them and writes what was kept onto its answer. A cookie's value is kept
 * there and written there alone, never logged or traced. This module imports
 * nothing of the auth service, so the handler reads it without loading
 * Better Auth.
 */

import { Context } from "effect";

/** The header an answer carries a cookie in, and the caching an answer carrying one is held to. */
const COOKIE_ANSWER = {
  SET_COOKIE: "set-cookie",
  CACHE_CONTROL: "cache-control",
  PRIVATE: "private, no-store",
} as const;

/**
 * How long after its request came an answer may still carry the cookies its
 * session read was answered with: an immediate answer's span, and far short
 * of the time a sign-in in another tab takes.
 */
export const SESSION_COOKIE_FRESH_MS = 5_000;

/** One request's place for the cookies its session read was answered with, in the order they were. */
export class SessionCookies extends Context.Service<SessionCookies, { readonly kept: string[] }>()(
  "SessionCookies",
) {}

/** The request's services with no place for cookies, for a read whose answer is held until its rows move. */
export function withoutSessionCookies<Services>(
  services: Context.Context<Services>,
): Context.Context<Exclude<Services, SessionCookies>> {
  return Context.omit(SessionCookies)(services);
}

/**
 * The answer with the cookies kept for it, each its own `Set-Cookie`, where
 * it leaves within `SESSION_COOKIE_FRESH_MS` of its request, and then held
 * to `private, no-store` whatever caching its procedure asked for, so no
 * shared cache keeps a browser's cookie and hands it to another. A later
 * answer carries none.
 */
export function answeredWithSessionCookies(
  response: Response,
  kept: readonly string[],
  elapsedMs: number,
): Response {
  if (kept.length === 0 || elapsedMs > SESSION_COOKIE_FRESH_MS) return response;

  for (const cookie of kept) response.headers.append(COOKIE_ANSWER.SET_COOKIE, cookie);
  response.headers.set(COOKIE_ANSWER.CACHE_CONTROL, COOKIE_ANSWER.PRIVATE);

  return response;
}
