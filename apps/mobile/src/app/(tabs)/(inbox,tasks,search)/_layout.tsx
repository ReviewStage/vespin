// _layout.tsx -- the Inbox's, Tasks', and Search's native stacks, each mounting the thread, task, and agent screens as its own, so one opened on a tab is pushed onto that tab's stack.

import { iosTabOfGroup } from "@repo/features/ios-app-links";
import { useRoute } from "expo-router";
import { OwnTabContext } from "../../../tab-route.js";
import { TabStack } from "../../../tab-stack.js";

/** Note that each tab's root stands under any screen a link or a notification opens on it, so that screen has its back button; a regular window's hand-back to the split view pops to it. */
export const unstable_settings = {
  inbox: { anchor: "inbox" },
  tasks: { anchor: "tasks" },
  search: { anchor: "search" },
};

/** Note that the stack names its tab to its screens by its own route in the tabs (`(inbox)`), since the router reports only the tab shown. */
export default function TabStackLayout() {
  const { name } = useRoute();

  return (
    <OwnTabContext value={iosTabOfGroup(name)}>
      <TabStack />
    </OwnTabContext>
  );
}
