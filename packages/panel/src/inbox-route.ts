/**
 * inbox-route.ts -- the window's Inbox as the router stands it: whether it stands, the task its list is narrowed to, the item chosen in it, and the navigation that opens, narrows, chooses in, and leaves it.
 *
 * The Inbox is a routed place (`panel-router.tsx`) under the workspace its
 * address names, read from the address alone: its list at
 * `/<workspace>/inbox`, the list narrowed to one task's items at
 * `/inbox/task/<taskId>`, and an item chosen at `/inbox/<itemId>`, whose
 * `?task=<taskId>` keeps the narrowing of the list it was chosen in, so a
 * way back to that list finds it narrowed again. Opening it, narrowing or
 * widening it, and choosing an item are each a visit; going back to the
 * list from an item, which the window's history steps back to where it
 * stands behind (`places/narrow-backs.ts`), and another
 * workspace listed under it, take the step in place.
 *
 * An address names an item by its id alone. Where it stands, on the task
 * whose side panel stands beside it, is what the door that chose it said, held by item for as long as the window lives;
 * an item no door chose here, as a reloaded address names one, is found as
 * a link naming it by its id alone is (`inboxItemHomeQueryOptions`).
 */

import type { InboxItemHome } from "@repo/features/inbox-wire";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type NavigateOptions, useNavigate, useRouter } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { useMemo } from "react";
import { useRoutedExits, useRoutedMemory } from "./places/routed-exits.js";
import { ROUTED_PLACE, useWindowPlace } from "./places/routed-places.js";
import { inboxItemHomeQueryOptions } from "./tasks/agent-reads.js";
import type { InboxChoice, TasksControl } from "./tasks/use-tasks-tab.js";

/** The Inbox's routes by id. */
const INBOX_LEAF = {
  LIST: "/places/$workspace/inbox/",
  TASK: "/places/$workspace/inbox/task/$taskId",
  ITEM: "/places/$workspace/inbox/$itemId",
} as const;

/** Where an item opens: the workspace whose Inbox it is chosen in, by its address step, and the task that Inbox's list is narrowed to, none for every task's. */
export interface InboxAt {
  readonly workspace: string;
  readonly narrowed: string | undefined;
}

/** The window's Inbox as the router stands it. */
export interface InboxRoute {
  readonly open: boolean;
  /** The address step of the workspace whose Inbox stands, while it stands. */
  readonly standingIn: string | undefined;
  /** The task the list is narrowed to, none where it lists every task's items. */
  readonly narrowed: string | undefined;
  /** The item chosen, none while the list stands alone. */
  readonly chosen: InboxChoice | undefined;
  /** The address of the list the item standing was chosen in, while one stands, which a way back from it steps back to. */
  readonly listAddress: string | undefined;
  /** Opens the list at `at`, nothing chosen, as a visit, or in the step's place where `replace`. */
  readonly onOpen: (at: InboxAt, replace?: boolean) => void;
  /** Where the item `itemId` stands, as a door chose it or the service found it; none where neither has said. */
  readonly choiceOf: (itemId: string) => InboxChoice | undefined;
  /** Chooses `chosen` at `at`; where none is named, in the Inbox standing. Either way an item of another task than the one the list is narrowed to widens it. */
  readonly onChoose: (chosen: InboxChoice, at?: InboxAt) => void;
  /** Goes to `chosen` at `at` as `onChoose` does, but holds nothing: a door that moves first holds it once it lands (`onHold`). */
  readonly onGoTo: (chosen: InboxChoice, at?: InboxAt) => void;
  /** Holds where `chosen` stands, by its item, as `onChoose` does before it goes there. */
  readonly onHold: (chosen: InboxChoice) => void;
  /** Stands the list the item standing was chosen in, in the step's place. */
  readonly onClear: () => void;
  /** Lists every task's items again, where the list is narrowed to one. */
  readonly onWiden: () => void;
  readonly onClose: () => void;
  /** Stands the Inbox of `workspace` in the step's place, on its list, as another workspace listed under it does. */
  readonly onTurn: (workspace: string) => void;
}

/** The window's Inbox as a surface reads it: whether it stands, the item chosen in the listed workspace's list, and the task the list is narrowed to. */
export interface InboxView {
  readonly open: boolean;
  /** The item chosen, none until one is, or while the one chosen is a task's of another workspace than the one listed. */
  readonly chosen: InboxChoice | undefined;
  /** The task the list is narrowed to, none where it lists every task's items. */
  readonly narrowed: string | undefined;
}

/** The navigation that stands the list at `at`. */
function listAt(at: InboxAt): NavigateOptions {
  return at.narrowed === undefined
    ? { to: "/$workspace/inbox", params: { workspace: at.workspace } }
    : {
        to: "/$workspace/inbox/task/$taskId",
        params: { workspace: at.workspace, taskId: at.narrowed },
      };
}

/** The navigation that stands `itemId` at `at`. */
function itemAt(itemId: string, at: InboxAt): NavigateOptions {
  return {
    to: "/$workspace/inbox/$itemId",
    params: { workspace: at.workspace, itemId },
    search: at.narrowed === undefined ? {} : { task: at.narrowed },
  };
}

/** The task an Inbox choice stands on; none for one named by its id alone. */
function choiceTaskOf(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.taskId : undefined;
}

/** Whether a choice is an item still being found by its address, chosen without being opened (`useFoundChoice`). */
function beingFound(choice: InboxChoice): boolean {
  return !("taskId" in choice) && choice.opened !== true;
}

/** The item `itemId` under the task the service says it stands on. */
function choiceAt(itemId: string, home: InboxItemHome): InboxChoice {
  return { taskId: home.planId, itemAgentId: home.agentId, itemId, opened: true };
}

