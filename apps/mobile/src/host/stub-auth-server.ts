/**
 * stub-auth-server.ts -- the account service the Maestro flows sign in against, chosen by the `-authServer stub` launch argument: OAuth's token, identity, and revocation answered in the app, an authorization page that grants at once, and the account's two workspaces.
 *
 * A Release build on CI's simulator can neither reach the service with an
 * account nor complete the system's authentication session, whose HTTPS
 * callback only a signed app with a verified association catches. So a
 * stubbed run swaps both ends of the trip and nothing between them: the
 * sheet answers the authorization page with its own callback carrying a
 * code and the page's own state, as a provider that granted would, and
 * every request the host makes is answered by `stubAuthFetch`, stood up as
 * the global `fetch` (`standStubAuthServer`). Note that it replaces the
 * global rather than being handed to the runtime as Effect's
 * `FetchHttpClient.Fetch`, because a fiber the host forks outside the
 * runtime's own context, as the session's launch renewal is, reads the
 * global, and a renewal that reached the real service would sign the stub's
 * account out. The host itself runs as a live run
 * signed in through the `ios` client: the code exchanged, the identity
 * read, the tokens sealed in the settings file by the Keychain's cipher,
 * read back at the next launch, and revoked at sign-out. Anything else the
 * host reads answers not found, which the host reads as a read that failed
 * rather than a service it cannot reach.
 */

import { AUTH_SESSION_END, type AuthSession } from "@repo/credentials";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { LIVE_POLL, LIVE_POLL_URL } from "@repo/features/live-wire";
import type { WireRecord } from "@repo/wire";

/** The account the stub signs in, as its identity answers it. */
export const STUB_ACCOUNT = {
  sub: "stub-account",
  email: "ada@example.com",
  name: "Ada Lovelace",
  // Note that the picture is GitHub's own Octocat, the one address a flow
  // reaches past the app, so the bar's photo and Settings' are drawn from a
  // real sign-in picture; where it does not load, the letters stand instead.
  picture: "https://avatars.githubusercontent.com/u/583231?v=4",
} as const;

/** The account's workspaces, as the live read's rows name them: its own first, and one it was invited to. */
const STUB_WORKSPACES = [
  {
    id: "stub-workspace-own",
    name: "Ada's workspace",
    slug: "ada",
    own: true,
    personal: true,
    role: "owner",
    memberCount: 1,
    photoVersion: null,
    ownerImage: null,
  },
  {
    id: "stub-workspace-team",
    name: "Analytical Engines",
    slug: "engines",
    own: false,
    personal: false,
    role: "member",
    memberCount: 4,
    photoVersion: null,
    ownerImage: null,
  },
] as const;

/** The paths the stub answers under the service's origin. */
const STUB_PATH = {
  TOKEN: "/api/auth/oauth2/token",
  USER_INFO: "/api/auth/oauth2/userinfo",
  REVOKE: "/api/auth/oauth2/revoke",
} as const;

/** The code the stub's authorization page grants, which its token endpoint takes. */
const STUB_CODE = "stub-code";

function json(body: WireRecord): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** One part of a polled live read, its rows inline only on the first read, since they never move. */
function polledPart(name: string, rows: readonly unknown[], unchanged: boolean) {
  return {
    capability: name,
    queryFingerprint: name,
    expiresAt: 4_000_000_000_000,
    digest: "1",
    ...(unchanged ? undefined : { rows: JSON.stringify(rows) }),
  };
}

/** The workspaces read, polled: its rows the first time and unchanged after, as a read past its digest answers. */
function workspacesAnswer(unchanged: boolean): Response {
  return json({
    url: LIVE_POLL_URL,
    queries: {
      workspaces: polledPart("workspaces", STUB_WORKSPACES, unchanged),
      installations: polledPart("installations", [], unchanged),
      experiments: polledPart("experiments", [], unchanged),
    },
  });
}

/** The service as the stub answers it: OAuth's three endpoints, the workspaces read, and not found for the rest. */
export const stubAuthFetch: typeof globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);

  switch (url.pathname) {
    case STUB_PATH.TOKEN:
      return Promise.resolve(
        json({ access_token: "stub-access", refresh_token: "stub-refresh", token_type: "Bearer" }),
      );
    case STUB_PATH.USER_INFO:
      return Promise.resolve(json(STUB_ACCOUNT));
    case STUB_PATH.REVOKE:
      return Promise.resolve(json({}));
    case HOSTED_SERVICE_PATH.LIVE_WORKSPACES:
      return Promise.resolve(workspacesAnswer(url.searchParams.has(LIVE_POLL.AFTER)));
    default:
      return Promise.resolve(new Response(null, { status: 404 }));
  }
};

/** The authorization page, granted at once: the callback carrying the stub's code and the page's own state. */
export const stubAuthSession: AuthSession = {
  open: (page, callbackUrl) => {
    const callback = new URL(callbackUrl);
    callback.searchParams.set("code", STUB_CODE);
    callback.searchParams.set("state", new URL(page).searchParams.get("state") ?? "");

    return Promise.resolve({ end: AUTH_SESSION_END.REDIRECTED, url: callback.href });
  },
  dismiss: () => undefined,
};

/** Answers every request of this launch from the stub, in place of the network. */
export function standStubAuthServer(): void {
  globalThis.fetch = stubAuthFetch;
}
