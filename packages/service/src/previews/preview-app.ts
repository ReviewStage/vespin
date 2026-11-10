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

import { BRAND_PALETTE, MARK_ART } from "@repo/brand";
import type { DatabaseServices } from "@repo/database/core/query";
import { PREVIEW_SIGN_IN } from "@repo/features/preview-sign-in";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import type { Sandbox, SandboxError } from "@repo/sandbox";
import { HTTP_METHOD } from "@repo/wire";
import { Clock, Duration, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  AgentSandbox,
  type AgentSandboxService,
  PREVIEW_STANDING,
} from "../agents/terminal/agent-sandbox.js";
import { NOT_RUNNING_HEADER, STARTING_HEADER } from "../agents/terminal/preview-relay.js";
import { reachedAgentSession, sandboxOrUpstream } from "../agents/terminal/sandbox-reach.js";
import { afterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  HOSTED_REFUSAL_STATUS,
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
const NO_PREVIEW = "Nothing running here.";
const WAKING = "Waking up the preview. This page reloads when it's ready.";

/** How often the waking page asks whether the preview is ready. */
const WAKING_POLL_SECONDS = 2;

/** How a preview host's own pages are drawn: in the brand's colors, light or dark as the browser asks. */
const PAGE_STYLE = `:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:0 24px;font:15px/1.5 system-ui,sans-serif;background:${BRAND_PALETTE.LIGHT.GROUND};color:${BRAND_PALETTE.LIGHT.TEXT_MUTED};text-align:center}svg{color:${BRAND_PALETTE.LIGHT.ACCENT}}h1{font-size:17px;color:${BRAND_PALETTE.LIGHT.TEXT};margin:16px 0 6px}@media (prefers-color-scheme:dark){body{background:${BRAND_PALETTE.DARK.GROUND};color:${BRAND_PALETTE.DARK.TEXT_MUTED}}svg{color:${BRAND_PALETTE.DARK.ACCENT}}h1{color:${BRAND_PALETTE.DARK.TEXT}}}`;

/** The product's mark, which heads a preview host's own pages so a visitor knows whose page it is. */
const PAGE_MARK = `<svg viewBox="${MARK_ART.VIEW_BOX}" width="40" height="40" role="img" aria-label="${PRODUCT_NAME}"><path d="${MARK_ART.PATH}" fill="currentColor"/></svg>`;

/** A preview host's own page: the mark, a heading and a line under it, with what its head and its end add. */
function previewPage(page: {
  readonly title: string;
  readonly line: string;
  readonly head?: string;
  readonly end?: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${page.head ?? ""}<title>${page.title}</title><style>${PAGE_STYLE}</style></head><body><main>${PAGE_MARK}<h1>${page.title}</h1><p>${page.line}</p></main>${page.end ?? ""}</body></html>`;
}

/** The page a visit sees where nothing is shared from the agent now, its server stopped while the sandbox ran, or the preview is refused, as for an archived agent. */
const NO_PREVIEW_PAGE = previewPage({
  title: "Nothing running here",
  line: "The dev server may have been stopped, or the agent may have been archived.",
});

/**
 * The page a visit sees while the agent's sandbox or its server comes up: it
 * asks the preview's status path in the background and reloads once, when
 * the preview answers. Without script it reloads itself instead.
 */
const WAKING_PAGE = previewPage({
  title: "Waking up the preview",
  line: "This page reloads when it's ready.",
  head: '<noscript><meta http-equiv="refresh" content="5"></noscript>',
  end: `<script>(function poll(){fetch("${PREVIEW_LINK.STATUS_PATH}",{cache:"no-store",credentials:"same-origin"}).then(function(r){return r.ok?r.json():{ready:false}}).catch(function(){return {ready:false}}).then(function(s){if(s.ready)location.reload();else setTimeout(poll,${WAKING_POLL_SECONDS * 1000})})})()</script>`,
});

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

/** Whether the request is a browser's page load, which is answered a page rather than bare text or JSON. */
function isPageLoad(request: Request): boolean {
  return request.headers.get("sec-fetch-mode") === "navigate";
}

/** A request without a member's cookie: a page load sent to sign in on the app, anything else refused. */
function signInFirst(sandbox: PageSandbox, agentId: string, request: Request, asked: string) {
  if (request.method !== HTTP_METHOD.GET || !isPageLoad(request)) {
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

/** What a visit is answered where nothing is shared from the agent now, or its server stopped: a page for a page load, bare text for anything else, under the status given. */
function noPreview(request: Request, status: number = HOSTED_HTTP_STATUS.NOT_FOUND) {
  const page = isPageLoad(request);
  return HttpServerResponse.text(page ? NO_PREVIEW_PAGE : NO_PREVIEW, {
    status,
    ...(page ? { contentType: "text/html; charset=utf-8" } : {}),
    headers: NEVER_KEPT,
  });
}

/**
 * A refusal a page load meets drawn as the no-preview page, never the API's
 * JSON, under the refusal's own status, so an outage still reads as one to
 * whatever retries; anything else keeps the refusal.
 */
const refusedAsPage = <R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
) =>
  Effect.catch(endpoint, (refusal) =>
    Effect.flatMap(webRequest, (request) =>
      isPageLoad(request)
        ? Effect.succeed(noPreview(request, HOSTED_REFUSAL_STATUS[refusal.error]))
        : Effect.fail(refusal),
    ),
  );

/** What a visit is answered while the sandbox or its server comes up: a page that reloads itself for a page load, a bare 503 for anything else. */
function wakingPage(request: Request) {
  const headers = { ...NEVER_KEPT, "Retry-After": String(WAKING_POLL_SECONDS) };
  if (!isPageLoad(request)) {
    return HttpServerResponse.text(WAKING, {
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
      headers,
    });
  }
  return HttpServerResponse.text(WAKING_PAGE, {
    status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    contentType: "text/html; charset=utf-8",
    headers,
  });
}

/** The status path's answer: whether a reload would now show the preview, never kept by the CDN. */
function statusAnswer(ready: boolean) {
  return HttpServerResponse.text(JSON.stringify({ ready }), {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: "application/json",
    headers: NEVER_KEPT,
  });
}

/** Whether the shared port's server answers through its route, rather than the relay saying it is still starting. */
const serverAnswers = (upstream: string) =>
  Effect.tryPromise(() => fetch(upstream, { redirect: "manual" })).pipe(
    Effect.map((answered) => {
      void answered.body?.cancel();
      // A server that stopped under a running share answers too, so the page reloads to say so.
      return (
        answered.headers.has(NOT_RUNNING_HEADER) ||
        (!answered.headers.has(STARTING_HEADER) && answered.status < HOSTED_HTTP_STATUS.BAD_GATEWAY)
      );
    }),
    Effect.orElseSucceed(() => false),
  );

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
    const routeOrigin = new URL(upstream).origin;
    // Note that the path is joined to the route's origin rather than resolved against it, so a path like `//other.host/` stays on the route.
    const target = new URL(`${routeOrigin}${asked}`);
    if (target.origin !== routeOrigin) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const answered = yield* Effect.tryPromise(() => fetch(target, init)).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning("a preview's sandbox did not answer", failure),
      ),
      Effect.mapError(() => HOSTED_REFUSAL.UPSTREAM_ERROR),
    );
    // The relay answers so while the port's server it started again is still coming up.
    if (answered.headers.has(STARTING_HEADER)) return wakingPage(request);
    if (answered.headers.has(NOT_RUNNING_HEADER)) return noPreview(request);
    const back = new Headers();
    for (const [name, value] of answered.headers) {
      if (name === "set-cookie" || DROPPED_RESPONSE_HEADERS.has(name)) continue;
      back.set(name, value);
    }
    for (const cookie of answered.headers.getSetCookie()) back.append("set-cookie", cookie);
    // Our own cache rule goes on last, so nothing the sandbox answers lets the CDN keep a preview for another visitor.
    for (const [name, value] of Object.entries(NEVER_KEPT)) back.set(name, value);
    const location = answered.headers.get("location") ?? "";
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
    if (sessionId === undefined) return noPreview(request);
    const onSandbox = <A>(call: (agent: AgentSandboxService) => Effect.Effect<A, SandboxError>) =>
      Effect.provide(
        Effect.gen(function* () {
          return yield* sandboxOrUpstream(call(yield* AgentSandbox));
        }),
        seams.sandbox,
      );
    const status = asked.split("?")[0] === PREVIEW_LINK.STATUS_PATH;
    const preview = yield* onSandbox((agent) => agent.preview(sessionId));
    // Note that a share gone while the page waited reloads it too, so it shows why.
    if (preview.kind === PREVIEW_STANDING.NONE)
      return status ? statusAnswer(true) : noPreview(request);
    if (preview.kind === PREVIEW_STANDING.WAKING) {
      // Note that the visit answers at once and the resume runs after it, so the waking page asks again until the sandbox is up.
      if (preview.state === SANDBOX_STATE.STOPPED) {
        yield* afterResponse(
          "a preview woke its agent's sandbox",
          Effect.ignore(onSandbox((agent) => agent.resume(sessionId))),
        );
      }
      return status ? statusAnswer(false) : wakingPage(request);
    }
    if (status) return statusAnswer(yield* serverAnswers(preview.url));
    return yield* passedOn(request, preview.url, previewOrigin(sandbox, agentId), asked);
  });

/** The preview host's one route. */
export function previewProxyApp(
  seams: PreviewProxySeams,
): WebRoutes<DatabaseServices | PageLinks | Sandbox> {
  return HttpRouter.add(ANY_METHOD, ANY_PATH, hostedRefusing(refusedAsPage(proxyEndpoint(seams))));
}
