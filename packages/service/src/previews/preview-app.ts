/**
 * preview-app.ts -- a shared port's members-only preview: the app's sign-in step that hands a member to the preview host, and the preview host's own route, which trades the handoff for its cookie and passes each request a cookie admits on to the sandbox's route for the shared port.
 *
 * The sign-in step answers on the app's host. A browser with no session is
 * sent to the app's sign-in page, which returns it here; a member who
 * reaches the agent by the Terminal's rule (`sandbox-reach.ts`) is sent on to
 * the preview host with a handoff token (`preview-links.ts`).
 *
 * The preview host is routed to its own function (the root `vercel.json`),
 * which answers on a preview host alone. A request without a cookie for that
 * host is a page load sent to sign in, or anything else refused as
 * unauthorized. A request with one is checked against the member's reach
 * again, so a member who left the workspace is refused at once, and passed
 * on to the route the agent's sandbox serves the shared port at, whose
 * address no member is ever handed. The preview's cookie never goes on to
 * the sandbox.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { PREVIEW_SIGN_IN } from "@repo/features/preview-sign-in";
import type { Sandbox } from "@repo/sandbox";
import { HTTP_METHOD } from "@repo/wire";
import { Clock, Duration, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { AgentSandbox } from "../agents/terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "../agents/terminal/sandbox-reach.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  resolvedAccount,
  type UserIdResolver,
  uuidOf,
} from "../http/http-effect.js";
import { PageLinks, type PageSandbox } from "../pages/page-links.js";
import { ANY_METHOD, ANY_PATH, type WebRoutes } from "../route.js";
import {
  agentOfPreviewHost,
  mintPreviewHandoff,
  mintPreviewSession,
  PREVIEW_LINK,
  PREVIEW_TOKEN_LIFETIME,
  previewOrigin,
  previewReturnPath,
  readPreviewHandoff,
  readPreviewSession,
} from "./preview-links.js";

/** The app's own sign-in page, which returns a browser to the path it is handed. */
const SIGN_IN_PAGE = { PATH: "/sign-in", RETURN: PREVIEW_SIGN_IN.RETURN_PARAM } as const;

/** The request headers never passed on to the sandbox: the hop's own, and the ones the fetch sets itself. */
const DROPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cookie",
]);

/** The response headers never passed back: the hop's own, and the body's encoding, which the fetch already undid. */
const DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

/** What a preview answers that the CDN must never keep for another member. */
const NEVER_KEPT = { "Vercel-CDN-Cache-Control": "no-store" } as const;

const NOT_SIGNED_IN = "Sign in to view this preview.";
const NOT_SHARED = "This preview isn't running. Ask whoever shared it to share it again.";

/** The page sandbox, or not found on a deployment that has none. */
const pageSandbox = Effect.gen(function* () {
  const { sandbox } = yield* PageLinks;
  if (sandbox === undefined) return yield* Effect.fail<HostedRefusal>(HOSTED_REFUSAL.NOT_FOUND);
  return sandbox;
});

/** The request as the Web sees it. */
const webRequest = Effect.gen(function* () {
  return yield* Effect.orDie(HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest));
});

export interface PreviewSignInSeams {
  readonly resolveUserId: UserIdResolver;
}

/** GET: a signed-in member who reaches the agent, sent to its preview host with a handoff token. */
const signInEndpoint = (seams: PreviewSignInSeams) =>
  Effect.gen(function* () {
    const request = yield* webRequest;
    const sandbox = yield* pageSandbox;
    const address = new URL(request.url);
    const agentId = yield* uuidOf(request, PREVIEW_LINK.QUERY.AGENT);
    const returnPath = previewReturnPath(address.searchParams.get(PREVIEW_LINK.QUERY.RETURN));
    const account = yield* resolvedAccount(seams.resolveUserId, request);
    if (Option.isNone(account)) {
      const here = `${address.pathname}${address.search}`;
      const signIn = `${SIGN_IN_PAGE.PATH}?${new URLSearchParams({ [SIGN_IN_PAGE.RETURN]: here })}`;
      return HttpServerResponse.redirect(signIn, { status: HOSTED_HTTP_STATUS.FOUND });
    }
    yield* reachedAgentSession(account.value, agentId);
    const token = mintPreviewHandoff(
      sandbox,
      { userId: account.value, agentId },
      yield* Clock.currentTimeMillis,
    );
    const target = new URL(PREVIEW_LINK.SESSION_PATH, previewOrigin(sandbox, agentId));
    target.searchParams.set(PREVIEW_LINK.QUERY.TOKEN, token);
    target.searchParams.set(PREVIEW_LINK.QUERY.RETURN, returnPath);
    return HttpServerResponse.redirect(target, { status: HOSTED_HTTP_STATUS.FOUND });
  });

/** The app's sign-in step for a preview. */
export function previewSignInApp(
  seams: PreviewSignInSeams,
): WebRoutes<DatabaseServices | PageLinks> {
  return Layer.mergeAll(
    HttpRouter.add(
      HTTP_METHOD.GET,
      PREVIEW_LINK.SIGN_IN_PATH,
      hostedRefusing(signInEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}

/** The path and query the browser asked the preview host for, from the address the dispatcher restored under the proxy's path. */
function askedPath(address: URL): string {
  const rest = address.pathname.slice(PREVIEW_LINK.PROXY_PATH.length);
  return `${rest.startsWith("/") ? rest : `/${rest}`}${address.search}`;
}

/** The preview host's cookie, where the request carries one. */
function previewCookie(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === PREVIEW_LINK.COOKIE) return value.join("=");
  }
  return undefined;
}

/** The request's cookies, the preview's own left out, so the sandbox never sees it. */
function cookiesWithoutPreview(request: Request): string | undefined {
  const kept = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith(`${PREVIEW_LINK.COOKIE}=`));
  return kept.length === 0 ? undefined : kept.join("; ");
}

