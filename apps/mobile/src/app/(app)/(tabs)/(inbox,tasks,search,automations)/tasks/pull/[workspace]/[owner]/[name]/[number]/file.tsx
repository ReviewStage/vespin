// file.tsx -- one file a pull request changes, its diff, by the pull request's workspace, its repository's owner and name, and its number, the file named by its path in the query.

import { PullRequestFileScreen } from "../../../../../../../../../../screens/pull-request-files-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../../screen-boundary.js";

export default function PullRequestFileRoute() {
  return <PullRequestFileScreen />;
}
