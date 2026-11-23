// [threadId].tsx -- one review thread of a pull request, by its workspace, its repository's owner and name, its number, and GitHub's id for the thread.

import { PullRequestThreadScreen } from "../../../../../../../../../../screens/pull-request-thread-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../../screen-boundary.js";

export default function PullRequestThreadRoute() {
  return <PullRequestThreadScreen />;
}
