// review.tsx -- the member's pending review on a pull request, by its workspace, its repository's owner and name, and its number: its comments listed, finished with what the review says, or discarded.

import { PullRequestReviewScreen } from "../../../../../../../../../../screens/pull-request-files-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../../screen-boundary.js";

export default function PullRequestReviewRoute() {
  return <PullRequestReviewScreen />;
}
