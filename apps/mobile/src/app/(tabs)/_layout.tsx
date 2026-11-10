// _layout.tsx -- the system tab bar: Inbox with its count, Tasks, a search tab, and the prominent New task tab, its + as the panel's.

import { useColors } from "@repo/ui-native";
import { NativeTabs } from "expo-router/native-tabs";
import { useInboxBadge } from "../../inbox/use-inbox.js";

// Note that nothing here draws the bar: the system draws it in Liquid Glass,
// minimizes it as a list scrolls, and stands it as a sidebar rail where the
// window is wide enough, the unfolded iPhone Duo and the iPad among them. It
// is tinted in the brand's copper, and the Inbox carries the panel's count of
// what waits on you in the attention fill, hidden at none, counted on the
// same threads the Inbox lists.
export default function TabsLayout() {
  const colors = useColors();
  const waiting = useInboxBadge();
  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      sidebarAdaptable
      tintColor={colors.ACCENT}
      badgeBackgroundColor={colors.ATTENTION_FILL}
    >
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf="tray" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={waiting === 0}>
          {String(waiting)}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Icon sf="checklist" />
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="new-task" prominent>
        <NativeTabs.Trigger.Icon sf="plus" />
        <NativeTabs.Trigger.Label>New task</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
