// _layout.tsx -- the system tab bar: icon-only glass tabs for Inbox with its count, Tasks, and search, and, in a compact window, the prominent round + that opens New task; hidden in a window wide enough for three columns, where the app sidebar stands instead, and in a compact window over a conversation or while the Inbox stands in Select mode.

import { type IosTab, iosRouteHidesTabs, iosTabOfGroup } from "@repo/features/ios-app-links";
import { GLYPH, SplitOverTabs, UNDER_SPLIT_SCREEN, useColors } from "@repo/ui-native";
import { usePathname, useRouter, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useInboxChoosingOn } from "../../inbox/inbox-choosing.js";
import { useInboxBadge } from "../../inbox/use-inbox.js";
import { useMemberPicturesFollow } from "../../member-pictures.js";
import { placeOfRoute, SIDEBAR_PLACE } from "../../screens/app-sidebar.js";
import { AppSplit } from "../../screens/app-split.js";
import { useThreeColumns, useWindowSizeClass } from "../../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../../window-size-class.js";

/** Where the tabs stand: the tab shown, and whether its root, or an item of its own the split view selects beside its list, stands in front rather than a page pushed over it. */
type TabStanding = { readonly tab: IosTab | undefined; readonly atRoot: boolean };

/**
 * Where the tabs stand, by the route's segments (`(tabs)`, `(inbox)`,
 * `inbox`, `[id]`): the one shown, or, while a sheet such as New task or
 * Settings stands over the tabs, the one under it, so the split view behind
 * the sheet keeps its place and its layer. Note that a tab's own item route
 * stands at its root too, since a wide window hands it straight back to the
 * split view (`useHandToSplit`), while an item pushed onto another tab's
 * stack, a thread's task on the Inbox's, is a page over it.
 */
function useTabStanding(segments: readonly string[]): TabStanding {
  const [, group, first, ...rest] = segments;
  const tab = iosTabOfGroup(group);
  const atRoot = tab !== undefined && first === tab && rest.length <= 1;
  const [kept, keep] = useState<TabStanding>({ tab, atRoot });

  useEffect(() => {
    if (tab !== undefined) keep({ tab, atRoot });
  }, [tab, atRoot]);

  return tab === undefined ? kept : { tab, atRoot };
}

