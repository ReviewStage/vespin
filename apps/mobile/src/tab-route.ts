// tab-route.ts -- which tab's stack a thread, a task, or an agent opens on: the tab standing in a compact window, so Back returns where it was opened from, and the item's own tab in a regular one, whose split view selects it beside its list.

import { type IosTab, iosRouteOnTab, iosTabOfGroup } from "@repo/features/ios-app-links";
import { useSegments } from "expo-router";
import { createContext, useCallback, useContext } from "react";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** The tab whose stack a screen stands on, which each tab's stack layout hands its screens; none outside the tabs. */
export const OwnTabContext = createContext<IosTab | undefined>(undefined);

/** The tab whose stack the calling screen stands on, whichever tab is shown. */
export function useOwnTab(): IosTab | undefined {
  return useContext(OwnTabContext);
}

/**
 * The route to push for a thread, a task, an agent, or a page under them, as
 * the tab that should open it names it (`iosRouteOnTab`). Note that a compact
 * window opens it on the tab standing, as Mail and Messages push a related
 * page onto the stack the person is in, while a regular window opens it on
 * its own tab, because that tab's split view selects it beside its list, as
 * it always has. Note that a route named by no tab, such as one opened from
 * a sheet over the tabs, opens on its own tab too.
 */
export function useOnTab(): (route: string) => string {
  const segments: readonly string[] = useSegments();
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const standing = compact ? iosTabOfGroup(segments[1]) : undefined;

  // Note that the answer holds while the tab does, so an effect that opens a route on it runs again only when the tab moves.
  return useCallback((route) => iosRouteOnTab(route, standing), [standing]);
}

/**
 * The route to push for a page a screen opens from itself, such as a task's
 * comments, a row of its own list, or an agent's pull request, named on the
 * stack the screen stands on, so it is pushed there whatever the window; on
 * the route's own tab where the screen stands on none, as a split view's
 * column drawn over the tabs does.
 */
export function useOnOwnTab(): (route: string) => string {
  const own = useOwnTab();

  return useCallback((route) => iosRouteOnTab(route, own), [own]);
}
