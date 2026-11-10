// [id].tsx -- one Inbox thread, read from the host's document.

import { InboxThreadScreen } from "../../../screens/inbox-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function InboxThreadRoute() {
  return <InboxThreadScreen />;
}
