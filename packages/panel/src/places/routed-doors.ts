/**
 * routed-doors.ts -- the doors into and out of the Board, a person's page, Admin, and the Automations pages, each its route's move held by the window's leave guard.
 *
 * A routed place's open and close are its route's moves (`workspace-routes.ts`,
 * `admin/admin-route.ts`, `automations-route.ts`)
 * made through the window's leave guard (`PlaceLeave.arrive`): a move to the
 * place already standing, which navigates nowhere, still asks while a page
 * holds unsaved work, as a move away would, and a close, which the window's
 * history writes past the router's blocker, asks up front. Any surface calls
 * one with the Tasks tab's guard and the workspace it lists, and nothing else
 * threaded through. Opening a person's page lists their workspace first,
 * which only the Tasks tab can, so that door is the tab's (`onOpenPerson`).
 * Admin's close and read ahead are its route's own, unasked, as they have
 * always been.
 */

import type { Workspace } from "@repo/features/workspace-wire";
import { useAdminRoute } from "../admin/admin-route.js";
import type { AdminView } from "../admin/routing.js";
import { useAutomationsRoute } from "../automations-route.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
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

/** Admin: the presses that open and leave it, and its read ahead of a press. */
export interface AdminDoor {
  /** Opens the place on `view`, on the Overview where none is named, under the workspace it stands in, else the listed one. */
  readonly open: (view?: AdminView) => void;
  readonly close: () => void;
  /** Reads the place ahead of a press the pointer says is coming, its chunk, charts and all. */
  readonly preload: () => void;
}

/** Admin's doors, under the listed workspace as the tab stands. */
export function useAdminDoor(tasks: Pick<TasksControl, "placeLeave" | "workspace">): AdminDoor {
  const { placeLeave, workspace } = tasks;
  const route = useAdminRoute({
    listedSlug: () => (workspace === undefined ? undefined : stepOf(workspace)),
  });
  return {
    open: (view) => placeLeave.arrive(() => route.onOpen(view), NOTHING),
    close: route.onClose,
    preload: route.onPreload,
  };
}

/** The Automations pages: the presses that open and leave them. */
export interface AutomationsDoor {
  /** Opens the page asked for, the list where none is, under the listed workspace; nothing while none is listed. */
  readonly open: (place?: AutomationsPlace) => void;
  readonly close: () => void;
}

/** The Automations pages' doors, under the listed workspace as the tab stands. */
export function useAutomationsDoor(
  tasks: Pick<TasksControl, "placeLeave" | "workspace">,
): AutomationsDoor {
  // Note that the room reaches only the pages' runs, which no door here turns (`TasksControl.onAutomationRuns`).
  const route = useAutomationsRoute({ narrow: false });
  const { placeLeave, workspace } = tasks;
  return {
    open: (place = { kind: AUTOMATIONS_PAGE.LIST }) =>
      placeLeave.arrive(() => {
        if (workspace !== undefined) route.onOpen(place, stepOf(workspace));
      }, NOTHING),
    close: () => placeLeave.arrive(NOTHING, route.onClose),
  };
}
