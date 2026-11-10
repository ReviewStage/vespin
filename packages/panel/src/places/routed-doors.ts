/**
 * routed-doors.ts -- the doors into and out of the Board, a person's page, Admin, the Automations pages, the Inbox, and a version history, each its route's move held by the window's leave guard.
 *
 * A routed place's open and close are its route's moves (`workspace-routes.ts`,
 * `admin/admin-route.ts`, `automations-route.ts`, `inbox-route.ts`)
 * made through the window's leave guard (`PlaceLeave.arrive`): a move to the
 * place already standing, which navigates nowhere, still asks while a page
 * holds unsaved work, as a move away would, and a close is the router's move
 * to the place the window's state says (`routed-exits.ts`'s `leave`), which
 * the router's blocker holds as it holds an open. Any surface calls
 * one with the Tasks tab's guard and the workspace it lists, and nothing else
 * threaded through. Opening a person's page lists their workspace first,
 * which only the Tasks tab can, so that door is the tab's (`onOpenPerson`).
 * Admin's close and read ahead are its route's own, unasked, as they have
 * always been, and so are the moves within the Inbox standing: choosing a
 * row's item and widening its list. Going back to the Inbox's list from its
 * item is the tab's (`TasksControl.inboxView.onClear`), which takes the
 * Inbox's way back through the window's history (`narrow-backs.ts`).
 * A version history's close and read ahead are its route's own, unasked, as
 * they have always been; opening one opens its task under it and seeks the
 * version a save made, which only the Tasks tab can, so that door is the
 * tab's (`TasksControl.onOpenHistory`).
 */

import { taskLinkStep } from "@repo/features/link-grammar";
import { DOCUMENT_REGION } from "@repo/features/tasks-model";
import type { Workspace } from "@repo/features/workspace-wire";
import { useAdminRoute } from "../admin/admin-route.js";
import type { AdminView } from "../admin/routing.js";
import { useAutomationsRoute } from "../automations-route.js";
import { type InboxAt, useInboxRoute } from "../inbox-route.js";
import { beginPanelSpan, PANEL_SPAN } from "../panel-spans.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { useVersionHistoryRoute } from "../version-history-route.js";
import { useBoardRoute, usePersonRoute } from "../workspace-routes.js";

/** A way of landing that does nothing more than the move. */
const NOTHING = (): void => undefined;

/** The step a workspace's address names it by: its slug, or its id where an older service answered none. */
function stepOf(workspace: Pick<Workspace, "id" | "slug">): string {
  return workspace.slug ?? workspace.id;
}

/** Where a version history's address names its task: its workspace's step, and the task's own step in it. */
export interface VersionHistoryAddress {
  readonly workspace: string;
  readonly task: string;
}

/**
 * The address of `taskId`'s version history, named as its links name it, under its workspace: the one `named` where the
 * window holds no such task, else the listed one; a workspace not yet read is named by its id, as a link names one.
 */
export function versionHistoryAddressOf(
  held: Pick<TasksControl, "tasks" | "region" | "workspaces" | "workspace">,
  taskId: string,
  named?: string,
): VersionHistoryAddress | undefined {
  const { region } = held;
  const task =
    held.tasks.find((each) => each.id === taskId) ??
    (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId ? region.task : undefined);
  const home = held.workspaces.find((each) => each.id === task?.workspaceId);
  const listedStep = held.workspace === undefined ? undefined : stepOf(held.workspace);
  const under = home === undefined ? (named ?? task?.workspaceId ?? listedStep) : stepOf(home);
  return under === undefined
    ? undefined
    : { workspace: under, task: task === undefined ? taskId : taskLinkStep(task) };
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
    close: () => placeLeave.arrive(route.onClose, NOTHING),
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
    close: () => placeLeave.arrive(route.onClose, NOTHING),
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
    close: () => placeLeave.arrive(route.onClose, NOTHING),
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

/** A version history: the press that leaves it, and its read ahead of a press. */
export interface VersionHistoryDoor {
  /** Leaves the version history for its task, its side panel as it was. */
  readonly close: () => void;
  /** Reads the history of `taskId` ahead of a press the pointer says is coming. */
  readonly preload: (taskId: string) => void;
}

/** A version history's doors, its task named as the tab holds it. */
export function useVersionHistoryDoor(
  tasks: Pick<TasksControl, "tasks" | "region" | "workspaces" | "workspace">,
): VersionHistoryDoor {
  // Note that the room reaches only the moves within the history standing, which no door here makes.
  const route = useVersionHistoryRoute({ narrow: false });
  return {
    close: route.onClose,
    preload: (taskId) => {
      const address = versionHistoryAddressOf(tasks, taskId);
      if (address !== undefined) route.onPreload(address.workspace, address.task);
    },
  };
}
