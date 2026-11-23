// index.tsx -- the Inbox list: the account's threads under the panel's scopes, read from the host's document, with the account's photo opening Settings in its bar.

import { probeOnce } from "../../../../launch-probe.js";
import { InboxListScreen } from "../../../../screens/inbox-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../screen-boundary.js";

export default function InboxScreen() {
  probeOnce("inbox-route-render");
  return <InboxListScreen />;
}
