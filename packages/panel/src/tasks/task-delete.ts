/**
 * task-delete.ts -- a task's delete, and several at once, as each place asking it holds its own mutation over it.
 */

import { DELETE_FAILED_NOTE } from "@repo/features/tasks-model";
import { ACT_KIND } from "@repo/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useQuery } from "@tanstack/react-query";
import { type ActedResult, askKept, sendAct } from "../act.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";

/** What a delete the service did not carry answers, so the task stays and says why. */
const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: DELETE_FAILED_NOTE,
};

/** A task's delete as each place asking it holds its own mutation over it, run through `run`, answering whether it was deleted. */
function taskDeleteMutation(run: (taskId: string) => Promise<ActedResult>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TASKS_DELETE], mutationFn: run });
}

/** Several tasks deleted at once, as a selection's question holds its own mutation over them, each through `run`, answering each in the order asked. */
function tasksDeleteMutation(run: (taskId: string) => Promise<ActedResult>) {
  return mutationOptions({
    mutationKey: [ACT_KIND.TASKS_DELETE],
    mutationFn: (taskIds: readonly string[]) => Promise.all(taskIds.map(run)),
  });
}

/**
 * Sends a task's delete. A fixture's tasks are deleted nowhere, as they are
 * read from nowhere. A delete that landed says nothing, since the task
 * leaving the list says it; a refusal is said where the question that asked
 * it stands, or in a toast where the task leaving took it away
 * (`use-refusal-heard.ts`).
 */
function useDeleteSend(): (taskId: string) => Promise<ActedResult> {
  const fixture = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;

  return async (taskId) => {
    if (fixture) return DELETE_REFUSED;
    const deleted = await askKept(sendAct(ACT_KIND.TASKS_DELETE, { taskId }));

    if (deleted.kept) return { status: ACTION_RESULT_STATUS.ACCEPTED };

    return { ...DELETE_REFUSED, cause: deleted.cause };
  };
}

/** A task's delete, as a place asking it holds it (`taskDeleteMutation`). */
export function useTaskDelete() {
  return taskDeleteMutation(useDeleteSend());
}

/** Several tasks deleted at once, as a selection's question holds it. */
export function useTasksDelete() {
  return tasksDeleteMutation(useDeleteSend());
}
