/**
 * auth-session-consent.ts -- a consent trip for a phone: the authorization page shown in the system's authentication session, and the redirect it catches on the app's universal link read back.
 *
 * The same code flow as the loopback (`loopback-consent.ts`) and the
 * paste-back (`paste-back-consent.ts`), asked with the same options, so the
 * account session manager words it unchanged: a verifier and a state minted
 * per trip, the page's URL built on the trip's redirect, and the exchange
 * run on the code the redirect carried. What differs is how the code comes
 * back. The phone's authentication session (`ASWebAuthenticationSession` on
 * iOS, opened by the app through `AuthSession`) shows the page in a sheet of
 * its own and closes the moment the provider redirects to the callback the
 * app registered, an HTTPS address on the home host that only the app Apple
 * verified against the host's association catches, handing the address back
 * here. That address is read as the paste-back reads a pasted one (its
 * origin and path the callback's, its state this trip's own), so a redirect
 * from another trip, or one that carried a refusal, is refused before any
 * code is exchanged.
 *
 * The sheet is modal and ends with the trip, so there is no page to continue
 * to after a grant and none to reopen: a flow's `continueTo` is not asked,
 * which is why a client signing in this way asks no session hand-off.
 */

import { SIGN_IN_FAILURE, type SignInFailure } from "@repo/features/words";
import { Effect, Result } from "effect";
import { Base64Url } from "effect/encoding";
import {
  LOOPBACK_CONSENT_CANCELED,
  type LoopbackConsent,
  type LoopbackConsentOptions,
  type LoopbackConsentOutcome,
  type OpenConsent,
} from "./consent.js";
import { codeChallenge, createCodeVerifier } from "./pkce.js";

/** The state's random bytes, as many as the loopback's. */
const STATE_BYTES = 32;

/** Why a trip ended without a code, in words a phone's sign-in screen shows. */
export const AUTH_SESSION_REASON = {
  ALREADY_WAITING: "A sign-in is already open.",
  CHALLENGE: "Could not prepare a secure sign-in on this phone.",
  SHOWN: "Could not open the sign-in page.",
  OTHER_ADDRESS: "The sign-in page returned to an address that is not this app's.",
  OTHER_TRIP: "That sign-in was from an earlier attempt. Try again.",
} as const;

/** How the authentication session ended: on the callback, with the address it caught, or closed without one. */
export const AUTH_SESSION_END = {
  REDIRECTED: "redirected",
  CLOSED: "closed",
} as const;

export type AuthSessionAnswer =
  | { readonly end: typeof AUTH_SESSION_END.REDIRECTED; readonly url: string }
  | { readonly end: typeof AUTH_SESSION_END.CLOSED };

/** The phone's authentication session, as the app answers it. */
export interface AuthSession {
  /** Shows `url` until a redirect reaches `callbackUrl`, which it answers, or the person closes it. */
  open(url: string, callbackUrl: string): Promise<AuthSessionAnswer>;
  /** Closes a session still showing, which then answers closed. */
  dismiss(): void;
}

/** What the caught address read as: the code to exchange, or why there is none. */
type CaughtRead =
  | { readonly code: string }
  | { readonly reason: string; readonly failure?: SignInFailure };

function stateOf(prefix: string | undefined): string {
  const random = Base64Url.encode(crypto.getRandomValues(new Uint8Array(STATE_BYTES)));
  return prefix ? `${prefix}.${random}` : random;
}

/**
 * The caught address read as this trip's redirect: the callback's own origin
 * and path, carrying the trip's own state, and a code rather than a refusal.
 */
function readCaught(
  caught: string,
  trip: { readonly state: string; readonly callback: URL },
  refused: string,
): CaughtRead {
  const url = URL.canParse(caught) ? new URL(caught) : undefined;
  if (
    url === undefined ||
    url.origin !== trip.callback.origin ||
    url.pathname !== trip.callback.pathname
  ) {
    return { reason: AUTH_SESSION_REASON.OTHER_ADDRESS };
  }
  if (url.searchParams.get("state") !== trip.state) {
    return { reason: AUTH_SESSION_REASON.OTHER_TRIP };
  }
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code) {
    return { reason: refused, failure: SIGN_IN_FAILURE.REFUSED };
  }
  return { code };
}

/**
 * Stands up trips through `session`, each redirected to `callbackUrl`, the
 * one redirect the phone's client registers, whatever callback path the
 * flow names. One trip shows at a time: a second asked while one shows
 * answers why, and a cancel closes the one showing.
 */
export function authSessionConsent(options: {
  readonly callbackUrl: string;
  readonly session: AuthSession;
}): OpenConsent {
  const callback = new URL(options.callbackUrl);
  /** The trip whose session shows now, by its own token, so one trip's cancel never closes another's. */
  let showing: symbol | undefined;
  return <Grant extends object>(trip: LoopbackConsentOptions<Grant>): LoopbackConsent<Grant> => {
    const own = Symbol("auth session trip");
    const run = Effect.fnUntraced(function* (): Effect.fn.Return<LoopbackConsentOutcome<Grant>> {
      if (showing !== undefined) return { reason: AUTH_SESSION_REASON.ALREADY_WAITING };
      const codeVerifier = createCodeVerifier();
      const state = stateOf(trip.statePrefix);
      const redirectUri = callback.href;
      const challenge = yield* Effect.result(codeChallenge(codeVerifier));
      if (Result.isFailure(challenge)) return { reason: AUTH_SESSION_REASON.CHALLENGE };
      const page = trip.authorizationUrl({ state, redirectUri, codeChallenge: challenge.success });
      showing = own;
      const answer = yield* Effect.result(
        Effect.tryPromise(() => options.session.open(page, redirectUri)),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            showing = undefined;
          }),
        ),
      );
      if (Result.isFailure(answer)) {
        return { reason: AUTH_SESSION_REASON.SHOWN, failure: SIGN_IN_FAILURE.BROWSER };
      }
      if (answer.success.end === AUTH_SESSION_END.CLOSED) {
        return { reason: LOOPBACK_CONSENT_CANCELED };
      }
      const read = readCaught(answer.success.url, { state, callback }, trip.reasons.refused);
      if ("reason" in read) return read;
      return yield* trip.exchange({ code: read.code, state, redirectUri, codeVerifier });
    });

    return {
      signInEffect: () => run(),
      cancel(): void {
        if (showing === own) options.session.dismiss();
      },
      // Note that the sheet stays in front until it ends, so there is nothing behind it to bring back.
      reopen(): void {},
    };
  };
}
