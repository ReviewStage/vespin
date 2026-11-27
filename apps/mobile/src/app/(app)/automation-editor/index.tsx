// index.tsx -- New automation, or an automation's Edit where the route names one by `automation`, as a sheet over the app.

import { AutomationEditorScreen } from "../../../screens/automation-editor-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function AutomationEditorRoute() {
  return <AutomationEditorScreen />;
}
