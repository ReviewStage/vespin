/**
 * use-sub-task-reads.ts -- a list showing finished sub-tasks, asking the host for those a parent's count names that the list does not hold.
 *
 * The host keeps only some of the account's tasks live, so a parent's
 * finished sub-tasks may stand outside the list while its row's count, the
 * service's (`TaskSummary.subTasks`), names them. While the list shows
 * finished sub-tasks, each such parent's children are asked of the host
 * once through its relations (`TASKS_RELATIONS_READ`), which reads its
 * sub-tasks among them and draws each the list holds not into it as a cold
 * task, under its parent as any. Nothing is read back
 * here: the answer arrives as the list's, and a parent whose children the
 * list then holds is asked no more.
 */

import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useRef } from "react";
import { tellAct } from "../act.js";

/** Asks the host once for the children of each of `parents` while `asked`; see the module's head. */
export function useSubTaskReads(parents: readonly string[], asked: boolean): void {
  // The parents asked for already, which a later delivery naming them again asks nothing of.
  const askedFor = useRef(new Set<string>());

  useEffect(() => {
    if (!asked) return;

    for (const taskId of parents) {
      if (askedFor.current.has(taskId)) continue;
      askedFor.current.add(taskId);
      tellAct(ACT_KIND.TASKS_RELATIONS_READ, { taskId });
    }
  }, [asked, parents]);
}
