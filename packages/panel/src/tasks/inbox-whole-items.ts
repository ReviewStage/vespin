/**
 * inbox-whole-items.ts -- the whole Inbox items a surface's reads hold, by id, for what draws or searches a thread rather than its row.
 *
 * The Inbox lists rows (`@repo/features/inbox-digest`'s `InboxRow`), which
 * carry no thread; what draws the thread itself, the pane, its answer box,
 * and a search through everything said, finds the item by the row's id in
 * the reads the surface grouped its rows from.
 */

import type { InboxItemReads } from "@repo/features/inbox-digest";
import type { InboxItem } from "@repo/features/inbox-wire";

/** Every item the reads hold, by its id: each task's, then each agent's on no task. */
export function wholeInboxItems(
  onTasks: InboxItemReads,
  onAgents: Readonly<Record<string, readonly InboxItem[]>> | undefined,
): ReadonlyMap<string, InboxItem> {
  const byId = new Map<string, InboxItem>();

  for (const items of onTasks.values()) for (const item of items) byId.set(item.id, item);

  for (const items of Object.values(onAgents ?? {}))
    for (const item of items) byId.set(item.id, item);

  return byId;
}
