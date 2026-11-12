/**
 * agent-route.ts -- an agent's own address as the router stands it: whether it stands, the agent and workspace it names, and the navigation that opens it.
 *
 * An agent's address, `/<workspace>/agent/<agentId>`, is a routed place
 * (`panel-router.tsx`) under the workspace it names, read from the address
 * alone, as a person's page is (`workspace-routes.ts`). Its page opens the
 * agent on its task (`desktop-agent-page.tsx`), so a door naming an agent
 * the task list does not carry yet opens it here and the agent lands on its
 * task once read. Opening one is a visit; opening the one already standing
 * moves nothing.
 */

import { useNavigate, useRouter } from "@tanstack/react-router";
import { placeParamsOf } from "./places/place-params.js";
import { useRoutedExits } from "./places/routed-exits.js";
import { ROUTED_PLACE, routedPlaceOf, useWindowPlace } from "./places/routed-places.js";
import { useRouteAccess } from "./route-gates.js";

/** An agent's page as the router stands it. */
export interface AgentRoute {
  /** The agent whose page stands, none while none does. */
  readonly agentId: string | undefined;
  /** The address step of the workspace the page stands under, while it stands. */
  readonly workspace: string | undefined;
  /** Opens the page of `agentId` under the workspace whose address step is `workspace`. */
  readonly onOpen: (agentId: string, workspace: string) => void;
  readonly onClose: () => void;
}

/**
 * An agent's page as the router stands it, left by the window's routed exit,
 * and kept standing by its stay where a leave was asked of it before a door asked for
 * the page standing. Note that the page standing is read from where the
 * router's history stands at the call rather than as the window was last
 * drawn, because a tab landing on the page's address opens its link in the
 * same turn, before the window draws it standing (`load-link.ts`).
 */
export function useAgentRoute(): AgentRoute {
  const exits = useRoutedExits();
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
  const access = useRouteAccess();
  const open = here.place === ROUTED_PLACE.AGENT;
  const agentId = open ? here.params.agentId : undefined;
  const workspace = open ? here.params.workspace : undefined;

  const onOpen = (to: string, toWorkspace: string) => {
    const matches = router.matchRoutes(router.history.location.pathname);
    const params = placeParamsOf(matches);
    const standing = routedPlaceOf(matches, access) === ROUTED_PLACE.AGENT;

    // Opening the page standing moves nothing, and keeps it standing where the door that asked for it left the routed place first, as a link's and ⌘K's do.
    if (standing && params.agentId === to && params.workspace === toWorkspace) {
      exits.stay();

      return;
    }

    void navigate({
      to: "/$workspace/agent/$agentId",
      params: { workspace: toWorkspace, agentId: to },
    });
  };

  return { agentId, workspace, onOpen, onClose: () => exits.leave() };
}