/**
 * The item `itemId` where nothing the window chose holds it: where the
 * service says it stands, or missing where it says nothing, waiting on it
 * meanwhile. Note that it is the same choice on every draw while what was
 * found stands, because the Inbox knows the window's choice by its identity
 * (`use-inbox-listing.ts`'s `useChoiceFirst`): a new one each draw reads as
 * the window choosing again, and drops every row's press made over it.
 */
function useFoundChoice(itemId: string | undefined, held: boolean): InboxChoice | undefined {
  const asked = itemId !== undefined && !held;
  const home = useQuery({ ...inboxItemHomeQueryOptions(itemId ?? ""), enabled: asked });
  const { isPending, data } = home;

  return useMemo(() => {
    if (!asked) return undefined;

    // Note that an item still being found is chosen without being opened, so its pane waits rather than saying it is missing.
    if (isPending) return { itemId };
    const found = data === undefined || "failure" in data ? undefined : data;

    return found === undefined ? { itemId, opened: true } : choiceAt(itemId, found);
  }, [asked, itemId, isPending, data]);
}

/** The Inbox as the router stands it, left by the window's routed exit, and kept standing by its stay where a leave was asked of it before a door asked for the place standing (`places/routed-exits.ts`). */
export function useInboxRoute(): InboxRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const here = useWindowPlace();
  const exits = useRoutedExits();
  // Only grows: each item a door chose, by its id, for as long as the window lives.
  const choices = useRoutedMemory().inboxChoices;
  const open = here.place === ROUTED_PLACE.INBOX;
  const standingIn = open ? here.params.workspace : undefined;
  const itemId = open && here.leaf === INBOX_LEAF.ITEM ? here.params.itemId : undefined;

  const narrowed = !open
    ? undefined
    : here.leaf === INBOX_LEAF.TASK
      ? here.params.taskId
      : here.leaf === INBOX_LEAF.ITEM
        ? here.search.task
        : undefined;

  const held = useSelector(choices, (map) => (itemId === undefined ? undefined : map.get(itemId)));
  const found = useFoundChoice(itemId, held !== undefined);
  const standingAt = standingIn === undefined ? undefined : { workspace: standingIn, narrowed };

  // Note that a door asked for the place standing moves nothing, and keeps it standing where it left the routed place first, as a link's and ⌘K's do.
  const visit = (options: NavigateOptions, replace = false) => {
    if (router.buildLocation(options).href === router.history.location.href) {
      exits.stay();

      return;
    }

    void navigate({ ...options, replace });
  };

  // Note that an item still being found by its address is no door's choice, so it is held nowhere and found again where it stands.
  const onHold = (chosen: InboxChoice) => {
    if (!beingFound(chosen)) choices.setState((map) => new Map(map).set(chosen.itemId, chosen));
  };

  const onGoTo = (chosen: InboxChoice, at?: InboxAt) => {
    const to = at ?? standingAt;

    if (to === undefined) return;
    // An item of another task leaves the task the list is narrowed to, so the list it opens in holds it.
    const keeps = to.narrowed === undefined || to.narrowed === choiceTaskOf(chosen);
    visit(itemAt(chosen.itemId, keeps ? to : { ...to, narrowed: undefined }));
  };

  const onChoose = (chosen: InboxChoice, at?: InboxAt) => {
    if (at === undefined && standingAt === undefined) return;
    onHold(chosen);
    onGoTo(chosen, at);
  };

  const list = standingAt === undefined ? undefined : listAt(standingAt);

  return {
    open,
    standingIn,
    narrowed,
    chosen: held ?? found,
    listAddress:
      itemId === undefined || list === undefined ? undefined : router.buildLocation(list).href,
    onOpen: (at, replace) => visit(listAt(at), replace),
    choiceOf: (itemId) => {
      const chosen = choices.state.get(itemId);

      if (chosen !== undefined) return chosen;
      const home = queryClient.getQueryData(inboxItemHomeQueryOptions(itemId).queryKey);

      return home === undefined || "failure" in home ? undefined : choiceAt(itemId, home);
    },
    onChoose,
    onGoTo,
    onHold,
    onClear: () => {
      if (list !== undefined && itemId !== undefined) void navigate({ ...list, replace: true });
    },
    onWiden: () => {
      if (standingIn !== undefined && narrowed !== undefined) {
        visit(listAt({ workspace: standingIn, narrowed: undefined }));
      }
    },
    onClose: () => exits.leave(),
    onTurn: (workspace) => {
      if (standingIn === undefined || standingIn === workspace) return;
      // Note that the same Inbox under another workspace lists that workspace's items alone, so it stands on its list.
      void navigate({ to: "/$workspace/inbox", params: { workspace }, replace: true });
    },
  };
}

/**
 * The item `chosen` as the listed workspace's Inbox holds it: the Inbox lists
 * the listed workspace's items alone, so a choice another workspace's list
 * made gives way with it. Note that one named by its id alone is held to the
 * listed workspace by the list itself.
 */
export function listedInboxChoice(
  chosen: InboxChoice | undefined,
  tasks: Pick<TasksControl, "tasks" | "workspace">,
): InboxChoice | undefined {
  if (chosen === undefined || !("taskId" in chosen) || tasks.workspace === undefined) return chosen;
  const listedId = tasks.workspace.id;

  const listed = tasks.tasks.some(
    (task) => task.id === chosen.taskId && task.workspaceId === listedId,
  );

  return listed ? chosen : undefined;
}

/** The window's Inbox as the router stands it, its choice as the listed workspace's list holds it. */
export function useInboxView(tasks: Pick<TasksControl, "tasks" | "workspace">): InboxView {
  const { open, chosen, narrowed } = useInboxRoute();

  return { open, chosen: listedInboxChoice(chosen, tasks), narrowed };
}
