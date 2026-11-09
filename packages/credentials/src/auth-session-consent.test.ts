import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import {
  AUTH_SESSION_END,
  AUTH_SESSION_REASON,
  type AuthSessionAnswer,
  authSessionConsent,
} from "./auth-session-consent.js";
import { LOOPBACK_CONSENT_CANCELED, type LoopbackAuthorization } from "./consent.js";

const REFUSED = "Example did not grant access.";

const CALLBACK = "https://app.example.test/ios/oauth/callback";

/**
 * One trip whose authentication session answers what `caught` builds from
 * the authorization the trip composed, as the sheet would hand back the
 * redirect it caught, with the exchange recorded rather than performed.
 */
function trip(caught: (authorization: LoopbackAuthorization) => AuthSessionAnswer) {
  let authorization: LoopbackAuthorization | undefined;
  const exchanges: { code: string; redirectUri: string }[] = [];
  const consent = authSessionConsent({
    callbackUrl: CALLBACK,
    session: {
      open: (_url, callbackUrl) => {
        assert.equal(callbackUrl, CALLBACK);
        assert.ok(authorization !== undefined);
        return Promise.resolve(caught(authorization));
      },
      dismiss: () => undefined,
    },
  })<{ token: string }>({
    callbackPath: "/callback",
    pages: {
      granted: { badge: "Signed in", title: "Signed in", body: "Close this tab." },
      notGranted: { badge: "Not signed in", title: "Not signed in", body: "Try again." },
    },
    reasons: { refused: REFUSED, timedOut: "Timed out." },
    authorizationUrl: (input) => {
      authorization = input;
      return "https://example.test/authorize";
    },
    exchange: (input) =>
      Effect.sync(() => {
        exchanges.push(input);
        return { token: "granted" };
      }),
    openExternal: () => undefined,
  });
  return { outcome: Effect.scoped(consent.signInEffect()), exchanges };
}

const redirected = (url: string): AuthSessionAnswer => ({ end: AUTH_SESSION_END.REDIRECTED, url });

// Note that the regression these catch is a caught redirect taken without this trip's own state or
// on another address, so a code from another trip, or one a page planted, is exchanged as the person's own.
/** One caught answer a trip must end on without exchanging a code, and the reason it ends on. */
type Ended = readonly [
  label: string,
  caught: (authorization: LoopbackAuthorization) => AuthSessionAnswer,
  reason: string,
];

it.effect.each<Ended>([
  [
    "another trip's state",
    (at) => redirected(`${at.redirectUri}?code=c&state=other`),
    AUTH_SESSION_REASON.OTHER_TRIP,
  ],
  [
    "another host's address",
    (at) =>
      redirected(`https://elsewhere.example.test/ios/oauth/callback?code=c&state=${at.state}`),
    AUTH_SESSION_REASON.OTHER_ADDRESS,
  ],
  [
    "a refusal",
    (at) => redirected(`${at.redirectUri}?error=access_denied&state=${at.state}`),
    REFUSED,
  ],
  ["a closed sheet", () => ({ end: AUTH_SESSION_END.CLOSED }), LOOPBACK_CONSENT_CANCELED],
])("ends on %s without exchanging a code", ([, caught, reason]) =>
  Effect.gen(function* () {
    const { outcome, exchanges } = trip(caught);
    assert.deepEqual(yield* Effect.map(outcome, (end) => "reason" in end && end.reason), reason);
    assert.deepEqual(exchanges, []);
  }),
);

it.effect("exchanges the code the trip's own redirect carried, on the registered callback", () =>
  Effect.gen(function* () {
    const { outcome, exchanges } = trip((at) =>
      redirected(`${at.redirectUri}?code=the-code&state=${encodeURIComponent(at.state)}`),
    );
    assert.deepEqual(yield* outcome, { token: "granted" });
    assert.deepEqual(
      exchanges.map(({ code, redirectUri }) => ({ code, redirectUri })),
      [{ code: "the-code", redirectUri: CALLBACK }],
    );
  }),
);
