// runs.tsx -- every run of the workspace's automations, newest first, as the Automations list's Runs opens them.

import { WorkspaceRunsScreen } from "../../../../../screens/automation-page-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../screen-boundary.js";

export default function WorkspaceRunsRoute() {
  return <WorkspaceRunsScreen />;
}
