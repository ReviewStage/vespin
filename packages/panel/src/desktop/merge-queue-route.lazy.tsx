/**
 * merge-queue-route.lazy.tsx -- the Merge queue page as its route draws it once its chunk lands, split off the bundle every window parses, since it stands behind an experiment and opens seldom.
 */

import { createLazyRoute } from "@tanstack/react-router";
import { useMergeQueueRoute } from "../merge-queue-route.js";
import { useShellPlaces } from "./desktop-shell.js";
import { MergeQueuePage } from "./merge-queue-page.js";

/** The page in the task's place beside the sidebar, of the workspace the window lists. */
function MergeQueueRoutePlace(): React.JSX.Element {
  const { tasks } = useShellPlaces();
  const { marked } = useMergeQueueRoute();

  return <MergeQueuePage workspaceId={tasks.workspace?.id} marked={marked} />;
}

export const mergeQueueLazyRoute = createLazyRoute("/places/$workspace/merge-queue")({
  component: MergeQueueRoutePlace,
});
