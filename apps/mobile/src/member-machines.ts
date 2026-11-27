/**
 * member-machines.ts -- the machines of a workspace's members, as an `@` offers them on the phone: each one's id, name, platform and whose it is, read while a place asks for them.
 *
 * The panel's read (`@repo/panel`'s `useWorkspaceMachines`, the `@` list's
 * machines) on the phone: the host reads the machines of the workspace's
 * members (`ACT_KIND.WORKSPACE_MACHINES_READ`) once per workspace, and again
 * once the read is older than `FRESH_FOR` and a place still asks, as the
 * panel reads them every half minute while a place draws them. Nothing is
 * read where no workspace is named.
 */

import type { WorkspaceMachine } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { useHostActs } from "./host/host-provider.js";

/** Where the read is kept among the app's queries. */
const QUERY_ROOT = { MEMBER_MACHINES: "workspace-member-machines" } as const;

/** How long a read stands before a place that still asks reads it again, as the panel's `@` list holds it. */
const FRESH_FOR = Duration.seconds(30);

/** The machines of the members of the workspace `workspaceId` names; none before the read lands, where it failed, or where no workspace is named. */
export function useMemberMachines(
  workspaceId: string | undefined,
): readonly WorkspaceMachine[] | undefined {
  const acts = useHostActs();

  const { data } = useQuery({
    queryKey: [QUERY_ROOT.MEMBER_MACHINES, workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => acts[ACT_KIND.WORKSPACE_MACHINES_READ]({ workspaceId: workspaceId ?? "" }),
    staleTime: Duration.toMillis(FRESH_FOR),
    retry: false,
  });

  return data?.machines;
}
