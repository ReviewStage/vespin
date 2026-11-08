/**
 * routed-doors.ts -- the doors into and out of the Board and a person's page, each its route's move held by the window's leave guard.
 *
 * A routed place's open and close are its route's moves (`workspace-routes.ts`)
 * made through the window's leave guard (`PlaceLeave.arrive`): a move to the
 * place already standing, which navigates nowhere, still asks while a page
 * holds unsaved work, as a move away would, and a close, which the window's
 * history writes past the router's blocker, asks up front. Any surface calls
 * one with the Tasks tab's guard and the workspace it lists, and nothing else
 * threaded through. Opening a person's page lists their workspace first,
 * which only the Tasks tab can, so that door is the tab's (`onOpenPerson`).
 */

import type { Workspace } from "@repo/features/workspace-wire";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useBoardRoute, usePersonRoute } from "../workspace-routes.js";

/** A way of landing that does nothing more than the move. */
const NOTHING = (): void => undefined;

/** The step a workspace's address names it by: its slug, or its id where an older service answered none. */
function stepOf(workspace: Pick<Workspace, "id" | "slug">): string {
  return workspace.slug ?? workspace.id;
}

/** The listed workspace's Board: the presses that open and leave it, and its read ahead of a press. */
export interface BoardDoor {
  /** Opens the listed workspace's Board; nothing while none is listed. */
  readonly open: () => void;
  readonly close: () => void;
  /** Reads the Board ahead of a press the pointer says is coming. */
  readonly preload: () => void;
}

/** The Board's doors, under the listed workspace as the tab stands. */
export function useBoardDoor(tasks: Pick<TasksControl, "placeLeave" | "workspace">): BoardDoor {
  const route = useBoardRoute();
  const { placeLeave, workspace } = tasks;
  return {
    open: () =>
      placeLeave.arrive(() => {
        if (workspace !== undefined) route.onOpen(stepOf(workspace));
      }, NOTHING),
    close: () => placeLeave.arrive(NOTHING, route.onClose),
    preload: () => {
      if (workspace !== undefined) route.onPreload(stepOf(workspace));
    },
  };
}

/** A person's page: the press that leaves it, and its read ahead of a press. */
export interface PersonDoor {
  readonly close: () => void;
  /** Reads their page ahead of a press the pointer says is coming, in `workspaceId`, or the listed workspace where none is named. */
  readonly preload: (userId: string, workspaceId?: string) => void;
}

/** A person's page's doors, the listed workspace as the tab stands its home where a press names none. */
export function usePersonDoor(
  tasks: Pick<TasksControl, "placeLeave" | "workspace" | "workspaces">,
): PersonDoor {
  const route = usePersonRoute();
  const { placeLeave, workspace, workspaces } = tasks;
  return {
    close: () => placeLeave.arrive(NOTHING, route.onClose),
    preload: (userId, workspaceId) => {
      const home = workspaces.find((each) => each.id === workspaceId) ?? workspace;
      if (home !== undefined) route.onPreload(userId, stepOf(home));
    },
  };
}
