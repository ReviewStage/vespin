// start-agent.tsx -- New agent on the task the route's `task` names, as a sheet over its page.

import { useLocalSearchParams } from "expo-router";
import { NewAgentScreen } from "../screens/start-screens.js";

export default function StartAgentRoute() {
  const { task = "" } = useLocalSearchParams<{ task: string }>();
  return <NewAgentScreen taskId={task} />;
}
