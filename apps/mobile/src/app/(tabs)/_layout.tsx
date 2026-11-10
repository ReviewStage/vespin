// _layout.tsx -- the system tab bar: icon-only glass tabs for Inbox with its count, Tasks, and search, and the prominent round + for New task.

import { useColors } from "@repo/ui-native";
import { NativeTabs } from "expo-router/native-tabs";
import { useInboxBadge } from "../../inbox/use-inbox.js";
import { useWindowSizeClass } from "../../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../../window-size-class.js";

// Note that nothing here draws the bar: the system draws it in Liquid Glass,
// minimizes it as a list scrolls, and stands it as a sidebar rail where the
// window is wide enough, the unfolded iPhone Duo and the iPad among them. In
// a compact window its tabs are icons alone, their labels hidden through
// NativeTabs' own `hidden` and heard still as each tab's accessibility label;
// a regular window's sidebar keeps them, since a sidebar row is its words.
// The selected tab is tinted in the brand's copper, and the Inbox carries the
// panel's count of what waits on you in copper, hidden at none, counted on
// the same threads the Inbox lists.
export default function TabsLayout() {
  const colors = useColors();
  const waiting = useInboxBadge();
  const iconOnly = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      sidebarAdaptable
      tintColor={colors.ACCENT}
      badgeBackgroundColor={colors.ACCENT}
    >
      <NativeTabs.Trigger name="inbox" accessibilityLabel="Inbox">
        <NativeTabs.Trigger.Icon sf="tray" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={waiting === 0}>
          {String(waiting)}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks" accessibilityLabel="Tasks">
        <NativeTabs.Trigger.Icon sf="checklist" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search" accessibilityLabel="Search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="new-task" prominent accessibilityLabel="New task">
        <NativeTabs.Trigger.Icon sf="plus" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>New task</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
