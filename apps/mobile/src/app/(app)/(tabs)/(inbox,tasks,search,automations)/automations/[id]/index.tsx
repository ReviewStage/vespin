// index.tsx -- an automation's page, by the `id` its route names, pushed on the tab it was opened from.

import { useLocalSearchParams } from "expo-router";
import { AutomationPageScreen } from "../../../../../../screens/automation-page-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../screen-boundary.js";

export default function AutomationScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();

  return <AutomationPageScreen automationId={id} />;
}
