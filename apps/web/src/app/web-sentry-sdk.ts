/**
 * web-sentry-sdk.ts -- the chunk `web-sentry.ts` loads where the build carries a DSN: Sentry's browser SDK, started on the desktop renderer's terms, with transactions named by route.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk rather than every export a namespace import would
 * hold on to.
 */

import { readLink } from "@repo/features/link-grammar";
import { LINK_ORIGIN, PANEL_PATH } from "@repo/features/link-home";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { sentryTracesSampler } from "@repo/features/sentry-tracing";
import { SENTRY_TUNNEL } from "@repo/features/sentry-tunnel";
import { usageDataTransportOptions } from "@repo/features/sentry-usage-data";
import { sendShownFailure } from "@repo/features/shown-failure";
import { sharesUsageData } from "@repo/host/app-state";
import { sentrySendTracer } from "@repo/panel/send-traces";
import { appStateQuery } from "@repo/panel/use-app-state";
import {
  browserTracingIntegration,
  captureException,
  captureMessage,
  getActiveSpan,
  getClient,
  getCurrentScope,
  getTraceData,
  init,
  logger,
  makeBrowserOfflineTransport,
  makeFetchTransport,
  startBrowserTracingPageLoadSpan,
  startNewTrace,
  startSpan,
  withStreamedSpan,
} from "@sentry/browser";
import type { QueryClient } from "@tanstack/react-query";
import type { WebSentry, WebSentryBuild } from "./web-sentry";

/** The SDK's client, as `getClient` answers it once `init` stands. */
type Client = NonNullable<ReturnType<typeof getClient>>;

/** The mechanism a blank tab's report names, so Sentry's issue says which path caught it, as the desktop's first read does. */
const BLANK_TAB_MECHANISM = { type: "auto.browser.web_root.first_read", handled: false } as const;

/**
 * What a span named by route says of its name, under Sentry's own attribute
 * names (`@sentry/conventions`, which the SDK does not export): that it is a
 * route, which Sentry groups by, and which path started it.
 */
const ROUTE_SOURCE = "sentry.segment.name.source";
const SPAN_ORIGIN = "sentry.origin";
const ROUTE = "route";
const PAGELOAD_ORIGIN = "auto.pageload.browser";

/**
 * The route a tab's path is named by: the kind of place the app link it is
 * names (`/app/task`, `/app/agent`), and the panel's own route for any path
 * naming none, so no workspace's slug and no id becomes a transaction's
 * name.
 */
function routeName(pathname: string): string {
  const link = readLink(`${LINK_ORIGIN}${pathname}`);

  return link === undefined ? PANEL_PATH : `${PANEL_PATH}/${link.place.kind}`;
}

/** The path of an address the tab navigated to, or the tab's own where none is said. */
function pathOf(address: string | undefined): string {
  try {
    return new URL(address ?? location.href, location.origin).pathname;
  } catch {
    return location.pathname;
  }
}

/**
 * Names the page load and every navigation by route, as Sentry's guide to a
 * custom router has it: the page load is started here by its route rather
 * than by the integration by its path, and each navigation is renamed as it
 * starts. The scope's transaction name, which every error event carries, is
 * set from the same name, so neither a span nor an error names a slug or an
 * id.
 *
 * Note that a navigation's options are changed in place, because the SDK
 * reads the name off this same object, after this hook, both to start the
 * span and to name the scope's transaction.
 */
function nameByRoute(client: Client): void {
  client.on("beforeStartNavigationSpan", (options, navigation) => {
    options.name = routeName(pathOf(navigation?.url));
    options.attributes = { ...options.attributes, [ROUTE_SOURCE]: ROUTE };
  });
  startBrowserTracingPageLoadSpan(client, {
    name: routeName(location.pathname),
    attributes: { [ROUTE_SOURCE]: ROUTE, [SPAN_ORIGIN]: PAGELOAD_ORIGIN },
  });
}

/** Whether the tab's device shares usage data, as its document says now; undefined until its settings are read. */
function usageData(queryClient: QueryClient): boolean | undefined {
  const document = queryClient.getQueryData(appStateQuery.queryKey);

  return document === undefined ? undefined : sharesUsageData(document);
}

/**
 * Starts the SDK with its default data collection, under the build's DSN,
 * environment, and release, and the desktop renderer's filters: a
 * breadcrumb or an event that names an access token is dropped whole, and
 * so is a span that names one as it starts, while every span sent has its
 * addresses scrubbed (`@repo/features/sentry-breadcrumbs`). Each page load
 * and navigation is named by the kind of place it opens, never its path. A
 * failure the panel showed is sent as a log line, and as an issue besides
 * where nothing named it (`@repo/features/shown-failure`). No event or log
 * line names the account: the tab sets no user (`PRIVACY.md`). A send the developer
 * presses is a span of its own, whose trace its act carries to the tab's
 * host and on to the service (`@repo/panel/send-traces`), because the
 * host's requests leave through a `fetch` it held before this SDK patched
 * it. Every envelope is posted
 * to a path on the tab's own origin, which passes it on to Sentry, because
 * tracker blockers refuse Sentry's own host (`@repo/features/sentry-tunnel`).
 *
 * Nothing leaves while the device does not share usage data: the SDK's
 * offline transport asks Settings › Account › "Share usage data" before each
 * envelope (`@repo/features/sentry-usage-data`), so turning it off stops the
 * tab's reports from the next one and turning it on resumes them, and one
 * made before the tab has read its settings waits in the browser's storage
 * until it has.
 */
export function initWebSentry(build: WebSentryBuild, queryClient: QueryClient): WebSentry {
  init({
    dsn: build.dsn,
    tunnel: SENTRY_TUNNEL.PATH,
    // The hooks ride the offline transport's own options, which the browser
    // SDK's `transportOptions` does not type.
    transport: (options) =>
      makeBrowserOfflineTransport(makeFetchTransport)({
        ...options,
        ...usageDataTransportOptions(() => usageData(queryClient)),
      }),
    environment: build.environment,
    ...(build.release ? { release: build.release } : undefined),
    integrations: [
      // The page load is started by route below, rather than by its path here.
      // Long animation frames name the script behind a slow frame; INP is
      // among the web vitals the SDK reports by default.
      browserTracingIntegration({ instrumentPageLoad: false, enableLongAnimationFrame: true }),
    ],
    tracesSampler: sentryTracesSampler,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: withStreamedSpan(spanWithoutAccessTokens),
  });
  const client = getClient();

  if (client !== undefined) nameByRoute(client);

  return {
    reportBlankTab: (error) => {
      captureException(error, { mechanism: BLANK_TAB_MECHANISM });
    },
    captureException: (error, hint) => captureException(error, hint),
    reportRefusal: (directive, origin) => {
      captureMessage(`Content-Security-Policy refused ${directive} to ${origin}`, "warning");
    },
    reportShownFailure: (report) =>
      sendShownFailure({ captureException, logger, getActiveSpan, getCurrentScope }, report),
    traceSend: sentrySendTracer({ startNewTrace, startSpan, getTraceData }),
  };
}
