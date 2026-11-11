// agent-model.tsx -- the options of the agent the route's `agent` names, its model and effort, Fast, permission mode, and MCP servers, as a sheet over its page.

import { useLocalSearchParams } from "expo-router";
import { AgentOptionsScreen } from "../screens/agent-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function AgentModelRoute() {
  const { agent = "" } = useLocalSearchParams<{ agent: string }>();
  return <AgentOptionsScreen agentId={agent} />;
}
