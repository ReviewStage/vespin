// agent-model.tsx -- the model and effort of the agent the route's `agent` names, as a sheet over its page.

import { useLocalSearchParams } from "expo-router";
import { AgentModelScreen } from "../screens/agent-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function AgentModelRoute() {
  const { agent = "" } = useLocalSearchParams<{ agent: string }>();
  return <AgentModelScreen agentId={agent} />;
}