// Note that nothing here draws the bar: the system draws it in Liquid Glass
// and minimizes it as a list scrolls down, and floats it at the top of a
// portrait iPad. In a compact window its
// tabs are icons alone, their labels hidden through NativeTabs' own `hidden`
// and heard still as each tab's accessibility label; a regular window's
// bar, floating or a rail, keeps them. The selected tab is tinted in the brand's copper,
// and the Inbox carries the panel's count of what waits on you, hidden at
// none, its fill the attention fill, the light copper in either theme, since
// the system's white figures read at under 3:1 on the dark theme's accent,
// counted on the same threads the Inbox lists. Search is the system's search
// tab (`role="search"`), which iOS 26 stands on its own glass at the trailing
// end; iOS 27 gives that place to the one prominent tab, the round +, and
// stands Search last in the bar beside it. The round + opens New task as a
// sheet over whatever tab stands, rather than standing a tab of its own: it
// is held unselectable (`disabled`, which keeps its look and only stops the
// system selecting it), and its press opens the sheet. It stands only in a
// compact window, the iPhone's and the folded Duo's: a regular one, an
// iPad's or the open Duo's, stands New task as the compose button in its
// list column's bar instead (`useComposeAction`), as Mail does, so a window
// never offers it twice.
//
// The bar is `sidebarAdaptable` on an iPhone, which the iPhone Duo is in
// either posture: folded, iOS 27 stands its tabs as a glass rail on the
// outer display, and unfolded the bar becomes a sidebar rail beside the
// split view. It is never on an iPad, because there its button floats a few
// points from the split view's own sidebar toggle, drawn the same, while its
// sidebar lists only the tabs the floating bar already shows. Note that this
// reads the device's idiom rather than the window, as the layout never does,
// because it chooses the system's own tab chrome, which iOS itself draws by
// idiom. A window wide enough for three columns, an iPad's in landscape,
// hides the bar, and one split view stands over the tabs instead
// (`screens/app-split.tsx`), the app sidebar its first column, as Mail does:
// the workspace switcher, the places, and Pinned, Following, and the
// member's sections as collections, then the list and the page the tab
// standing hands it. A place
// picked there switches the tab under it, so the sidebar never redraws as
// the tabs change, and the split view steps behind the tabs while a tab has
// pushed a page over its root, such as an agent's. Tabs stay mounted across
// the switch, so a fold, a rotation, or a resize keeps the open thread or
// task. Nor is it on wherever the app sidebar stands, so a phone-idiom window
// that wide never shows the system's tab sidebar beside it.
export default function TabsLayout() {
  const colors = useColors();
  const router = useRouter();
  const waiting = useInboxBadge();
  // The members of the workspace the phone works in, whose pictures every face reads, followed once for every tab.
  useMemberPicturesFollow();
  const iconOnly = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const appSidebar = useThreeColumns();
  const pathname = usePathname();
  const conversation = iosRouteHidesTabs(pathname);
  const { tab: standing, atRoot } = useTabStanding(useSegments());
  // Note that a tab under the split view leaves its content clear, because NativeTabs paints each tab in the navigation theme's light ground, which flashed over the split as a page pushed.
  const underSplit = appSidebar ? UNDER_SPLIT_SCREEN.contentStyle : undefined;

  // Note that the Inbox's Select mode hides the bar only while the Inbox's own list stands, so a link that opens another place never leaves the bar hidden over it.
  const choosing =
    useInboxChoosingOn() && atRoot && placeOfRoute(standing[0]) === SIDEBAR_PLACE.INBOX;

  const tabs = (
    <NativeTabs
      hidden={appSidebar || (iconOnly && (conversation || choosing))}
      minimizeBehavior="onScrollDown"
      sidebarAdaptable={!appSidebar && !(Platform.OS === "ios" && Platform.isPad)}
      tintColor={colors.ACCENT}
      badgeBackgroundColor={colors.ATTENTION_FILL}
      badgeTextColor={colors.ON_ACCENT}
    >
      <NativeTabs.Trigger name="(inbox)" accessibilityLabel="Inbox" contentStyle={underSplit}>
        <NativeTabs.Trigger.Icon xcasset={GLYPH.INBOX} />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Inbox</NativeTabs.Trigger.Label>
        {/* Note that the badge is left out at none rather than marked hidden, since NativeTabs draws a badge that holds a value whatever its hidden says. */}
        {waiting === 0 ? null : (
          <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(tasks)" accessibilityLabel="Tasks" contentStyle={underSplit}>
        <NativeTabs.Trigger.Icon xcasset={GLYPH.TASK} />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* Note that the Search tab carries an id of its own, since a list's round search button and a split view's search field are named Search too, and a flow taps the tab by it. */}
      <NativeTabs.Trigger
        name="(search)"
        role="search"
        contentStyle={underSplit}
        accessibilityLabel="Search"
        testID="search-tab"
      >
        {/* Note that Search keeps the system's magnifier, since a search tab is iOS's own chrome. */}
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="new-task"
        prominent
        disabled
        hidden={!iconOnly}
        accessibilityLabel="New task"
        listeners={{ tabPress: () => router.push("/start-task") }}
      >
        <NativeTabs.Trigger.Icon xcasset={GLYPH.ADD} />
        <NativeTabs.Trigger.Label hidden={iconOnly}>New task</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );

  // Note that the tabs stand in the same place with or without the split view, so a rotation across the line keeps every tab's stack.
  return (
    <SplitOverTabs
      tabs={tabs}
      split={appSidebar ? <AppSplit place={placeOfRoute(standing)} front={atRoot} /> : undefined}
      front={atRoot}
    />
  );
}
