// _layout.tsx -- the system tab bar: Inbox, Tasks, a search tab, and the prominent New task tab.

import { NativeTabs } from "expo-router/native-tabs";

// Note that nothing here draws the bar: the system draws it in Liquid Glass,
// minimizes it as a list scrolls, and stands it as a sidebar rail where the
// window is wide enough, the unfolded iPhone Duo and the iPad among them.
export default function TabsLayout() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown" sidebarAdaptable>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf="tray" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
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
        <NativeTabs.Trigger.Icon sf="square.and.pencil" />
        <NativeTabs.Trigger.Label>New task</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
