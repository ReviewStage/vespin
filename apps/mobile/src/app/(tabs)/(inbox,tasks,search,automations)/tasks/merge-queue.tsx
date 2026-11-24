// merge-queue.tsx -- the Merge queue: every pull request the workspace's merge queues hold, the one `?pr=` names marked.

import { MergeQueueScreen } from "../../../../screens/merge-queue-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../screen-boundary.js";

export default function MergeQueueRoute() {
  return <MergeQueueScreen />;
}
