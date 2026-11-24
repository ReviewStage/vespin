// tab-route.ts -- which tab's stack a thread, a task, or an agent opens on: the tab standing in a compact window, so Back returns where it was opened from, and the item's own tab in a regular one, whose split view selects it beside its list.

import { type IosTab, iosRouteOnTab, iosTabOfGroup } from "@repo/features/ios-app-links";
import { useWindowSizeClass, WINDOW_SIZE_CLASS } from "@repo/ui-native";
import { useSegments } from "expo-router";
import { createContext, useCallback, useContext, useLayoutEffect } from "react";
import { standingWithoutInbox, useInboxShown } from "./inbox/inbox-shown.js";

/** The tab whose stack a screen stands on, which each tab's stack layout hands its screens; none outside the tabs. */
export const OwnTabContext = createContext<IosTab | undefined>(undefined);

/** The tab whose stack the calling screen stands on, whichever tab is shown. */
export function useOwnTab(): IosTab | undefined {
  return useContext(OwnTabContext);
}

/** The tabs' own segment (`app/(app)/(tabs)`), which the segment of the tab group in front follows. */
const TABS_SEGMENT = "(tabs)";

/**
 * The segment of the tab group in front (`(inbox)`, `(tasks)`, ...), by the
 * route's segments, the one after the tabs' own; none while no tab stands.
 * Note that it is found by the tabs' segment rather than at a fixed place,
 * because the tabs stand under the app's own group (`(app)`), beside an
 * iPad's split view at the root.
 */
export function tabGroupOf(segments: readonly string[]): string | undefined {
  const at = segments.indexOf(TABS_SEGMENT);

  return at < 0 ? undefined : segments[at + 1];
}

/** The segments under the tab group in front, its own first (`(inbox)`, `inbox`, `[id]`); none while no tab stands. */
export function tabSegmentsOf(segments: readonly string[]): readonly string[] {
  const at = segments.indexOf(TABS_SEGMENT);

  return at < 0 ? [] : segments.slice(at + 1);
}

/** The segment of the tab group standing in front, as the tabs' layout last saw the route; none while no tab stands, as under a sheet or before the tabs mount. */
let standingGroup: string | undefined;

/**
 * Keeps the tab standing in front for `useOnTab` to read at a press, from
 * the tabs' layout, which hears every change of route anyway. Note that it
 * is kept here rather than each screen reading `useSegments`, because that
 * reads expo-router's route context, which draws every screen calling it
 * again on every push and pop, the screen under the one pushed included, in
 * the very render the push stands its first frame in.
 */
export function useKeepStandingTab(): void {
  const group = tabGroupOf(useSegments());
  useLayoutEffect(() => {
    standingGroup = group;

    return () => {
      standingGroup = undefined;
    };
  }, [group]);
}

/**
 * The route to push for a thread, a task, an agent, or a page under them, as
 * the tab that should open it names it (`iosRouteOnTab`). Note that a compact
 * window opens it on the tab standing, as Mail and Messages push a related
 * page onto the stack the person is in, while a regular window opens it on
 * its own tab, because that tab's split view selects it beside its list, as
 * it always has. Note that a route named by no tab, such as one opened from
 * a sheet over the tabs, opens on its own tab too, but for a thread while
 * the Inbox is off, which opens on Tasks' (`standingWithoutInbox`). The tab
 * standing is read as the route is named (`useKeepStandingTab`), so a
 * change of route never draws the caller again.
 */
export function useOnTab(): (route: string) => string {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const shown = useInboxShown();

  // Note that the answer holds while the window's size class and the Inbox's setting do, so an effect that opens a route on it runs again only as one of them moves.
  return useCallback(
    (route) =>
      iosRouteOnTab(
        route,
        standingWithoutInbox(compact ? iosTabOfGroup(standingGroup) : undefined, shown),
      ),
    [compact, shown],
  );
}

/**
 * The route to push for a page a screen opens from itself, such as a task's
 * comments, a row of its own list, or an agent's pull request, named on the
 * stack the screen stands on, so it is pushed there whatever the window; on
 * the route's own tab where the screen stands on none, as a split view's
 * column drawn over the tabs does, but Tasks' for a thread while the Inbox
 * is off.
 */
export function useOnOwnTab(): (route: string) => string {
  const own = standingWithoutInbox(useOwnTab(), useInboxShown());

  return useCallback((route) => iosRouteOnTab(route, own), [own]);
}
