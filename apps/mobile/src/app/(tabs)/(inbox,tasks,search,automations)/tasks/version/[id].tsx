// [id].tsx -- one version of a task's description, read whole from its version history, with its restore.

import { VersionScreen } from "../../../../../screens/history-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../screen-boundary.js";

export default function VersionRoute() {
  return <VersionScreen />;
}
