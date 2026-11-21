// index.tsx -- New Manager, as a sheet over the tabs, opened from the Managers section's +.

import { NewManagerScreen } from "../../screens/manager-sheets.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function NewManagerRoute() {
  return <NewManagerScreen />;
}
