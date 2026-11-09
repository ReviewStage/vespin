import assert from "node:assert/strict";
import { oauthProvider } from "@better-auth/oauth-provider";
import { it } from "@effect/vitest";
import { IOS_OAUTH_CALLBACK_URL } from "@repo/features/ios-sign-in-wire";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt } from "better-auth/plugins";
import { Effect, Option, Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { unparsedWire, type WireBoundaryInput, type WireValue } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "./auth-policy.js";
import { oauthUserInfoFromAuthAnswer, requestUserId, type UserInfoEndpoint } from "./bearer.js";
import { IOS_OAUTH_CLIENT, oauthClientRecord } from "./oauth-clients.js";

/**
 * The iPhone's OAuth sign-in, end to end on one Better Auth configured as
 * `auth.ts` configures what the phone reaches, over an in-memory database,
 * with GitHub a fake behind `fetch`: the phone authorizes as the `ios`
 * client with a PKCE challenge, the browser signs in through GitHub, and
 * the provider returns the code to the one universal link the client
 * registers, which the phone exchanges with its verifier. The tokens name
 * the account at userinfo, and on the account routes' own read of a bearer
 * (`bearer.ts`'s `requestUserId`, which every write the phone makes
 * resolves its caller through), a refresh mints another, and a revocation
 * ends one; and no return address but the registered one is redirected to.
 * Synthetic accounts throughout.
 */

const SERVICE_URL = "https://vespin.dev";

const GITHUB_CODE = "github-code-under-test";
const GITHUB_TOKEN = "ghu_signed-in-token-under-test";
const GITHUB_EMAIL = "octo@github.test";

const NOW = new Date("2026-11-08T12:00:00.000Z");

/** RFC 7636's example pair, standing in for a verifier the phone drew. */
const PKCE = {
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
} as const;

/** The most redirects the provider sends the browser through on its own origin before the return. */
const MOST_HOPS = 3;

/** The provider's own error page, where an authorization that names no registered return is sent instead of the return it asked for. */
const ERROR_PAGE = `${SERVICE_URL}/api/auth/error`;

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const decodeTokens = Schema.decodeUnknownSync(
  Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
);
const decodeUserInfo = Schema.decodeUnknownSync(
  Schema.Struct({ sub: Schema.String, email: Schema.String }),
);
const decodeSession = Schema.decodeUnknownSync(
  Schema.NullOr(Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })),
);

function iosAuth() {
  return betterAuth({
    appName: "Vespin",
    baseURL: SERVICE_URL,
    secret: "ios-sign-in-test-secret-of-enough-length",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      oauthClient: [oauthClientRecord(IOS_OAUTH_CLIENT, NOW)],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
      oauthClientResource: [],
      oauthResource: [],
    }),
    account: ACCOUNT_TOKEN_STORAGE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    socialProviders: {
      github: { clientId: "vespin-github", clientSecret: "github-secret", scope: ["read:user"] },
    },
    // The plugins `auth.ts` installs that this flow reaches, in its order.
    plugins: [
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: "/sign-in.html",
        consentPage: "/consent.html",
        allowDynamicClientRegistration: false,
        clientPrivileges: denyOAuthClientPrivileges,
        cachedTrustedClients: new Set([IOS_OAUTH_CLIENT.id]),
      }),
    ],
  });
}

type Auth = ReturnType<typeof iosAuth>;

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads. */
function fakeGitHub(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://github.com/login/oauth/access_token") {
    return Promise.resolve(json({ access_token: GITHUB_TOKEN, token_type: "bearer" }));
  }
  if (url.href === "https://api.github.com/user") {
    return Promise.resolve(json({ id: 4242, login: "octocat", email: null }));
  }
  if (url.href === "https://api.github.com/user/emails") {
    return Promise.resolve(json([{ email: GITHUB_EMAIL, primary: true, verified: true }]));
  }
  throw new Error(`this test reaches no network: ${url.href}`);
}

/** The `name=value` pairs a browser would send back from a response's cookies. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function location(response: Response): URL {
  const next = response.headers.get("location");
  assert.ok(next, `expected a redirect, got ${response.status}`);
  return new URL(next, SERVICE_URL);
}

function navigate(auth: Auth, url: URL | string, cookie?: string): Promise<Response> {
  const navigation = { accept: "text/html", "sec-fetch-mode": "navigate" };
  return auth.handler(
    new Request(url, { headers: cookie === undefined ? navigation : { ...navigation, cookie } }),
  );
}

function post(
  auth: Auth,
  path: string,
  body: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${SERVICE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** A form posted to the provider's token or revocation endpoint, as the phone posts one: no cookie, no origin. */
