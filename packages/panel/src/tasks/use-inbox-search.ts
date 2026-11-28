/**
 * use-inbox-search.ts -- the listed workspace's Inbox as ⌘K searches it: every item of every standing task holding one, and of every agent on no task holding one, a Manager's, read only while a search asks for them.
 *
 * The palette reads the same followed inboxes the window's Inbox lists
 * (`use-holder-inbox-items.ts`), so an item found
 * is the item the Inbox opens. Note that nothing is followed until a search
 * asks, because most uses of the palette never look in the Inbox, and that
 * the items pushed are kept once it stops asking, so the next search shows
 * them at once while their follows come back. The words are asked of the
 * service too, as a search across everything (`INBOX_SEARCH_PLACE.EVERYTHING`,
 * `use-inbox-service-search.ts`), and the items it finds past what the host
 * holds join the items searched, in the listed workspace as every item is,
 * each the host holds itself searched as it holds it.
 */

import { type InboxRow, inboxReadRows } from "@repo/features/inbox-digest";
import {
  type InboxAnyHolder,
  type InboxGroup,
  type InboxListed,
  inboxGroups,
  inboxSearchWordsOf,
  needsYou,
} from "@repo/features/inbox-list-model";
import { INBOX_SEARCH_PLACE } from "@repo/features/inbox-service-search";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import type { AppInboxTaskHolding } from "@repo/host/app-state";
import { inboxHoldingsWithOlder } from "@repo/host/app-state-reads";
import { useMemo } from "react";
import { useTaskListRows } from "../task-list-collections.js";
import { wholeInboxItems } from "./inbox-whole-items.js";
import { NO_HOLDINGS, taskHoldings, useHolderInboxItems } from "./use-holder-inbox-items.js";
import { useInboxServiceSearch } from "./use-inbox-service-search.js";
import { useListedInbox } from "./use-inbox-slices.js";
import { useTasklessInboxGroups } from "./use-taskless-inbox-groups.js";
import type { TasksControl } from "./use-tasks-tab.js";

/** What a search finds in the Inbox: its items, what needs the reader first, then the latest changed; and how far their read has come. */
export interface InboxSearch {
  readonly items: readonly InboxListed<InboxAnyHolder>[];
  /** Every line of words each item's row says, read from the whole item (`inboxSearchWordsOf`). */
  readonly wordsOf: (row: InboxRow) => readonly string[];
  /** Whether an inbox the search asked for has not been pushed yet, or the service's answer to the words is still to come. */
  readonly reading: boolean;
  /** Whether an inbox the search asked for could not be read. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** Every item the groups hold, the reader's waiting ones first, then the latest changed first. */
function searchOrder(
  groups: readonly InboxGroup<InboxAnyHolder>[],
  readerId: string | undefined,
): InboxListed<InboxAnyHolder>[] {
  const listed = groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));

  return listed.toSorted(
    (first, second) =>
      Number(needsYou(second, readerId)) - Number(needsYou(first, readerId)) ||
      second.item.updatedAt - first.item.updatedAt,
  );
}

/** No task held: what a search that does not ask follows. */
const NO_HELD = {
  held: [],
  listed: [],
} satisfies { held: readonly AppInboxTaskHolding[]; listed: readonly TaskSummary[] };

/** No agent's items, as the taskless groups lay the found ones beside the feed's themselves (`use-taskless-inbox-groups.ts`). */
const NO_AGENTS: Readonly<Record<string, readonly InboxItem[]>> = {};

/** No task kept beside the Inbox, which only the phone's kept rows name. */
const NO_TASKS: readonly TaskSummary[] = [];

/** The listed workspace's Inbox, followed while `asked`, and what the service finds by `query` past it; see the module's head. */
export function useInboxSearch(tasks: TasksControl, asked: boolean, query: string): InboxSearch {
  const { inboxTasks } = useListedInbox(tasks);
  // Note that only the tasks holding items are read, each by its id, so a task holding none moving, as each turn of its agents does, draws nothing here, nor the palette that stands drawn while shut (`useListedInboxGroups`).
  const holderRows = useTaskListRows(tasks.typedNames);
  const workspaceId = tasks.workspace?.id;

  // Note that nothing is followed while no search asks.
  const { held, listed } = useMemo(() => {
    if (!asked) return NO_HELD;

    const found = inboxTasks.flatMap((holding) => {
      const task = holderRows.task(holding.taskId);

      return task === undefined || (workspaceId !== undefined && task.workspaceId !== workspaceId)
        ? []
        : [{ holding, task }];
    });

    return { held: found.map(({ holding }) => holding), listed: found.map(({ task }) => task) };
  }, [asked, inboxTasks, holderRows, workspaceId]);

  const holdings = useMemo(() => (asked ? taskHoldings(held) : NO_HOLDINGS), [asked, held]);
  const read = useHolderInboxItems(holdings);
  const service = useInboxServiceSearch(INBOX_SEARCH_PLACE.EVERYTHING, query, asked);
  const found = asked ? service.found : undefined;

  // Note that a thread on no task is searched as a task's is, from the account's feed the Inbox lists it from, with those the service found beside it.
  const { listed: taskless, listedWhole: tasklessWhole } = useTasklessInboxGroups(
    workspaceId,
    tasks.agentsCarried,
    tasks.agents.models,
    found,
  );

  // Note that the items found are laid beside the reads, an item a read holds its own alone, so what the palette holds is searched as it holds it.
  const withFound = useMemo(
    () =>
      found === undefined
        ? undefined
        : inboxHoldingsWithOlder(
            { read: read.items, tasks: held, agents: NO_AGENTS, keptHolders: NO_TASKS },
            found,
          ),
    [found, read.items, held],
  );

  const wordsOf = useMemo(() => {
    const whole = wholeInboxItems(withFound?.read ?? read.items, tasklessWhole);

    return inboxSearchWordsOf((itemId) => whole.get(itemId));
  }, [withFound, read.items, tasklessWhole]);

  const items = useMemo(() => {
    if (!asked) return searchOrder([], tasks.me);

    // Note that the found items are the account's, every workspace's, so a task of another workspace than the one listed groups none, as the held ones are listed.
    const foundListed = (withFound?.tasks ?? []).flatMap(({ taskId }) => {
      const task = holderRows.task(taskId);

      return task === undefined || (workspaceId !== undefined && task.workspaceId !== workspaceId)
        ? []
        : [task];
    });

    const onTasks =
      withFound === undefined
        ? inboxGroups(inboxReadRows(read.items), { tasks: held, listed })
        : inboxGroups(inboxReadRows(withFound.read), {
            tasks: withFound.tasks,
            listed: foundListed,
          });

    const groups: readonly InboxGroup<InboxAnyHolder>[] = [...onTasks, ...taskless];

    return searchOrder(groups, tasks.me);
  }, [asked, held, listed, read.items, withFound, holderRows, workspaceId, taskless, tasks.me]);

  // Note that an inbox counts as read only once its push holds what main says it now holds, since an older push kept from the last search may lack the item sought; and the service's answer to the words is waited on too, so nothing is said to match none before it lands.
  const reading = read.pending || service.searching;
  const { onRetry } = read;

  return { items, wordsOf, reading, failed: read.failed, onRetry };
}
