// agent-ports.tsx -- the listening ports of the agent the route's `agent` names, each shared by a public link, opened in Safari, or no longer shared, as a sheet over its page.

import { useLocalSearchParams } from "expo-router";
import { AgentPortsScreen } from "../../screens/agent-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function AgentPortsRoute() {
  const { agent = "" } = useLocalSearchParams<{ agent: string }>();

  return <AgentPortsScreen agentId={agent} />;
}
