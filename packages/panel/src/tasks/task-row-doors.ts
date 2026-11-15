/**
 * task-row-doors.ts -- the doors a task's row write reads its rows off and sends through, which ⌘Z takes a press back by.
 *
 * A rename, a task's or an agent's pin, and where a task stands are each a
 * row write (`undo-stack.ts`'s `ROW_WRITE`): a press reads the rows as they
 * stand before its act is drawn, and ⌘Z reads them again as it runs. Both
 * read the task list's rows by id off the window's collections, names being
 * typed drawn over them as they stand at the call, what the list carries
 * beside its rows off the document, and the plans the host holds for the
 * window, as the caller's Query client holds them. Nothing here is drawn
 * from the rows, so a door follows no row: it reads them only as it is
 * called.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import { renamedTask, type TaskNames } from "@repo/features/tasks-model";
import type { ACT_KIND } from "@repo/host/acts";
import type { TaskListCollections } from "@repo/host/task-list-following";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { actMutation } from "../act-mutations.js";
import { useTaskListCollections } from "../task-list-collections.js";
import type { ROW_WRITE, RowDoors, TaskRows } from "../undo-stack.js";
import { appStateIn, selectListedTasks } from "../use-app-state.js";

/** The acts of the row writes read off the task list, and of the relation writes Remove relation and Remove parent take back. */
type TaskRowKind =
  | (typeof ROW_WRITE)["TASK_RENAME" | "TASK_PIN" | "AGENT_PIN" | "TASK_STANDING"]["kind"]
  | typeof ACT_KIND.TASKS_BLOCK
  | typeof ACT_KIND.TASKS_SET_PARENT;

/** No name typed: what a write whose rows read no name draws over them. */
const NO_NAMES_TYPED: TaskNames = new Map();

/** The names typed for a write whose rows read no name. */
const NONE_TYPED = (): TaskNames => NO_NAMES_TYPED;

/** The rows a task's row write reads at the call: `collections`' rows, each name drawn as `typedNames` types it, and what the list carries beside them, as `client` holds the document. */
function taskRowsNow(
  collections: TaskListCollections,
  client: QueryClient,
  typedNames: TaskNames,
): TaskRows {
  const state = appStateIn(client);
  const listed = state === undefined ? undefined : selectListedTasks(state);

  return {
    listed: (taskId) => {
      const row = collections.tasks.get(taskId);

      return row === undefined ? undefined : renamedTask(row, typedNames);
    },
    // Note that the collection holds no agent until the list says its lists are drawn, which tells a list of none from none read yet.
    agents: () => (listed?.listed === true ? collections.agents.toArray : undefined),
    agentPins: listed?.taskAgentPins ?? [],
    activeTaskId: listed?.activeTaskId,
    held: state?.[LIVE_READ.HELD_TASK],
  };
}

/**
 * The doors of `kind`'s row write: its rows read at each call, each name
 * drawn as `typedNames` answers it then, and its writes sent on a mutation
 * of the caller's own. Note that a mutation sent after its
 * caller is gone still reaches the act port, so ⌘Z sends through it after
 * the row's surface left.
 */
export function useTaskRowDoors<Kind extends TaskRowKind>(
  kind: Kind,
  typedNames: () => TaskNames = NONE_TYPED,
): RowDoors<TaskRows, Kind> {
  const client = useQueryClient();
  const collections = useTaskListCollections();
  const { mutateAsync: send } = useMutation(actMutation(kind));

  return { rows: () => taskRowsNow(collections, client, typedNames()), send };
}
