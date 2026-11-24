// agent.tsx -- the agent a same-agent automation's runs go to, picked from the workspace's agents, searched, pushed over the editor in its sheet.

import { RunsAgentScreen } from "../../screens/automation-editor-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function RunsAgentRoute() {
  return <RunsAgentScreen />;
}
