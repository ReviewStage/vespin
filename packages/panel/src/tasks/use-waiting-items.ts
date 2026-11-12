import {
  type InboxGroup,
  type InboxListed,
  inboxGroups,
  openItems,
} from "@repo/features/inbox-list-model";
import { useMemo } from "react";
import {
  type HolderInboxItems,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import { useListedInbox } from "./use-inbox-slices.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * use-waiting-items.ts -- every open Inbox item of the listed workspace, a teammate's agent's among them, as Home and a person's page list what waits.
 *
 * Main's read of the account counts only what waits on its own agents, so
 * a place that lists what waits as the window's Inbox does follows each plan
 * holding an item whole, as the Inbox follows them. Every open item is listed, whoever
 * it waits on, since a person's page lists what waits on them; Home keeps only the reader's own
 * (`needsReader`).
 */

/** What waits, the latest changed first; whether a read is still out or did not answer; and Retry. */
export interface WaitingItems {
  readonly items: readonly InboxListed[];
  /** The plans whose items were read as main says they stand now, which `items` speaks for whole; a plan that changed since, its read out or failed, is not among them. */
  readonly readTasks: ReadonlySet<string>;
  readonly reading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

type UseListedInboxGroupsResult = {
  readonly groups: readonly InboxGroup[];
  readonly read: HolderInboxItems;
};

/**
 * Every plan of the listed workspace's Inbox, its items open and settled
 * alike, read as the window's Inbox reads them: each plan main says holds
 * an item and the listed workspace's list holds, read whole, a teammate's
 * agent's items among them, as every member's Inbox lists them; and the
 * read they come from.
 */
function useListedInboxGroups(tasks: TasksControl): UseListedInboxGroupsResult {
  const { inboxTasks } = useListedInbox(tasks);
  const listed = tasks.listed.tasks;

  // Note that every plan holding an item is read, not only those main counts as waiting on the
  // account, because those are its own agents' alone, and the Inbox lists every member's.
  const holdings = useMemo(() => {
    const listedIds = new Set(listed.map((task) => task.id));

    return inboxTasks.filter((holding) => listedIds.has(holding.taskId));
  }, [inboxTasks, listed]);

  const read = useHolderInboxItems(useMemo(() => taskHoldings(holdings), [holdings]));
  const groups = inboxGroups(read.items, { tasks: holdings, listed });

  return { groups, read };
}

/** Every open Inbox item of the listed workspace's plans, the latest changed first, read as the window's Inbox reads them (`useListedInboxGroups`). */
export function useWaitingItems(tasks: TasksControl): WaitingItems {
  const { groups, read } = useListedInboxGroups(tasks);
  // Note that every open item is kept as one that waits, whoever started its agent.
  const items = openItems(groups);

  return {
    items,
    readTasks: read.current,
    // Note that a listed plan not pushed as main says it stands is still being read.
    reading: read.pending,
    failed: read.failed,
    onRetry: read.onRetry,
  };
}
