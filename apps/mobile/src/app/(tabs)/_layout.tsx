// _layout.tsx -- the system tab bar: icon-only glass tabs for Inbox with its count, Tasks, and search, and the prominent round + that opens New task; hidden in a window wide enough for three columns, where the app sidebar stands instead.

import { useColors } from "@repo/ui-native";
import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useInboxBadge } from "../../inbox/use-inbox.js";
import { useThreeColumns, useWindowSizeClass } from "../../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../../window-size-class.js";

// Note that nothing here draws the bar: the system draws it in Liquid Glass
// and minimizes it as a list scrolls down, and a regular window, a portrait
// iPad's or the unfolded Duo's, floats it at the top. In a compact window its
// tabs are icons alone, their labels hidden through NativeTabs' own `hidden`
// and heard still as each tab's accessibility label; a regular window's
// floating bar keeps them. The selected tab is tinted in the brand's copper,
// and the Inbox carries the panel's count of what waits on you, hidden at
// none, its fill the attention fill, the light copper in either theme, since
// the system's white figures read at under 3:1 on the dark theme's accent,
// counted on the same threads the Inbox lists. Search is the system's search
// tab (`role="search"`), which iOS 26 stands on its own glass at the trailing
// end; iOS 27 gives that place to the one prominent tab, the round +, and
// stands Search last in the bar beside it. The round + opens New task as a
// sheet over whatever tab stands, rather than standing a tab of its own: it
// is held unselectable (`disabled`, which keeps its look and only stops the
// system selecting it), and its press opens the sheet.
//
// The bar is never `sidebarAdaptable`. Its sidebar would list only these
// same tabs, behind a button drawn as the split view's own sidebar toggle a
// few points from it, which hides the list beside the open item, so a
// portrait iPad stood two identical buttons doing different things. A window
// wide enough for three columns, an iPad's in landscape, hides the bar, and
// each tab's root stands the app sidebar (`screens/app-sidebar.tsx`) as its
// split view's first column instead, as Mail does: the places, Pinned and the
// member's sections, the workspace switcher, and Settings. Tabs stay mounted
// across the switch, so a fold, a rotation, or a resize keeps the open thread
// or task.
export default function TabsLayout() {
  const colors = useColors();
  const router = useRouter();
  const waiting = useInboxBadge();
  const iconOnly = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const appSidebar = useThreeColumns();
  return (
    <NativeTabs
      hidden={appSidebar}
      minimizeBehavior="onScrollDown"
      tintColor={colors.ACCENT}
      badgeBackgroundColor={colors.ATTENTION_FILL}
    >
      <NativeTabs.Trigger name="inbox" accessibilityLabel="Inbox">
        <NativeTabs.Trigger.Icon sf="tray" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Inbox</NativeTabs.Trigger.Label>
        {/* Note that the badge is left out at none rather than marked hidden, since NativeTabs draws a badge that holds a value whatever its hidden says. */}
        {waiting === 0 ? null : (
          <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks" accessibilityLabel="Tasks">
        <NativeTabs.Trigger.Icon sf="checklist" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* Note that the Search tab carries an id of its own, since a list's round search button and a split view's search field are named Search too, and a flow taps the tab by it. */}
      <NativeTabs.Trigger
        name="search"
        role="search"
        accessibilityLabel="Search"
        testID="search-tab"
      >
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="new-task"
        prominent
        disabled
        accessibilityLabel="New task"
        listeners={{ tabPress: () => router.push("/start-task") }}
      >
        <NativeTabs.Trigger.Icon sf="plus" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>New task</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
