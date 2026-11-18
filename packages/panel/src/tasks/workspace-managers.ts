/**
 * workspace-managers.ts -- the workspace's Managers, as the sidebar's Managers lists them: read from the service, newest started first, and read again as they change.
 *
 * A Manager is an agent of kind `manager` on no task, which the window's
 * live task list never carries, so the list is the service's list of the
 * workspace's agents narrowed to Managers (`AGENTS_WORKSPACE_LIST`), its
 * archived ones left out. It is no live read: it is read as the sidebar
 * first draws it, again every half minute while it stands and as the window
 * comes back into focus, and at once after a write from one of its rows (a
 * rename, an archive, a delete) settles, so a Manager archived elsewhere
 * leaves it at the next read at the latest.
 */

import { AGENT_KIND, type AgentSummary } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { Duration } from "effect";
import { useMemo } from "react";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { type AgentsControl, readAgentById } from "./use-agents.js";

/** How often the list is read again while it stands. */
const READ_EVERY = Duration.seconds(30);

/** The workspace's Managers as the sidebar reads them: the Managers, none before the first answer, whether the read failed, and its retry. */
interface WorkspaceManagers {
  readonly managers: readonly AgentSummary[] | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** The agents control a Manager's row acts through, each write it settles reading the list again. */
  readonly agents: AgentsControl;
}

/** The key the workspace's Managers are read under, which a write from a row, or a Manager made, reads again. */
export function workspaceManagersQueryKey(workspaceId: string | undefined) {
  return [QUERY_ROOT.WORKSPACE_MANAGERS, workspaceId] as const;
}

/** The workspace's unarchived Managers, newest started first; none asked while no workspace is named. */
function workspaceManagersQueryOptions(workspaceId: string | undefined) {
  return queryOptions({
    queryKey: workspaceManagersQueryKey(workspaceId),
    queryFn:
      workspaceId === undefined
        ? skipToken
        : () => askAct(ACT_KIND.AGENTS_WORKSPACE_LIST, { workspaceId, kind: AGENT_KIND.MANAGER }),
    refetchInterval: Duration.toMillis(READ_EVERY),
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** A write's mutation, its settling reading the list again as well as doing what it did. */
function refreshing<Options extends { readonly onSettled?: unknown }>(
  options: Options,
  refresh: () => void,
): Options {
  return { ...options, onSettled: refresh };
}

/**
 * The workspace's Managers while `listed` (the Managers experiment on for
 * it), read through `control`, the window's agents control, whose writes
 * from a Manager's row read the list again once they settle.
 */
export function useWorkspaceManagers(
  workspaceId: string | undefined,
  listed: boolean,
  control: AgentsControl,
): WorkspaceManagers {
  const queryClient = useQueryClient();
  const read = useQuery(workspaceManagersQueryOptions(listed ? workspaceId : undefined));
  const { data, refetch } = read;

  const agents = useMemo((): AgentsControl => {
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: workspaceManagersQueryKey(workspaceId) });

    // Note that a Manager is read again by its own id before it is archived, because the window's control reads only the open task's agents.
    return {
      ...control,
      readAgent: (agentId: string) => readAgentById(queryClient, agentId),
      rename: { ...control.rename, options: refreshing(control.rename.options, refresh) },
      archiveAgent: refreshing(control.archiveAgent, refresh),
      archiveAgents: refreshing(control.archiveAgents, refresh),
      deleteAgent: refreshing(control.deleteAgent, refresh),
    };
  }, [control, queryClient, workspaceId]);

  const answered = data === undefined || "failure" in data ? undefined : data.agents;

  return {
    managers: answered,
    failed: read.isError || (data !== undefined && "failure" in data),
    onRetry: () => void refetch(),
    agents,
  };
}
