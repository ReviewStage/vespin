import {
  type InboxAnyHolder,
  type InboxGroup,
  type InboxListed,
  inboxGroups,
  openItems,
} from "@repo/features/inbox-list-model";
import { useMemo } from "react";
import { useTaskListRows } from "../task-list-collections.js";
import {
  type HolderInboxItems,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import { useListedInbox } from "./use-inbox-slices.js";
import { useTasklessInboxGroups } from "./use-taskless-inbox-groups.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * use-waiting-items.ts -- every open Inbox item of the listed workspace, a teammate's agent's among them, as Home and a person's page list what waits.
 *
 * Main's read of the account counts only what waits on its own agents, so
 * a place that lists what waits as the window's Inbox does follows each plan
 * holding an item whole, as the Inbox follows them. Every open item is listed, whoever
 * it waits on, since a person's page lists what waits on them; Home keeps only the reader's own
 * (`needsReader`). A thread on no task, a Manager's, waits as a task's does,
 * listed beside them as the Inbox lists it (`use-taskless-inbox-groups.ts`).
 * The sidebar's Inbox row counts the same groups under the Inbox's view
 * (`places-waiting.ts`).
 */

/** What waits, the latest changed first; whether a read is still out or did not answer; and Retry. */
export interface WaitingItems {
  readonly items: readonly InboxListed<InboxAnyHolder>[];
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
export function useListedInboxGroups(
  tasks: Pick<TasksControl, "workspace" | "typedNames">,
): UseListedInboxGroupsResult {
  const { inboxTasks } = useListedInbox(tasks);
  // Note that only the plans holding items are read, each by its id with its name as it is being typed, so a plan that holds none moving, as each turn of its agents does, groups nothing again, nor draws the sidebar counting them (`useInboxViewCount`).
  const holderRows = useTaskListRows(tasks.typedNames);
  const workspaceId = tasks.workspace?.id;

  // Note that every plan holding an item is read, not only those main counts as waiting on the
  // account, because those are its own agents' alone, and the Inbox lists every member's.
  const { holdings, listed } = useMemo(() => {
    const held = inboxTasks.flatMap((holding) => {
      const task = holderRows.task(holding.taskId);

      return task === undefined || (workspaceId !== undefined && task.workspaceId !== workspaceId)
        ? []
        : [{ holding, task }];
    });

    return { holdings: held.map(({ holding }) => holding), listed: held.map(({ task }) => task) };
  }, [inboxTasks, holderRows, workspaceId]);

  const read = useHolderInboxItems(useMemo(() => taskHoldings(holdings), [holdings]));

  // Note that the groups stand while their reads do, so a place counting them counts again only as they move.
  const groups = useMemo(
    () => inboxGroups(read.items, { tasks: holdings, listed }),
    [read.items, holdings, listed],
  );

  return { groups, read };
}

/** Every open Inbox item of the listed workspace's plans and of its agents on no task, the latest changed first, read as the window's Inbox reads them (`useListedInboxGroups`, `useTasklessInboxGroups`). */
export function useWaitingItems(tasks: TasksControl): WaitingItems {
  const { groups, read } = useListedInboxGroups(tasks);

  const { groups: taskless } = useTasklessInboxGroups(
    tasks.workspace?.id,
    tasks.agentsCarried,
    tasks.agents.models,
  );

  // Note that every open item is kept as one that waits, whoever started its agent, and stands while the groups do.
  const items = useMemo(() => {
    const held: readonly InboxGroup<InboxAnyHolder>[] = [...groups, ...taskless];

    return openItems(held);
  }, [groups, taskless]);

  return {
    items,
    readTasks: read.current,
    // Note that a listed plan not pushed as main says it stands is still being read.
    reading: read.pending,
    failed: read.failed,
    onRetry: read.onRetry,
  };
}
