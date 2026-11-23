// line-comment.tsx -- a new review comment on one line of a pull request's file, by the pull request's workspace, its repository's owner and name, and its number, the file, line, and side named in the query.

import { PullRequestLineCommentScreen } from "../../../../../../../../../../screens/pull-request-files-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../../screen-boundary.js";

export default function PullRequestLineCommentRoute() {
  return <PullRequestLineCommentScreen />;
}
