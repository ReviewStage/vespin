/**
 * use-pinned-tab-tasks.ts -- the tasks the window's pinned tabs stand on, asked of the host where its list holds them not.
 *
 * A tab pinned to the sidebar is kept in this window's own storage
 * (`use-side-panel.ts`'s `pins`), so the service's follow of the task list
 * knows nothing of it and keeps its task live only while the task is
 * active or recent. The sidebar draws a pin only on a task the list holds,
 * so each pinned tab's task the list holds not is asked of the host
 * (`TASKS_LOAD`), which reads it into the list as a cold task, where the pin
 * then draws it. A task is asked as the window restores its pins or a tab is
 * pinned, and again as the list lets it go, never on a draw; the host reads
 * nothing for a task its list holds or is reading already. Nothing is read
 * back here: the answer arrives as the list's.
 */

import type { TaskSummary } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { Collection } from "@tanstack/react-db";
import { useEffect, useRef } from "react";
import { tellAct } from "../act.js";
import type { PinHolder } from "./use-side-panel.js";

/** Asks the host to read the task `id` names into its list. */
function load(id: string): void {
  tellAct(ACT_KIND.TASKS_LOAD, { taskId: id });
}

/** Asks the host for each task `pins` stand on that `tasks` holds not, as the pins move and as the list lets one go; see the module's head. */
export function usePinnedTabTasks(
  pins: readonly PinHolder[],
  tasks: Collection<TaskSummary, string>,
): void {
  const pinned = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    pinned.current = new Set(pins.map((pin) => pin.task));

    for (const id of pinned.current) if (!tasks.has(id)) load(id);
  }, [pins, tasks]);

  // Note that a pinned task the list lets go, as the live set leaves an old one out, is asked again, so its pin stands.
  useEffect(() => {
    const subscription = tasks.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === "delete" && pinned.current.has(change.key)) load(change.key);
      }
    });

    return () => subscription.unsubscribe();
  }, [tasks]);
}
