// files.tsx -- the files one pull request changes, by its workspace, its repository's owner and name, and its number, as GitHub lists them.

import { PullRequestFilesScreen } from "../../../../../../../../../screens/pull-request-files-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../../../screen-boundary.js";

export default function PullRequestFilesRoute() {
  return <PullRequestFilesScreen />;
}
