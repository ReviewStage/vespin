// checks.tsx -- the checks run on one pull request's head, by its workspace, its repository's owner and name, and its number.

import { PullRequestChecksScreen } from "../../../../../../../../../screens/pull-request-checks-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../screen-boundary.js";

export default function PullRequestChecksRoute() {
  return <PullRequestChecksScreen />;
}
