// _layout.tsx -- the Inbox's, Tasks', Search's, and Automations' native stacks, each mounting the thread, task, and agent screens as its own, so one opened on a tab is pushed onto that tab's stack, and saying where its bars start to the failure notice.

import { iosTabOfGroup } from "@repo/features/ios-app-links";
import { FailureNoticeBars } from "@repo/ui-native";
import { useIsFocused, useRoute } from "expo-router";
import { OwnTabContext } from "../../../../tab-route.js";
import { TabStack } from "../../../../tab-stack.js";

/** Note that each tab's root stands under any screen a link or a notification opens on it, so that screen has its back button; a regular window's hand-back to the split view pops to it. */
export const unstable_settings = {
  inbox: { anchor: "inbox" },
  tasks: { anchor: "tasks" },
  search: { anchor: "search" },
  automations: { anchor: "automations" },
};

/** Note that the stack names its tab to its screens by its own route in the tabs (`(inbox)`), since the router reports only the tab shown. It tells the failure notice where the tab's bars start while it is shown, so a banner stands under them. */
export default function TabStackLayout() {
  const { name } = useRoute();
  const shown = useIsFocused();

  return (
    <OwnTabContext value={iosTabOfGroup(name)}>
      <FailureNoticeBars inFront={shown} />
      <TabStack />
    </OwnTabContext>
  );
}
