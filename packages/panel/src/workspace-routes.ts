/**
 * workspace-routes.ts -- a workspace's Home, its Board, a person's page, and a workspace not there for the reader as the router stands them: whether each stands, what its address names, and the navigation that opens it.
 *
 * Both are routed places (`panel-router.tsx`) under the workspace their
 * address names, read from the address alone, as Admin is
 * (`admin/admin-route.ts`). Opening one is a visit; opening the one already
 * standing moves nothing, as pressing the place standing always has. A
 * person's page is opened with the name the place that opened it knew them
 * by, which names someone who left; the address holds no name, so the
 * window keeps each one it was handed for as long as it lives, and a step
 * back to the page finds it there. A Home or Board link naming none of the
 * reader's workspaces opens that workspace's address, which the router
 * finds not found (`panel-router.tsx`), in the step's place, so it is no
 * step of its own, as it never was. Home is the listed workspace's, at
 * `/app` while none is listed, and stands under the one listed in the
 * step's place once another is; what it holds of the task bound is the
 * place module's to keep (`places/place-binding.ts`).
 */

import { useNavigate, useRouter } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { useAutomationsPlace } from "./automations-route.js";
import { type InboxRoute, useInboxRoute } from "./inbox-route.js";
import { placeParamsOf } from "./places/place-params.js";
import { useRoutedExits, useRoutedMemory } from "./places/routed-exits.js";
import { ROUTED_PLACE, routedPlaceOf, useWindowPlace } from "./places/routed-places.js";
import { useRouteAccess } from "./route-gates.js";
import type { AutomationsPlace } from "./tasks/automations-place.js";

/** A workspace's Home as the router stands it. */
export interface HomeRoute {
  readonly open: boolean;
  /** The address step of the workspace whose Home stands, while it stands under one; none at `/app`. */
  readonly standingIn: string | undefined;
  /** Opens Home under the workspace listed, or at `/app` while none is; nothing where Home stands. */
  readonly onOpen: () => void;
  /** Leaves Home for the task bound. */
  readonly onClose: () => void;
  /** Stands Home of `workspace` in the step's place, as another workspace listed under Home does. */
  readonly onTurn: (workspace: string) => void;
}

/** Home as the router stands it, opened under the workspace `listed` names as it is pressed, and left by the window's routed exit. */
export function useHomeRoute(input: { listed: () => string | undefined }): HomeRoute {
  const exits = useRoutedExits();
  const navigate = useNavigate();
  const here = useWindowPlace();
  const open = here.place === ROUTED_PLACE.HOME;
  const standingIn = open ? here.params.workspace : undefined;

  const onOpen = () => {
    if (open) return;
    const workspace = input.listed();

    if (workspace === undefined) void navigate({ to: "/app" });
    else void navigate({ to: "/$workspace", params: { workspace } });
  };

  const onTurn = (workspace: string) => {
    if (standingIn === workspace) return;
    void navigate({ to: "/$workspace", params: { workspace }, replace: true });
  };

  return { open, standingIn, onOpen, onClose: () => exits.leave(), onTurn };
}

/** A workspace's Board as the router stands it. */
export interface BoardRoute {
  readonly open: boolean;
  /** The address step of the workspace whose Board stands, while it stands. */
  readonly standingIn: string | undefined;
  /** Opens the Board of the workspace whose address step is `workspace`. */
  readonly onOpen: (workspace: string) => void;
  readonly onClose: () => void;
  /** Stands the Board of `workspace` in the step's place, as another workspace listed under the Board does. */
  readonly onTurn: (workspace: string) => void;
  /** Reads the Board ahead of a press the pointer says is coming. */
  readonly onPreload: (workspace: string) => void;
}

/** A person's page as the router stands it. */
export interface PersonRoute {
  /** The person whose page stands, none while none does. */
  readonly userId: string | undefined;
  /** The name the page was opened with, where it was handed one. */
  readonly name: string | undefined;
  /** The address step of the workspace the page is the person's in, while it stands. */
  readonly workspace: string | undefined;
  readonly onOpen: (userId: string, name: string | undefined, workspace: string) => void;
  readonly onClose: () => void;
  /** Reads the page ahead of a press the pointer says is coming. */
  readonly onPreload: (userId: string, workspace: string) => void;
}

