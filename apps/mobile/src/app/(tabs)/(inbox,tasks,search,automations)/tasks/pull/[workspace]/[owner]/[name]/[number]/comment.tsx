// comment.tsx -- a new comment on one pull request, by its workspace, its repository's owner and name, and its number.

import { PullRequestCommentScreen } from "../../../../../../../../../screens/pull-request-thread-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../screen-boundary.js";

export default function PullRequestCommentRoute() {
  return <PullRequestCommentScreen />;
}
