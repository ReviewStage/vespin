/**
 * inbox-groups.ts -- the holders of the Inbox's items in one workspace, as the app's screens group them: the host's document's feed and what it says holds items, over the task list's collections.
 *
 * The feed and the tasks holding items are the document's
 * (`@repo/host/app-state-reads`' `selectInboxHoldings`), and the tasks
 * themselves the task list's collections', each read by its id
 * (`useTaskListRowsOf`), so the grouping reads no list of the document's
 * own, and none of the account's other tasks.
 */

import type { InboxGroup } from "@repo/features/inbox-list-model";
import { inboxGroupsIn, selectInboxHoldings } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections, useTaskListRowsOf } from "../host/host-provider.js";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";

/** No holder grouped: what a read before the document lands answers. */
const NO_GROUPS: readonly InboxGroup[] = [];

/** No task holds items: what a read before the document lands names. */
const NO_HOLDERS: readonly string[] = [];

/**
 * Every holder of Inbox items in the workspace `workspaceId` names, its
 * items open and settled alike, as the list model groups them
 * (`inboxGroupsIn`); every workspace's where none is named, and none before
 * the document lands. Grouped again only as the feed, what holds items, or
 * a task holding items moves.
 */
export function useInboxGroupsIn(workspaceId: string | undefined): readonly InboxGroup[] {
  const { data: holdings } = useQuery({ ...appStateQuery, select: selectInboxHoldings });
  const { tasks } = useTaskListCollections();

  const holders = useMemo(
    () => holdings?.tasks.map(({ taskId }) => taskId) ?? NO_HOLDERS,
    [holdings],
  );

  // Note that only the tasks holding items are read, which is all the grouping looks up, so a task that holds none moving, as a working agent's turn moves its task, groups nothing again.
  const listed = useTaskListRowsOf(tasks, holders);
  const read = holdings !== undefined;

  // Note that the launch notes when a screen first grouped the Inbox, so `app:ready` says how much of its wait came after.
  useEffect(() => {
    if (read) noteLaunchPhase(LAUNCH_PHASE.INBOX);
  }, [read]);

  return useMemo(
    () => (holdings === undefined ? NO_GROUPS : inboxGroupsIn(holdings, listed, workspaceId)),
    [holdings, listed, workspaceId],
  );
}