/** The Board as the router stands it, left by the window's routed exit, and kept standing by its stay where a leave was asked of it before a door asked for the Board standing (`places/routed-exits.ts`). */
export function useBoardRoute(): BoardRoute {
  const exits = useRoutedExits();
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
  const open = here.place === ROUTED_PLACE.BOARD;
  const standingIn = open ? here.params.workspace : undefined;

  const onOpen = (workspace: string) => {
    // Opening the Board standing moves nothing, and keeps it standing where the door that asked for it left the routed place first, as a link's and ⌘K's do.
    if (standingIn === workspace) {
      exits.stay();

      return;
    }

    void navigate({ to: "/$workspace/tasks", params: { workspace } });
  };

  const onTurn = (workspace: string) => {
    if (standingIn === workspace) return;
    void navigate({ to: "/$workspace/tasks", params: { workspace }, replace: true });
  };

  const onPreload = (workspace: string) => {
    void router.preloadRoute({ to: "/$workspace/tasks", params: { workspace } });
  };

  return { open, standingIn, onOpen, onClose: () => exits.leave(), onTurn, onPreload };
}

/** A person's page as the router stands it, left and kept standing by the window's routed exits as the Board is. */
export function usePersonRoute(): PersonRoute {
  const exits = useRoutedExits();
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
  // Only grows: each name a page was opened with, by the person, which the address leaves out.
  const names = useRoutedMemory().personNames;
  const open = here.place === ROUTED_PLACE.PERSON;
  const userId = open ? here.params.userId : undefined;
  const name = useSelector(names, (held) => (userId === undefined ? undefined : held.get(userId)));
  const workspace = open ? here.params.workspace : undefined;

  const onOpen = (to: string, named: string | undefined, toWorkspace: string) => {
    if (named !== undefined) names.setState((held) => new Map(held).set(to, named));

    if (to === userId && toWorkspace === workspace) {
      exits.stay();

      return;
    }

    void navigate({
      to: "/$workspace/person/$userId",
      params: { workspace: toWorkspace, userId: to },
    });
  };

  const onPreload = (to: string, toWorkspace: string) => {
    void router.preloadRoute({
      to: "/$workspace/person/$userId",
      params: { workspace: toWorkspace, userId: to },
    });
  };

  return {
    userId,
    name,
    workspace,
    onOpen,
    onClose: () => exits.leave(),
    onPreload,
  };
}

/** The Board, a person's page, and the Automations pages as their routes stand them, which a step's name and Copy link read. */
export interface RoutedViews {
  /** Whether the Board stands. */
  readonly board: boolean;
  /** Whose page stands, if anyone's, by the name it was opened with and the address step of the workspace it is theirs in. */
  readonly person: Pick<PersonRoute, "userId" | "name" | "workspace">;
  /** The Automations page standing, none while none does. */
  readonly automations: AutomationsPlace | undefined;
  /** Whether the Inbox stands, the item chosen in it as its address names it, of whichever workspace (`listedInboxChoice`), and the task its list is narrowed to. */
  readonly inbox: Pick<InboxRoute, "open" | "chosen" | "narrowed">;
}

/** The Board, a person's page, the Automations pages, and the Inbox as the router stands them. */
export function useRoutedViews(): RoutedViews {
  const { open } = useBoardRoute();
  const { userId, name, workspace } = usePersonRoute();
  const automations = useAutomationsPlace();
  const inbox = useInboxRoute();

  return {
    board: open,
    person: { userId, name, workspace },
    automations: automations.open ? automations.place : undefined,
    inbox: { open: inbox.open, chosen: inbox.chosen, narrowed: inbox.narrowed },
  };
}

/** A workspace's address naming none of the reader's as the router stands it, not found. */
export interface UnknownWorkspaceRoute {
  /** The address step of the workspace not there, while its address stands. */
  readonly workspace: string | undefined;
  /** Opens the address of the workspace whose address step is `workspace`, in the step's place. */
  readonly onOpen: (workspace: string) => void;
  readonly onClose: () => void;
}

/** A workspace not there for the reader as the router stands it, left and kept standing by the window's routed exits as the Board is. */
export function useUnknownWorkspaceRoute(): UnknownWorkspaceRoute {
  const exits = useRoutedExits();
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
  const access = useRouteAccess();
  const open = here.place === ROUTED_PLACE.UNKNOWN_WORKSPACE;
  const standingIn = open ? here.params.workspace : undefined;

  // Note that the page standing is read from where the router's history stands at the call, as a refused start's restore
  // calls it after the window has left the page (`agent-route.ts`).
  const onOpen = (workspace: string) => {
    const matches = router.matchRoutes(router.history.location.pathname);
    const standing = routedPlaceOf(matches, access) === ROUTED_PLACE.UNKNOWN_WORKSPACE;

    if (standing && placeParamsOf(matches).workspace === workspace) {
      exits.stay();

      return;
    }

    // Note that it takes the step's place, because a workspace not there for the reader is no place of theirs to come back to.
    void navigate({ to: "/$workspace", params: { workspace }, replace: true });
  };

  return { workspace: standingIn, onOpen, onClose: () => exits.leave() };
}
