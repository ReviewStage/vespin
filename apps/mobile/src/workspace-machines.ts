/**
 * workspace-machines.ts -- the machines a workspace owns, which every member's agents may run on, each in a VM of its own, followed on the host while a screen draws them.
 *
 * The panel's read (`@repo/panel`'s `workspaceOwnedMachinesQuery`) on the
 * phone: the host follows the workspace's machines while a screen holds its
 * id (`WORKSPACE_OWNED_MACHINES_FOLLOW`) and writes them into the document
 * (`LIVE_READ.WORKSPACE_MACHINES`), each by name, a rename still out drawn
 * over it and a removal drawn gone, which the screen reads. Settings ›
 * Machines lists them, Runs on and Move to offer them, and an agent's row
 * and Machine chip draw the platform of the one it runs on.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import type { WorkspaceMachineLine } from "@repo/features/workspace-machine-view";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";
import { useLiveFollow } from "./host/live-follow.js";

/** No machines read yet, held steady for a screen that offers none. */
const NO_MACHINES: readonly WorkspaceMachineLine[] = [];

/** A workspace's machines as a screen reads them: each once read, whether the read failed before it listed any, and what reads them again. */
export interface WorkspaceMachines {
  /** The machines, by name; none before the read lands or where no workspace is named. */
  readonly machines: readonly WorkspaceMachineLine[] | undefined;
  readonly failed: boolean;
  readonly retry: () => void;
}

/**
 * The machines the workspace `workspaceId` names owns, followed while the
 * screen holds it; nothing is followed or read where it names none.
 */
export function useWorkspaceMachines(workspaceId: string | undefined): WorkspaceMachines {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) =>
    acts[ACT_KIND.WORKSPACE_OWNED_MACHINES_FOLLOW]({ workspaceId: id }),
  );

  const select = useMemo(
    () => (state: AppStateSnapshot) =>
      workspaceId === undefined ? undefined : state[LIVE_READ.WORKSPACE_MACHINES][workspaceId],
    [workspaceId],
  );

  const { data: held } = useQuery({ ...appStateQuery, select });
  const machines = held?.rows;

  return {
    machines,
    failed: machines === undefined && held?.failed === true,
    retry: () => {
      if (workspaceId === undefined) return;
      acts[ACT_KIND.WORKSPACE_OWNED_MACHINES_RETRY]({ workspaceId }).catch((cause: unknown) =>
        console.error("Reading the workspace's machines again did not go.", cause),
      );
    },
  };
}

/** The machines a workspace owns, for a place that offers or draws them; none before they are read or where no workspace is named. */
export function useOfferedWorkspaceMachines(
  workspaceId: string | undefined,
): readonly WorkspaceMachineLine[] {
  return useWorkspaceMachines(workspaceId).machines ?? NO_MACHINES;
}
