/**
 * workspace-experiments.ts -- whether a workspace has one of its experiments on, as its owners and admins chose it for everyone in it.
 *
 * Task descriptions and Memory are each workspace's choice, carried
 * on its entry in the account's workspaces (`workspacesLive`), so a switch an
 * admin flips reaches every member's window as the list moves. A surface
 * about one task reads that task's workspace; one about no task, ⌘K, a
 * chord, or a Settings page, reads the workspace the window lists or Settings
 * shows. A workspace not yet read, or one the account is no member of, has
 * every experiment off. An account's own experiments are still read off its
 * settings (`selectExperiment`).
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import { workspaceExperimentChoices, workspaceExperimentOnIn } from "@repo/host/app-state-reads";
import {
  type ExperimentChoices,
  experimentsIn,
  NO_EXPERIMENTS,
  type WorkspaceExperiment,
} from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { appStateQuery, selectStoredExperimentChoices } from "./use-app-state.js";

/**
 * Whether a workspace has one experiment on: the one way a surface about a
 * task, or about the workspace the window lists, asks of a workspace
 * experiment. Off while `workspaceId` is none, or names no workspace read.
 */
export function useWorkspaceExperiment(
  workspaceId: string | undefined,
  experiment: WorkspaceExperiment,
): boolean {
  const select = useCallback(
    (state: AppStateSnapshot) => workspaceExperimentOnIn(state, workspaceId, experiment),
    [workspaceId, experiment],
  );

  return useQuery({ ...appStateQuery, select }).data === true;
}

/**
 * When a workspace last turned one experiment on, in epoch milliseconds,
 * while it stands on; none while it is off, never chosen, or the workspace
 * is not read.
 */
export function useWorkspaceExperimentOnSince(
  workspaceId: string | undefined,
  experiment: WorkspaceExperiment,
): number | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => {
      const choice = state.tasks.workspaces
        .find((each) => each.id === workspaceId)
        ?.experiments?.find((each) => each.experiment === experiment);

      return choice?.on === true ? choice.changedAt : undefined;
    },
    [workspaceId, experiment],
  );

  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * Every experiment on where the window works in one workspace: the account's
 * own choices of its own, and that workspace's of the workspace's. For a list
 * that gates its entries by a tag (`AppShortcut.experiment`), or a page by
 * its experiment, whatever its scope.
 */
export function useExperimentsIn(workspaceId: string | undefined): ExperimentChoices {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      experimentsIn(
        selectStoredExperimentChoices(state),
        workspaceExperimentChoices(state.tasks.workspaces, workspaceId),
      ),
    [workspaceId],
  );

  return useQuery({ ...appStateQuery, select }).data ?? NO_EXPERIMENTS;
}
