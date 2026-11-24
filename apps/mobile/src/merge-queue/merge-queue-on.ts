// merge-queue-on.ts -- whether the account has the Merge queue experiment on, which every door to the Merge queue screen asks, and the route that opens it.

import { selectExperiment } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "../host/app-state-query.js";

/** The Merge queue screen's route, which a tab's stack pushes (`useOnTab`); `?pr=` names the pull request, by its GitHub address, whose row it marks. */
export const MERGE_QUEUE_ROUTE = "/tasks/merge-queue";

/** Whether the account's Merge queue experiment is on, read off its settings. */
const selectMergeQueueOn = selectExperiment(EXPERIMENT.MERGE_QUEUE);

/** Whether the account has the Merge queue experiment on, as the desktop's sidebar row asks; off while its settings are unread. */
export function useMergeQueueOn(): boolean {
  return useQuery({ ...appStateQuery, select: selectMergeQueueOn }).data === true;
}