/** The handoff traded for the preview host's cookie, and the browser sent back to the path it asked for. */
function sessionStep(sandbox: PageSandbox, agentId: string, address: URL, now: number) {
  const member = readPreviewHandoff(
    sandbox,
    address.searchParams.get(PREVIEW_LINK.QUERY.TOKEN) ?? "",
    now,
  );
  if (member === undefined || member.agentId !== agentId) {
    return HttpServerResponse.text(NOT_SIGNED_IN, { status: HOSTED_HTTP_STATUS.UNAUTHORIZED });
  }
  const maxAge = Duration.toSeconds(PREVIEW_TOKEN_LIFETIME.SESSION);
  const cookie = `${PREVIEW_LINK.COOKIE}=${mintPreviewSession(sandbox, member, now)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  const back = previewReturnPath(address.searchParams.get(PREVIEW_LINK.QUERY.RETURN));
  return HttpServerResponse.redirect(back, {
    status: HOSTED_HTTP_STATUS.FOUND,
    headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" },
  });
}

/** A request without a member's cookie: a page load sent to sign in on the app, anything else refused. */
function signInFirst(sandbox: PageSandbox, agentId: string, request: Request, asked: string) {
  if (request.method !== HTTP_METHOD.GET || request.headers.get("sec-fetch-mode") !== "navigate") {
    return HttpServerResponse.text(NOT_SIGNED_IN, {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      headers: NEVER_KEPT,
    });
  }
  const [app] = sandbox.appOrigins;
  const signIn = new URL(PREVIEW_LINK.SIGN_IN_PATH, app);
  signIn.searchParams.set(PREVIEW_LINK.QUERY.AGENT, agentId);
  signIn.searchParams.set(PREVIEW_LINK.QUERY.RETURN, asked);
  return HttpServerResponse.redirect(signIn, {
    status: HOSTED_HTTP_STATUS.FOUND,
    headers: { "Cache-Control": "no-store" },
  });
}

/** The request passed on to the shared port's route, and its answer passed back, a redirect to the route's own address turned to the preview's. */
const passedOn = (request: Request, upstream: string, origin: string, asked: string) =>
  Effect.gen(function* () {
    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (!DROPPED_REQUEST_HEADERS.has(name)) headers.set(name, value);
    }
    const cookies = cookiesWithoutPreview(request);
    if (cookies !== undefined) headers.set("cookie", cookies);
    const hasBody = request.method !== HTTP_METHOD.GET && request.method !== "HEAD";
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
      ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    };
    const answered = yield* Effect.tryPromise(() => fetch(new URL(asked, upstream), init)).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning("a preview's sandbox did not answer", failure),
      ),
      Effect.mapError(() => HOSTED_REFUSAL.UPSTREAM_ERROR),
    );
    const back = new Headers(NEVER_KEPT);
    for (const [name, value] of answered.headers) {
      if (name === "set-cookie" || DROPPED_RESPONSE_HEADERS.has(name)) continue;
      back.set(name, value);
    }
    for (const cookie of answered.headers.getSetCookie()) back.append("set-cookie", cookie);
    const location = answered.headers.get("location") ?? "";
    const routeOrigin = new URL(upstream).origin;
    if (location.startsWith(routeOrigin)) {
      back.set("location", `${origin}${location.slice(routeOrigin.length)}`);
    }
    return HttpServerResponse.fromWeb(
      new Response(answered.body, { status: answered.status, headers: back }),
    );
  });

export interface PreviewProxySeams {
  /** The agent's sandbox as its shared port is read: over the runtime's `Sandbox` in production. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, DatabaseServices | Sandbox>;
}

/** Any method, any path, on a preview host alone. */
const proxyEndpoint = (seams: PreviewProxySeams) =>
  Effect.gen(function* () {
    const request = yield* webRequest;
    const sandbox = yield* pageSandbox;
    const address = new URL(request.url);
    const agentId = agentOfPreviewHost(sandbox, address.host);
    if (agentId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const now = yield* Clock.currentTimeMillis;
    const asked = askedPath(address);
    if (asked.split("?")[0] === PREVIEW_LINK.SESSION_PATH) {
      return sessionStep(sandbox, agentId, new URL(asked, address.origin), now);
    }
    const member = readPreviewSession(sandbox, previewCookie(request) ?? "", now);
    if (member === undefined || member.agentId !== agentId) {
      return signInFirst(sandbox, agentId, request, asked);
    }
    const { sessionId } = yield* reachedAgentSession(member.userId, agentId);
    const shared =
      sessionId === undefined
        ? null
        : yield* Effect.provide(
            Effect.gen(function* () {
              return yield* sandboxOrUpstream((yield* AgentSandbox).shared(sessionId));
            }),
            seams.sandbox,
          );
    if (shared === null) {
      return HttpServerResponse.text(NOT_SHARED, {
        status: HOSTED_HTTP_STATUS.NOT_FOUND,
        headers: NEVER_KEPT,
      });
    }
    return yield* passedOn(request, shared.url, previewOrigin(sandbox, agentId), asked);
  });

/** The preview host's one route. */
export function previewProxyApp(
  seams: PreviewProxySeams,
): WebRoutes<DatabaseServices | PageLinks | Sandbox> {
  return HttpRouter.add(ANY_METHOD, ANY_PATH, hostedRefusing(proxyEndpoint(seams)));
}
