// index.tsx -- a Manager's Settings, as a sheet over its chat, opened from its ⋯.

import { ManagerSettingsScreen } from "../../../screens/manager-sheets.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function ManagerSettingsRoute() {
  return <ManagerSettingsScreen />;
}
