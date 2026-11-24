// index.tsx -- the Automations tab: the workspace's automations under the tab's large title, its bar led by the workspace switcher, as every tab's root is.

import { AutomationsScreen } from "../../../../../screens/automation-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../screen-boundary.js";

export default function AutomationsTabScreen() {
  return <AutomationsScreen />;
}
