// time-zone.tsx -- the time zone an automation's schedule is read in, picked from every zone the phone knows, searched, pushed over the editor in its sheet.

import { TimeZoneScreen } from "../../screens/automation-editor-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function TimeZoneRoute() {
  return <TimeZoneScreen />;
}
