// index.tsx -- New workspace, as a sheet over the tabs, opened from the workspace switcher.

import { NewWorkspaceScreen } from "../../screens/workspace-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function NewWorkspaceRoute() {
  return <NewWorkspaceScreen />;
}
