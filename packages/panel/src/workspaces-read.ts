/**
 * workspaces-read.ts -- whether the account's workspaces could not be read, and the press that reads them again.
 *
 * The workspaces are read with the task list (`ACT_KIND.TASKS_REFRESH`), so
 * the one refresh reads both; a failed read is taken as stale, so it reads
 * the workspaces again at once. A fixture run answers for its synthetic
 * workspaces, as the window lists them.
 */

import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { pressMutation } from "./act-mutations.js";
import { appStateQuery, selectWorkspacesFailed } from "./use-app-state.js";

/** The workspaces' read as a surface that says it failed draws it. */
export interface WorkspacesRead {
  /** Whether the last read of the workspaces did not land, those held still drawn. */
  readonly failed: boolean;
  /** Reads the workspaces again after a read that did not land. */
  readonly onRetry: () => void;
}

/** The workspaces' read and its Retry. */
export function useWorkspacesRead(): WorkspacesRead {
  const failed = useQuery({ ...appStateQuery, select: selectWorkspacesFailed }).data === true;
  const { mutate: refreshTasks } = useMutation(pressMutation(ACT_KIND.TASKS_REFRESH));
  const onRetry = useCallback(() => refreshTasks(), [refreshTasks]);

  return { failed, onRetry };
}
