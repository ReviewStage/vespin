/**
 * sidebar-entries.tsx -- a sidebar list whose rows are of more than one kind in one order: its own rows (a task's, a pinned tab's) and Managers, each drawn in the list's run as its kind draws it, so a drag moves any of them among the rest.
 *
 * Every list of the sidebar's rows is a run (`SidebarRun`) whose rows a drag
 * hears by their place among them all (`use-row-drag.ts`), so a Manager
 * stands in one as one more row: drawn as the Managers section draws it
 * (`SidebarManagerRow`), dragged, and moved by Move up and Move down, as
 * the rows beside it are. The list keeps its rows as entries, each its own
 * row or a Manager, in the order it stores them, and draws each through
 * `SidebarEntryRow`, handing it how its own rows are drawn. Pinned mixes its
 * pins with the Managers the reader pinned this way, in the one pin order
 * (`pin-order.ts`); a custom section mixes its tasks with the Managers kept
 * in it the same way.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import type { ListRowNest } from "@repo/ui";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import type { ReactNode } from "react";
import { SidebarManagerRow } from "./sidebar-managers.js";
import type { SidebarTasksControl } from "./sidebar-open.js";

/** What kind of row an entry is: the list's own, or a Manager. */
export const SIDEBAR_ENTRY = {
  OWN: "own",
  MANAGER: "manager",
} as const;

/** One row of a list that mixes Managers among its own rows (`Own`). */
export type SidebarEntry<Own> =
  | { readonly kind: typeof SIDEBAR_ENTRY.OWN; readonly own: Own }
  | { readonly kind: typeof SIDEBAR_ENTRY.MANAGER; readonly agent: ListedAgent };

/** The list's own row an entry is; none for a Manager. */
export function ownOf<Own>(entry: SidebarEntry<Own>): Own | undefined {
  return entry.kind === SIDEBAR_ENTRY.OWN ? entry.own : undefined;
}

/**
 * One entry of a mixed list, in the list's run: its own row as `own` draws
 * it, or a Manager's row, opening its page, at the same place and nest.
 */
export function SidebarEntryRow<Own>({
  entry,
  own,
  tasks,
  shown,
  place,
  nest,
  onOpenManager,
}: {
  entry: SidebarEntry<Own>;
  /** Draws the list's own row. */
  own: (own: Own) => ReactNode;
  tasks: SidebarTasksControl;
  /** Whether the list is in sight, which a Manager's menu asks on. */
  shown: boolean;
  place: VirtualRowPlace;
  nest: ListRowNest | undefined;
  onOpenManager: (agentId: string) => void;
}): ReactNode {
  if (entry.kind === SIDEBAR_ENTRY.OWN) return own(entry.own);

  // Note that the row stands in the run bare, wrapped in nothing, because the run counts its rows as its own items; the row masks its name itself.
  return (
    <SidebarManagerRow
      agent={entry.agent}
      tasks={tasks}
      shown={shown}
      place={place}
      nest={nest}
      onOpen={onOpenManager}
    />
  );
}
