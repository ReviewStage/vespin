// _layout.tsx -- the tasks tab's native stack.

import { TabStack } from "../../../tab-stack.js";

/** Note that the tab's list stands under any screen a link or a notification opens, so that screen has its back button; a regular window's hand-back to the split view pops to it. */
export const unstable_settings = { anchor: "index" };

export default function TabStackLayout() {
  return <TabStack />;
}
