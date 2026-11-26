/**
 * use-found-task.ts -- the task a route names, by its id or by its number in the workspace its link names, found where the phone doesn't hold it, as the panel's link opens one (`@repo/panel`'s `use-tasks-tab.ts`).
 *
 * A number counts within one workspace, so one the held tasks list under
 * that workspace opens at once. Any other number is asked of the service
 * (`TASKS_FIND`), which answers the task's id or that none was found. A task
 * the list doesn't hold opens from its own description read, which
 * `useTaskOverview` follows by its id, so the screen says it's still being
 * sought until that read answers, and Task not found only after. Note that
 * the host answers a number it couldn't find and one it never reached the
 * service for alike, so a find that didn't answer a task is asked again a
 * few times, and again when the screen opens anew, rather than kept as Task
 * not found, since a phone off the network would otherwise keep a task it
 * holds out of reach until the app restarts.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LINK_DESTINATION, taskNumberOf } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { WINDOW_READ } from "@repo/host/read-window";
import { eq } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useWindow } from "../host/use-window.js";

/** The key a number's find is held under, by the account, the workspace and the number. */
const TASK_BY_NUMBER_QUERY = "task-by-number";

/** How many more times a find that answered no task is asked before the screen says Task not found. */
const FIND_RETRIES = 2;

/** Why a find answered no task: none was found, or the service was never reached. */
const FIND_UNANSWERED = "The task's number found no task.";

/** The task a route names, and whether it's still being sought. */
export interface FoundTask {
  /** The task's id, as the route named it or as the service found its number; none while sought, or where none was found. */
  readonly taskId: string | undefined;
  /** Whether the task is still being sought: its number asked of the service, or its own read not answered yet. */
  readonly seeking: boolean;
}

const NOT_FOUND: FoundTask = { taskId: undefined, seeking: false };

const SEEKING: FoundTask = { taskId: undefined, seeking: true };

/** A held task as a route's name finds it: its id, and the workspace its number counts in. */
export interface HeldTaskNamed {
  readonly id: string;
  readonly workspaceId: string;
}

/** No held task named: what a route naming none, or one the list doesn't hold, answers. */
const NONE_NAMED: readonly HeldTaskNamed[] = [];

/**
 * Whether a task's own description read hasn't answered with it or with its
 * absence, by its id. Note that a read that failed is still sought, since the
 * host reads it again, so a passing failure never says Task not found.
 */
function documentUnread(state: AppStateSnapshot, taskId: string): boolean {
  return state[LIVE_READ.HELD_TASK][taskId]?.rows === undefined;
}

/** The account signed in, whose finds are held under it; none while signed out, or for an account stored with no id. */
function selectAccountId(state: AppStateSnapshot): string | undefined {
  return signedInAccountId(state.account);
}

/**
 * The held tasks `named` names, newest first: the one with that id, or each
 * with that number, a number counting within each workspace. Note that the
 * list is read by that key alone, so a caller is drawn again only as such a
 * task comes, goes, or moves workspace, never as any other of the account's
 * tasks moves, as a working agent's turn moves its task. Note too that a
 * task named by its id, as every row's open names it, is read by that key,
 * with no query over the account's tasks, since a task page's open read it
 * three times over in the commit its push waited on.
 */
export function useHeldTasksNamed(named: string | undefined): readonly HeldTaskNamed[] {
  const { tasks } = useTaskListCollections();

  const number =
    named === undefined ? undefined : taskNumberOf({ kind: LINK_DESTINATION.TASK, taskId: named });

  const byId = useTaskListRow(tasks, number === undefined ? named : undefined);
  const byIdId = byId?.id;
  const byIdWorkspace = byId?.workspaceId;

  const heldById = useMemo(
    () =>
      byIdId === undefined || byIdWorkspace === undefined
        ? NONE_NAMED
        : [{ id: byIdId, workspaceId: byIdWorkspace }],
    [byIdId, byIdWorkspace],
  );

  const read = useWindow((q) =>
    number === undefined
      ? undefined
      : q
          .from({ task: tasks })
          .where(({ task }) => eq(task.number, number))
          .orderBy(({ task }) => task.createdAt, "desc")
          .orderBy(({ task }) => task.id, { direction: "desc", stringSort: "lexical" })
          .select(({ task }) => ({ id: task.id, workspaceId: task.workspaceId })),
  );

  // Note that only a settled read names a number's tasks, since one rebuilt for another number holds the last number's rows until it answers, and a route must never open one of those.
  const data = read.status === WINDOW_READ.ROWS && read.settled ? read.rows : NONE_NAMED;

  return number === undefined ? heldById : data;
}

/**
 * The task `named` names, by its id or its number, with `workspace` the
 * workspace a link names a number in. Note that a number with no workspace
 * is handed on as it stands, for the held list to match, as a route that
 * names one that way always has been.
 */
export function useFoundTask(named: string | undefined, workspace: string | undefined): FoundTask {
  const acts = useHostActs();
  const held = useHeldTasksNamed(named);
  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });

  const number =
    named === undefined ? undefined : taskNumberOf({ kind: LINK_DESTINATION.TASK, taskId: named });

  const home = workspace === undefined ? undefined : workspaceOfSlug(workspaces ?? [], workspace);

  const listed =
    number === undefined
      ? held[0]
      : held.find((task) => workspace === undefined || task.workspaceId === home?.id);

  const finds = number !== undefined && workspace !== undefined && listed === undefined;

  // Note that the find is held by the account too, so one account's answer never stands for another's after a switch; it never waits on the id, which an account may lack.
  const found = useQuery({
    queryKey: [TASK_BY_NUMBER_QUERY, accountId, workspace, number],
    queryFn: () =>
      acts[ACT_KIND.TASKS_FIND]({ workspace: workspace ?? "", number: number ?? 0 }).then(
        (answer) => {
          if ("failure" in answer) throw new Error(FIND_UNANSWERED);

          return answer.taskId;
        },
      ),
    enabled: finds,
    retry: FIND_RETRIES,
  });

  const taskId = listed?.id ?? (finds ? found.data : named);

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
