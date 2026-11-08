/**
 * index.tsx -- the panel window's entry: `App`, under the window's own router.
 *
 * Loaded by `index.html` alone. `App` is where session replay starts, and
 * this is the window whose start is timed.
 */

import { PANEL_PATH } from "@repo/features/link-home";
import { createPanelRouter, PanelRouterProvider } from "@repo/panel/panel-router";
import { queryClient } from "@repo/panel/query-client";
import { createMemoryHistory } from "@tanstack/react-router";
import { mountWindow } from "./window-root";

// Note that the router keeps its history in memory, because the window is loaded from a file or a dev server rather than at an address of ours;
// the panel's back and forward live there for as long as the window is open, from the panel's own path, which names no place.
const router = createPanelRouter(
  createMemoryHistory({ initialEntries: [PANEL_PATH] }),
  queryClient,
);

// The panel is the window a person waits on, so it alone times its start.
mountWindow(<PanelRouterProvider router={router} />, { timesStart: true });
