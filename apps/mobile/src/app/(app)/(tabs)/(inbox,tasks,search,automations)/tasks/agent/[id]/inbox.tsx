// inbox.tsx -- an agent's or a Manager's own Inbox, pushed from the threads capsule over its composer.

import { AgentInboxScreen } from "../../../../../../../screens/inbox-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../screen-boundary.js";

export default function AgentInboxRoute() {
  return <AgentInboxScreen />;
}
