/**
 * routed-doors.ts -- the doors into and out of the Board, a person's page, Admin, the Automations pages, and the Inbox, each its route's move held by the window's leave guard.
 *
 * A routed place's open and close are its route's moves (`workspace-routes.ts`,
 * `admin/admin-route.ts`, `automations-route.ts`, `inbox-route.ts`)
 * made through the window's leave guard (`PlaceLeave.arrive`): a move to the
 * place already standing, which navigates nowhere, still asks while a page
 * holds unsaved work, as a move away would, and a close, which the window's
 * history writes past the router's blocker, asks up front. Any surface calls
 * one with the Tasks tab's guard and the workspace it lists, and nothing else
 * threaded through. Opening a person's page lists their workspace first,
 * which only the Tasks tab can, so that door is the tab's (`onOpenPerson`).
 * Admin's close and read ahead are its route's own, unasked, as they have
 * always been, and so are the moves within the Inbox standing: choosing a
 * row's item and widening its list. Going back to the Inbox's list from its
 * item is the tab's (`TasksControl.inboxView.onClear`), so the window's
 * history can take that way back (`navigation-history.ts`'s `throughHistory`).
 */

import type { Workspace } from "@repo/features/workspace-wire";
import { useAdminRoute } from "../admin/admin-route.js";
import type { AdminView } from "../admin/routing.js";
import { useAutomationsRoute } from "../automations-route.js";
import { type InboxAt, useInboxRoute } from "../inbox-route.js";
import { beginPanelSpan, PANEL_SPAN } from "../panel-spans.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
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

/** The window's Inbox: the presses that open it, choose in it, widen its list, and leave it. */
export interface InboxDoor {
  /** Opens the Inbox on nothing chosen, every task's items listed. */
  readonly open: () => void;
  /** Opens the Inbox on `chosen`, from wherever the window stands, keeping the narrowing of the Inbox standing for an item of the task it is narrowed to. */
  readonly openItem: (chosen: InboxChoice) => void;
  /** Chooses `chosen` in the Inbox standing, as a row's press does. */
  readonly choose: (chosen: InboxChoice) => void;
  /** Lists every task's items again, where the list is narrowed to one. */
  readonly widen: () => void;
}

/** The Inbox's doors, under the listed workspace as the tab stands. */
export function useInboxDoor(tasks: Pick<TasksControl, "placeLeave" | "workspace">): InboxDoor {
  const route = useInboxRoute();
  const { placeLeave, workspace } = tasks;
  const { open: standing, narrowed } = route;
  // Note that it opens on nothing chosen, so one column shows the list and two an empty pane beside it (`inbox-columns.ts`),
  // and that where the item chosen stands is held once the move lands, so a move kept at a page's leave ask holds nothing.
  const stand = (keepNarrowing: boolean, chosen: InboxChoice | undefined) => {
    if (workspace === undefined) return;
    const at: InboxAt = {
      workspace: stepOf(workspace),
      narrowed: keepNarrowing ? narrowed : undefined,
    };
    placeLeave.arrive(
      () => {
        if (chosen === undefined) route.onOpen(at);
        else route.onGoTo(chosen, at);
      },
      () => {
        // Note that the Inbox already open has no opening to time.
        if (!standing) beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
        if (chosen !== undefined) route.onHold(chosen);
      },
    );
  };
  return {
    open: () => stand(false, undefined),
    openItem: (chosen) => stand(true, chosen),
    choose: (chosen) => route.onChoose(chosen),
    widen: route.onWiden,
  };
}
