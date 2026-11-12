/**
 * admin-route.ts -- Admin as the router stands it: whether it stands, the view its address names, and the navigation that opens a view.
 *
 * Admin is a routed place (`panel-router.tsx`) under the workspace the
 * sidebar lists, its view read from its address alone: the Overview at
 * `/<workspace>/admin`, a section at `/admin/<section>`, and an account's, a
 * workspace's, or a day's page beneath. Its sections are one step, each
 * turned in the step's place as Settings' pages are, so Back leaves the
 * place; an account's, a workspace's, or a day's page is a step of its own.
 */

import { ADMIN_LINK_SECTION, type AdminLinkSection } from "@repo/features/link-grammar";
import { type NavigateOptions, useNavigate, useRouter } from "@tanstack/react-router";
import { useRoutedExits } from "../places/routed-exits.js";
import { ROUTED_PLACE, useWindowPlace } from "../places/routed-places.js";
import {
  ADMIN_TAB,
  type AdminView,
  adminLinkFields,
  adminSection,
  adminViewOfLink,
} from "./routing.js";

/** The Overview, where Admin opens with no view named. */
const ADMIN_OVERVIEW: AdminView = { kind: ADMIN_TAB.DASHBOARD };

/** The section a segment names; none for one naming no section. */
function sectionOf(segment: string | undefined): AdminLinkSection | undefined {
  return Object.values(ADMIN_LINK_SECTION).find((section) => section === segment);
}

/** The navigation that stands Admin's `view` under `workspace`. */
function navigationTo(view: AdminView, workspace: string): NavigateOptions {
  const fields = adminLinkFields(view);

  if (fields.userId !== undefined) {
    return {
      to: "/$workspace/admin/user/$userId",
      params: { workspace, userId: fields.userId },
    };
  }

  if (fields.workspaceId !== undefined) {
    return {
      to: "/$workspace/admin/workspace/$workspaceId",
      params: { workspace, workspaceId: fields.workspaceId },
    };
  }

  if (fields.day !== undefined) {
    return { to: "/$workspace/admin/day/$day", params: { workspace, day: fields.day } };
  }

  if (fields.section !== undefined) {
    return { to: "/$workspace/admin/$section", params: { workspace, section: fields.section } };
  }

  return { to: "/$workspace/admin", params: { workspace } };
}

/** Admin as the router stands it: whether it takes the window, the view it stands on, and the navigation that opens and leaves it. */
export interface AdminRoute {
  readonly open: boolean;
  /** The view standing, or the Overview while the place does not stand. */
  readonly view: AdminView;
  /** Opens the place on `view`; where none is named, on the Overview. */
  readonly onOpen: (view?: AdminView) => void;
  readonly onClose: () => void;
  /** Reads the place ahead of a press the pointer says is coming, its chunk, charts and all. */
  readonly onPreload: () => void;
}

/** The view Admin stands on as the router stands it, the Overview while it does not stand. */
export function useAdminView(): AdminView {
  const here = useWindowPlace();

  if (here.place !== ROUTED_PLACE.ADMIN) return ADMIN_OVERVIEW;
  const { params } = here;

  return (
    adminViewOfLink({
      section: sectionOf(params.section),
      userId: params.userId,
      workspaceId: params.workspaceId,
      day: params.day,
    }) ?? ADMIN_OVERVIEW
  );
}

/** Admin as the router stands it, opened under the workspace `listedSlug` names as it is pressed, and left by the window's routed exit (`places/routed-exits.ts`). */
export function useAdminRoute(input: { listedSlug: () => string | undefined }): AdminRoute {
  const exits = useRoutedExits();
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
  const view = useAdminView();
  const open = here.place === ROUTED_PLACE.ADMIN;
  const { params } = here;

  const onOpen = (to: AdminView = ADMIN_OVERVIEW) => {
    const workspace = (open ? params.workspace : undefined) ?? input.listedSlug();

    if (workspace === undefined) return;
    const options = navigationTo(to, workspace);

    // Opening the view already standing moves nothing, and keeps the place standing where the door that asked for it left
    // the routed place first, as the Board's and the Automations pages' do (`places/routed-exits.ts`'s `stay`).
    if (open && router.buildLocation(options).href === router.history.location.href) {
      exits.stay();

      return;
    }

    // A section turned from another stands in its step's place; any other view is a step of its own.
    const replace = open && adminSection(view) && adminSection(to);
    void navigate({ ...options, replace });
  };

  const onPreload = () => {
    const workspace = input.listedSlug();

    if (workspace !== undefined)
      void router.preloadRoute({ to: "/$workspace/admin", params: { workspace } });
  };

  return { open, view, onOpen, onClose: () => exits.leave(), onPreload };
}
