/**
 * inbox-groups.ts -- the holders of the Inbox's items in one workspace, as the app's screens group them: the host's document's feed and what it says holds items, over the task list's collections.
 *
 * The feed and the tasks holding items are the document's
 * (`@repo/host/app-state-reads`' `selectInboxHoldings`), and the tasks
 * themselves the task list's collections', each read by its id
 * (`useTaskListRowsOf`), so the grouping reads no list of the document's
 * own, and none of the account's other tasks. A thread on no task, a
 * Manager's, is grouped under the agent that posted it, read from the
 * list's agents by its id the same way, as the panel's Inbox lists it.
 *
 * Where the account's database keeps the Inbox's items (`InboxHoldings`'
 * `stored`), as a signed-in phone's does, the document holds none of them:
 * they are read through a live query over the pool's kept collection, as
 * far as the screen's reach reads (`@repo/host/inbox-rows`), and grouped as
 * the document's would be. A fixture run's, whose items the document holds,
 * reads them there as before.
 */

import {
  type InboxAnyHolder,
  type InboxGroup,
  inboxRowGroups,
} from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { inboxGroupsIn, selectInboxHoldings } from "@repo/host/app-state-reads";
import { INBOX_ATTENTION, type InboxReach, inboxHoldingsOfRows } from "@repo/host/inbox-rows";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections, useTaskListRowsOf } from "../host/host-provider.js";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";
import { useInboxRows } from "./inbox-rows.js";

/** No holder grouped: what a read before the document lands answers. */
const NO_GROUPS: readonly InboxGroup<InboxAnyHolder>[] = [];

/** No holder grouped whole: what a read before the document lands answers, and what a phone whose items are kept on disk answers. */
const NO_WHOLE_GROUPS: readonly InboxGroup<InboxAnyHolder, InboxItem>[] = [];

/** No task holds items: what a read before the document lands names. */
const NO_HOLDERS: readonly string[] = [];

/** The tasks and agents `holdings` names as holding items, each read by its id from the task list's collections, as the grouping looks them up. */
function useHoldersListed(
  holdings:
    | { readonly tasks: readonly { readonly taskId: string }[]; readonly agents: object }
    | undefined,
) {
  const { tasks, agents } = useTaskListCollections();

  const holders = useMemo(
    () => holdings?.tasks.map(({ taskId }) => taskId) ?? NO_HOLDERS,
    [holdings],
  );

  const agentHolders = useMemo(
    () => (holdings === undefined ? NO_HOLDERS : Object.keys(holdings.agents)),
    [holdings],
  );

  // Note that only the tasks holding items are read, which is all the grouping looks up, so a task that holds none moving, as a working agent's turn moves its task, groups nothing again.
  return {
    listed: useTaskListRowsOf(tasks, holders),
    listedAgents: useTaskListRowsOf(agents, agentHolders),
  };
}

/**
 * Every holder of Inbox items in the workspace `workspaceId` names, its
 * items open and settled alike, each as the list reads it, as its row
 * (`InboxRow`), as the list model groups them (`inboxGroupsIn`), as far as
 * `reach` reads where they are kept on disk, what Open, Questions, and
 * Reminders can list unless it says otherwise; every workspace's where none
 * is named, and none before the document lands or the kept items are read.
 * Where the phone keeps them on disk each row is read as it is kept, its
 * digest taken as its follow wrote it; a fixture run's, whose items the
 * document holds, are read there whole and as their rows
 * (`inboxRowGroups`). Grouped again only as the feed, what holds items, or
 * a task holding items moves.
 */
export function useInboxGroupsIn(
  workspaceId: string | undefined,
  reach: InboxReach = INBOX_ATTENTION,
): readonly InboxGroup<InboxAnyHolder>[] {
  const { data: told } = useQuery({ ...appStateQuery, select: selectInboxHoldings });
  const rows = useInboxRows(told?.stored === true ? reach : undefined);

  const holdings = useMemo(
    () =>
      told?.stored !== true || rows === undefined ? undefined : inboxHoldingsOfRows(rows, told),
    [told, rows],
  );

  const { listed, listedAgents } = useHoldersListed(holdings);
  const whole = useInboxWholeGroupsIn(workspaceId);
  const read = told?.stored === true ? holdings !== undefined : told !== undefined;

  // Note that the launch notes when a screen first grouped the Inbox, so `app:ready` says how much of its wait came after.
  useEffect(() => {
    if (read) noteLaunchPhase(LAUNCH_PHASE.INBOX);
  }, [read]);

  return useMemo(() => {
    if (told?.stored !== true) return inboxRowGroups(whole);

    return holdings === undefined
      ? NO_GROUPS
      : inboxGroupsIn(holdings, listed, workspaceId, listedAgents);
  }, [told?.stored, whole, holdings, listed, listedAgents, workspaceId]);
}

/**
 * The same holders (`useInboxGroupsIn`) with their whole items, threads
 * and all, where the document holds them, as a fixture run's does; none
 * where the phone keeps them on disk, whose threads are read from their
 * messages as one opens (`useThreadMessages`).
 */
export function useInboxWholeGroupsIn(
  workspaceId: string | undefined,
): readonly InboxGroup<InboxAnyHolder, InboxItem>[] {
  const { data: told } = useQuery({ ...appStateQuery, select: selectInboxHoldings });
  const holdings = told?.stored === true ? undefined : told;
  const { listed, listedAgents } = useHoldersListed(holdings);

  return useMemo(
    () =>
      holdings === undefined
        ? NO_WHOLE_GROUPS
        : inboxGroupsIn(holdings, listed, workspaceId, listedAgents),
    [holdings, listed, workspaceId, listedAgents],
  );
}
