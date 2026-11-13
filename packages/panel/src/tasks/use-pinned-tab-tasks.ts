/**
 * use-pinned-tab-tasks.ts -- the tasks the window's pinned tabs stand on, asked of the host where its list holds them not.
 *
 * A tab pinned to the sidebar is kept in this window's own storage
 * (`use-side-panel.ts`'s `pins`), so the service's follow of the task list
 * knows nothing of it and keeps its task live only while the task is
 * active or recent. The sidebar draws a pin only on a task the list holds,
 * so each pinned tab's task the list holds not is asked of the host
 * (`TASKS_LOAD`), which reads it into the list as a cold task, where the pin
 * then draws it. A task is asked once while it stays out of the list, as
 * the window restores its pins or a tab is pinned, never on a draw; one the
 * list comes to hold is asked again only once the list lets it go and the
 * pins move. Nothing is read back here: the answer arrives as the list's.
 */

import type { TaskSummary } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { Collection } from "@tanstack/react-db";
import { useEffect, useRef } from "react";
import { tellAct } from "../act.js";
import type { PinHolder } from "./use-side-panel.js";

/** Asks the host for each task `pins` stand on that `tasks` holds not, once while it stays out; see the module's head. */
export function usePinnedTabTasks(
  pins: readonly PinHolder[],
  tasks: Collection<TaskSummary, string>,
): void {
  const asked = useRef(new Set<string>());

  useEffect(() => {
    for (const { task } of pins) {
      if (tasks.has(task)) {
        asked.current.delete(task);
        continue;
      }

      if (asked.current.has(task)) continue;
      asked.current.add(task);
      tellAct(ACT_KIND.TASKS_LOAD, { taskId: task });
    }
  }, [pins, tasks]);
}
