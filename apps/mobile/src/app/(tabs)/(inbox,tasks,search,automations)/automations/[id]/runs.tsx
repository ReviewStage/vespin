// runs.tsx -- every run of the automation the route's `id` names, newest first, pushed over its page.

import { useLocalSearchParams } from "expo-router";
import { AutomationRunsScreen } from "../../../../../screens/automation-page-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../screen-boundary.js";

export default function AutomationRunsRoute() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();

  return <AutomationRunsScreen automationId={id} />;
}
