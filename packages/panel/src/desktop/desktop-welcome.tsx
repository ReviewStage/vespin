import { eq, useLiveQuery } from "@tanstack/react-db";
import { type RefObject, useEffect, useRef } from "react";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { useTaskListCollections } from "../task-list-collections.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-welcome.tsx -- whether an account is new: signed in, its task list read, and nothing of its own yet, which setup's steps and Home's setup sections are for; and the hook that hands Home's composer the caret on New task.
 */

/** Hands the focus back to the page from whatever holds it, as Escape from an agent's box does. */
export function letGoOfFocus(): void {
  const active = document.activeElement;

  if (active instanceof HTMLElement) active.blur();
}

/**
 * Hands the words of the composer under `box` the caret each time New task
 * is pressed while it stands (`newTask.homeAsks`); its first draw is
 * `takesFocus`'s to decide, so a count raised before it showed asks nothing.
 */
export function useHomeNewTask(box: RefObject<HTMLElement | null>, asks: number): void {
  const seen = useRef(asks);
  useEffect(() => {
    if (asks === seen.current) return;
    seen.current = asks;
    box.current?.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR)?.focus();
  }, [box, asks]);
}

/**
 * Whether the task list holds a task in the workspace named, or in any while
 * none is: one live query over the task collection (`findOne`), which
 * selects the id alone, so a delivery moving a task, the one found among
 * them, draws the reader again only where the answer moves.
 */
export function useListsTask(workspaceId: string | undefined): boolean {
  const { tasks } = useTaskListCollections();

  return (
    useLiveQuery({
      query: (q) => {
        const every = q.from({ task: tasks });

        return (
          workspaceId === undefined
            ? every
            : every.where(({ task }) => eq(task.workspaceId, workspaceId))
        )
          .select(({ task }) => ({ id: task.id }))
          .findOne();
      },
    }).data !== undefined
  );
}

/**
 * Whether the account has ever had a task in the workspace named, or in any
 * while none is: whether the list holds one (`listed`, `useListsTask`), else
 * the service's word where it has said (`TasksControl.taskWorkspaces`),
 * since the list may hold none of a workspace's old and finished tasks.
 */
export function hadTasks(
  tasks: Pick<TasksControl, "taskWorkspaces">,
  workspaceId: string | undefined,
  listed: boolean,
): boolean {
  const said = tasks.taskWorkspaces;

  if (listed || said === undefined) return listed;

  return workspaceId === undefined ? said.length > 0 : said.includes(workspaceId);
}

/** Whether the welcome stands: an account signed in whose task list landed, never having had a task in any workspace, `listed` saying whether the list holds any (`useListsTask`). */
export function welcomed(
  tasks: Pick<TasksControl, "signedIn" | "listRead" | "taskWorkspaces">,
  listed: boolean,
): boolean {
  return tasks.signedIn && tasks.listRead && !hadTasks(tasks, undefined, listed);
}
