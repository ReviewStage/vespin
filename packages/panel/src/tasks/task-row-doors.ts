/**
 * task-row-doors.ts -- the doors a task's row write reads its rows off and sends through, which ⌘Z takes a press back by.
 *
 * A rename, a task's or an agent's pin, and where a task stands are each a
 * row write (`undo-stack.ts`'s `ROW_WRITE`): a press reads the rows as they
 * stand before its act is drawn, and ⌘Z reads them again as it runs. Both
 * read the tasks the Tasks tab draws, names being typed among them, as they
 * stand at the call (`TasksControl`'s `drawnTasks`), and the plans the host
 * holds for the window, as the caller's Query client holds them.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import type { TasksView } from "@repo/features/tasks-view";
import type { ACT_KIND } from "@repo/host/acts";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { actMutation } from "../act-mutations.js";
import type { ROW_WRITE, RowDoors, TaskRows } from "../undo-stack.js";
import { appStateIn } from "../use-app-state.js";

/** The acts of the row writes read off the tasks drawn, and of the relation writes Remove relation and Remove parent take back. */
type TaskRowKind =
  | (typeof ROW_WRITE)["TASK_RENAME" | "TASK_PIN" | "AGENT_PIN" | "TASK_STANDING"]["kind"]
  | typeof ACT_KIND.TASKS_BLOCK
  | typeof ACT_KIND.TASKS_SET_PARENT;

/** The rows a task's row write reads at the call: the tasks `drawn` answers, and the plans `client` holds for the window. */
function drawnTaskRows(drawn: () => TasksView, client: QueryClient): TaskRows {
  return { tasks: drawn(), held: appStateIn(client)?.[LIVE_READ.DESCRIPTION_DOCUMENT] };
}

/**
 * The doors of `kind`'s row write: its rows read off `drawn` at each call,
 * and its writes sent on a mutation of the caller's own. Note that a
 * mutation sent after its caller is gone still reaches the act port, so ⌘Z
 * sends through it after the row's surface left.
 */
export function useTaskRowDoors<Kind extends TaskRowKind>(
  kind: Kind,
  drawn: () => TasksView,
): RowDoors<TaskRows, Kind> {
  const client = useQueryClient();
  const { mutateAsync: send } = useMutation(actMutation(kind));

  return { rows: () => drawnTaskRows(drawn, client), send };
}
