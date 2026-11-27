// chapters.tsx -- one pull request's chapters, by its workspace, its repository's owner and name, and its number.

import { PullRequestChaptersScreen } from "../../../../../../../../../../screens/pull-request-chapters-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../../screen-boundary.js";

export default function PullRequestChaptersRoute() {
  return <PullRequestChaptersScreen />;
}
