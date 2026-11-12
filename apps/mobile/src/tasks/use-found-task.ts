/**
 * use-found-task.ts -- the task a route names, by its id or by its number in the workspace its link names, found where the phone doesn't hold it, as the panel's link opens one (`@repo/panel`'s `use-tasks-tab.ts`).
 *
 * A number counts within one workspace, so one the held tasks list under
 * that workspace opens at once. Any other number is asked of the service
 * (`TASKS_FIND`), which answers the task's id or that none was found. A task
 * the list doesn't hold opens from its own description read, which
 * `useTaskOverview` follows by its id, so the screen says it's still being
 * sought until that read answers, and Task not found only after.
 */

import { LINK_DESTINATION, taskNumberOf } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectTasks, selectWorkspaces } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";

/** The key a number's find is held under, by the workspace and the number. */
const TASK_BY_NUMBER_QUERY = "task-by-number";

/** The task a route names, and whether it's still being sought. */
export interface FoundTask {
  /** The task's id, as the route named it or as the service found its number; none while sought, or where none was found. */
  readonly taskId: string | undefined;
  /** Whether the task is still being sought: its number asked of the service, or its own read not answered yet. */
  readonly seeking: boolean;
}

const NOT_FOUND: FoundTask = { taskId: undefined, seeking: false };

const SEEKING: FoundTask = { taskId: undefined, seeking: true };

/** Whether a task's own description read hasn't answered yet, by its id. */
function documentUnread(state: AppStateSnapshot, taskId: string): boolean {
  const held = state[LIVE_READ.DESCRIPTION_DOCUMENT][taskId];

  return held?.rows === undefined && held?.failed !== true;
}

/**
 * The task `named` names, by its id or its number, with `workspace` the
 * workspace a link names a number in. Note that a number with no workspace
 * is handed on as it stands, for the held list to match, as a route that
 * names one that way always has been.
 */
export function useFoundTask(named: string | undefined, workspace: string | undefined): FoundTask {
  const acts = useHostActs();
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  const number =
    named === undefined ? undefined : taskNumberOf({ kind: LINK_DESTINATION.TASK, planId: named });

  const home = workspace === undefined ? undefined : workspaceOfSlug(workspaces ?? [], workspace);

  const listed =
    number === undefined
      ? view?.tasks.find((task) => task.id === named)
      : view?.tasks.find(
          (task) =>
            task.number === number && (workspace === undefined || task.workspaceId === home?.id),
        );

  const finds = number !== undefined && workspace !== undefined && listed === undefined;

  const found = useQuery({
    queryKey: [TASK_BY_NUMBER_QUERY, workspace, number],
    queryFn: () => acts[ACT_KIND.TASKS_FIND]({ workspace: workspace ?? "", number: number ?? 0 }),
    enabled: finds,
    retry: false,
  });

  const taskId =
    listed?.id ??
    (finds
      ? found.data !== undefined && "taskId" in found.data
        ? found.data.taskId
        : undefined
      : named);

  // Note that a task the list doesn't hold, named by its id or found by its number, opens from its own read, which is sought until it answers.
  const unlisted = listed === undefined && taskId !== undefined && (number === undefined || finds);

  const { data: unread } = useQuery({
    ...appStateQuery,
    select: (state) => (unlisted && taskId !== undefined ? documentUnread(state, taskId) : false),
  });

  if (named === undefined) return NOT_FOUND;

  if (finds && found.isPending) return SEEKING;

  return { taskId, seeking: unread === true };
}
