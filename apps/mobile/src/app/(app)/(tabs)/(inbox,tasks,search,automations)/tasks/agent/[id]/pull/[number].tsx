// [number].tsx -- an agent's pull request by its number, as an older link, handoff, or launch names it, opened by its repository and number once the agent is read.

import { AgentPullRequestScreen } from "../../../../../../../../screens/pull-request-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../screen-boundary.js";

export default function AgentPullRequestRoute() {
  return <AgentPullRequestScreen />;
}