function form(auth: Auth, path: string, body: Readonly<Record<string, string>>): Promise<Response> {
  return auth.handler(
    new Request(`${SERVICE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    }),
  );
}

/** The phone's authorization as `ASWebAuthenticationSession` opens it, returning to `redirectUri`. */
function authorize(auth: Auth, redirectUri: string): Promise<Response> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: IOS_OAUTH_CLIENT.id,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    state: "oauth-state",
    code_challenge: PKCE.challenge,
    code_challenge_method: "S256",
  });
  return navigate(auth, `${SERVICE_URL}/api/auth/oauth2/authorize?${query}`);
}

/**
 * The phone's sign-in: authorize, the sign-in page's social start, GitHub's
 * return, and the redirects back to the universal link. Answers the
 * browser's session cookie and the return's address.
 */
async function signIn(auth: Auth): Promise<{ browser: string; returned: URL }> {
  const loginPage = location(await authorize(auth, IOS_OAUTH_CALLBACK_URL));
  const started = await post(
    auth,
    "/sign-in/social",
    { provider: "github", oauth_query: loginPage.search.slice(1) },
    { origin: SERVICE_URL },
  );
  const github = new URL(decodeStarted(await started.json()).url);
  const callback = new URL(github.searchParams.get("redirect_uri") ?? "");
  callback.searchParams.set("code", GITHUB_CODE);
  callback.searchParams.set("state", github.searchParams.get("state") ?? "");
  const landed = await navigate(auth, callback, cookiesFrom(started));
  const browser = cookiesFrom(landed);
  let next = location(landed);
  // Note that the return is on the service's own origin, so the hops end at its path rather than off the origin.
  for (let hop = 0; !next.href.startsWith(IOS_OAUTH_CALLBACK_URL) && hop < MOST_HOPS; hop += 1) {
    next = location(await navigate(auth, next, browser));
  }
  return { browser, returned: next };
}

/** The phone's exchange of the code it was returned, with its verifier. */
async function exchange(auth: Auth, returned: URL) {
  const tokens = await form(auth, "/oauth2/token", {
    grant_type: "authorization_code",
    code: returned.searchParams.get("code") ?? "",
    redirect_uri: IOS_OAUTH_CALLBACK_URL,
    client_id: IOS_OAUTH_CLIENT.id,
    code_verifier: PKCE.verifier,
  });
  assert.equal(tokens.status, HOSTED_HTTP_STATUS.OK);
  return decodeTokens(await tokens.json());
}

function refresh(auth: Auth, refreshToken: string): Promise<Response> {
  return form(auth, "/oauth2/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: IOS_OAUTH_CLIENT.id,
  });
}

function revoke(
  auth: Auth,
  token: string,
  hint: "access_token" | "refresh_token",
): Promise<Response> {
  return form(auth, "/oauth2/revoke", {
    token,
    token_type_hint: hint,
    client_id: IOS_OAUTH_CLIENT.id,
  });
}

function userInfo(auth: Auth, accessToken: string): Promise<Response> {
  return auth.handler(
    new Request(`${SERVICE_URL}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
}

async function signedInUserId(auth: Auth, browser: string): Promise<string> {
  const answered = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/get-session`, { headers: { cookie: browser } }),
  );
  const session = decodeSession(await answered.json());
  assert.ok(session);
  return session.user.id;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("the phone's PKCE sign-in returns its code to the universal link, and the tokens it exchanges name the account at userinfo", async () => {
  const auth = iosAuth();
  const { browser, returned } = await signIn(auth);
  assert.equal(`${returned.origin}${returned.pathname}`, IOS_OAUTH_CALLBACK_URL);
  assert.equal(returned.searchParams.get("state"), "oauth-state");

  const tokens = await exchange(auth, returned);
  const answered = await userInfo(auth, tokens.access_token);
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const info = decodeUserInfo(await answered.json());
  assert.equal(info.sub, await signedInUserId(auth, browser));
  assert.equal(info.email, GITHUB_EMAIL);
});

it.effect(
  "the phone's token names its account on the account routes' own read, with no session asked for",
  () =>
    Effect.gen(function* () {
      const auth = iosAuth();
      const { browser, returned } = yield* Effect.promise(() => signIn(auth));
      const tokens = yield* Effect.promise(() => exchange(auth, returned));
      // The auth service's own endpoint, called in process as `bearer.ts` calls it.
      const userInfo: UserInfoEndpoint = (input) =>
        Effect.tryPromise(async () => {
          // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guard reads the selected field.
          const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
          return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
        });
      const write = new Request(`${SERVICE_URL}/api/inbox`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      const named = yield* requestUserId(write, userInfo, () =>
        Effect.die("no session is asked for under a bearer"),
      );
      assert.deepEqual(
        named,
        Option.some(yield* Effect.promise(() => signedInUserId(auth, browser))),
      );
    }),
);

test("a refresh mints an access token that names the same account, and a revoked token names nobody", async () => {
  const auth = iosAuth();
  const { browser, returned } = await signIn(auth);
  const first = await exchange(auth, returned);

  const refreshed = await refresh(auth, first.refresh_token);
  assert.equal(refreshed.status, HOSTED_HTTP_STATUS.OK);
  const second = decodeTokens(await refreshed.json());
  assert.notEqual(second.access_token, first.access_token);
  const named = decodeUserInfo(await (await userInfo(auth, second.access_token)).json());
  assert.equal(named.sub, await signedInUserId(auth, browser));

  assert.equal(
    (await revoke(auth, second.access_token, "access_token")).status,
    HOSTED_HTTP_STATUS.OK,
  );
  assert.equal((await userInfo(auth, second.access_token)).status, HOSTED_HTTP_STATUS.UNAUTHORIZED);

  assert.equal(
    (await revoke(auth, second.refresh_token, "refresh_token")).status,
    HOSTED_HTTP_STATUS.OK,
  );
  assert.notEqual((await refresh(auth, second.refresh_token)).status, HOSTED_HTTP_STATUS.OK);
});

test("a return address the client did not register, another host on the same path or the loopback the Mac returns to, is refused on the provider's own error page rather than redirected to", async () => {
  const auth = iosAuth();
  for (const asked of [
    "https://evil.example/ios/oauth/callback",
    "http://127.0.0.1:54698/callback",
  ]) {
    const refused = location(await authorize(auth, asked));
    assert.equal(`${refused.origin}${refused.pathname}`, ERROR_PAGE, asked);
    assert.equal(refused.searchParams.get("error"), "invalid_redirect", asked);
  }
});
