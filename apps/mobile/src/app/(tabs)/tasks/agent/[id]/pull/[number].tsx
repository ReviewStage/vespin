// [number].tsx -- one agent's pull request by its number, its checks and reviews live, read from the host's document.

import { PullRequestScreen } from "../../../../../../screens/pull-request-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../screen-boundary.js";

export default function PullRequestRoute() {
  return <PullRequestScreen />;
}
