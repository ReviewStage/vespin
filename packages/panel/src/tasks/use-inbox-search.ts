/**
 * use-inbox-search.ts -- the listed workspace's Inbox as ⌘K searches it: every item of every standing task holding one, read only while a search asks for them.
 *
 * The palette reads the same followed inboxes the window's Inbox lists
 * (`use-holder-inbox-items.ts`), so an item found
 * is the item the Inbox opens. Note that nothing is followed until a search
 * asks, because most uses of the palette never look in the Inbox, and that
 * the items pushed are kept once it stops asking, so the next search shows
 * them at once while their follows come back.
 */

import {
  type InboxGroup,
  type InboxListed,
  inboxGroups,
  needsYou,
} from "@repo/features/inbox-list-model";
import { useMemo } from "react";
import { NO_HOLDINGS, taskHoldings, useHolderInboxItems } from "./use-holder-inbox-items.js";
import { useListedInbox } from "./use-inbox-slices.js";
import type { TasksControl } from "./use-tasks-tab.js";

/** What a search finds in the Inbox: its items, what needs the reader first, then the latest changed; and how far their read has come. */
export interface InboxSearch {
  readonly items: readonly InboxListed[];
  /** Whether an inbox the search asked for has not been pushed yet. */
  readonly reading: boolean;
  /** Whether an inbox the search asked for could not be read. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** Every item the groups hold, the reader's waiting ones first, then the latest changed first. */
function searchOrder(groups: readonly InboxGroup[], readerId: string | undefined): InboxListed[] {
  const listed = groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));

  return listed.toSorted(
    (first, second) =>
      Number(needsYou(second, readerId)) - Number(needsYou(first, readerId)) ||
      second.item.updatedAt - first.item.updatedAt,
  );
}

/** The listed workspace's Inbox, followed while `asked`; see the module's head. */
export function useInboxSearch(tasks: TasksControl, asked: boolean): InboxSearch {
  const { inboxTasks } = useListedInbox(tasks);
  const standing = tasks.listed.tasks;

  // Note that nothing is followed while no search asks.
  const holdings = useMemo(() => {
    if (!asked) return NO_HOLDINGS;
    const standingIds = new Set(standing.map((task) => task.id));

    return taskHoldings(inboxTasks.filter((holding) => standingIds.has(holding.taskId)));
  }, [asked, inboxTasks, standing]);

  const read = useHolderInboxItems(holdings);

  const items = useMemo(() => {
    const groups = asked ? inboxGroups(read.items, { tasks: inboxTasks, listed: standing }) : [];

    return searchOrder(groups, tasks.me);
  }, [asked, inboxTasks, standing, read.items, tasks.me]);

  // Note that an inbox counts as read only once its push holds what main says it now holds, since an older push kept from the last search may lack the item sought.
  const reading = read.pending;
  const { onRetry } = read;

  return { items, reading, failed: read.failed, onRetry };
}
