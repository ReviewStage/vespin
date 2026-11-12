/**
 * link-router.ts -- the window's router held in context around a surface under test, so a link pressed there is matched on the route tree as the window matches it.
 *
 * A surface reads the router of the window it is drawn in (`use-open-link.ts`'s
 * `useLinkRouter`), whose address names the workspace a link naming none is
 * matched under; here it stands at `at`, Acme's Inbox unless said, and draws
 * nothing of its own, the surface standing in its place.
 */

import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { createPanelRouter } from "../panel-router.js";
import { RoutedExitsProvider } from "../places/routed-exits.js";

/** `element` under the window's router, standing at `at`, with a window's routed exits and memory, as its root draws it. */
export function underWindowRouter(element: ReactElement, at = "/acme/inbox"): ReactElement {
  const router = createPanelRouter(
    createMemoryHistory({ initialEntries: [at] }),
    new QueryClient(),
  );

  return createElement(RouterContextProvider, {
    router,
    children: createElement(RoutedExitsProvider, null, element),
  });
}
