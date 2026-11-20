/**
 * workspace-managers.ts -- the workspace's Managers, as the sidebar's Managers lists them: drawn from the window's live task list, newest started first.
 *
 * A Manager is an agent of kind `manager` on no task, which the live task
 * list carries beside the tasks' agents (`tasklessLiveParam`), so the list
 * is the window's listed agents narrowed to the workspace's unarchived
 * Managers. It follows the live read, so a Manager made, renamed, archived,
 * or at work anywhere moves here as that read hears it, with no read of its
 * own to ask again. The ones the reader pinned stand under Pinned too
 * (`pinnedManagersOf`), in the order the pins stand, as the same read
 * carries the reader's pins.
 */

import { AGENT_KIND, type AgentSummary, type ListedAgent } from "@repo/features/agent-wire";
import { inPinOrder } from "@repo/features/pin-order";
import type { TaskAgentPin } from "@repo/features/task-wire";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { type AgentsControl, readAgentById } from "./use-agents.js";

/** The workspace's Managers as the sidebar draws them, and the agents control a Manager's row acts through. */
interface WorkspaceManagers {
  /** The Managers; none while the live list carries no agents yet. */
  readonly managers: readonly AgentSummary[] | undefined;
  readonly agents: AgentsControl;
}

/** Newest started first, and by id among those started at one instant. */
function newestFirst(a: ListedAgent, b: ListedAgent): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The workspace's unarchived Managers of `listed`, newest started first. */
function managersOf(listed: readonly ListedAgent[], workspaceId: string): readonly ListedAgent[] {
  return listed
    .filter(
      (agent) =>
        agent.kind === AGENT_KIND.MANAGER &&
        agent.taskId === null &&
        agent.workspaceId === workspaceId &&
        agent.archivedAt === undefined,
    )
    .toSorted(newestFirst);
}

/**
 * The Managers of `managers` the reader pinned, by `pins`, the reader's pins
 * of agents, in the order Pinned stands its pins: those dragged to a place
 * by it, then the rest newest pinned first (`pin-order.ts`).
 */
export function pinnedManagersOf(
  managers: readonly AgentSummary[],
  pins: readonly TaskAgentPin[],
): readonly AgentSummary[] {
  const byId = new Map(managers.map((agent) => [agent.id, agent]));

  const pinned = pins.flatMap((pin) => {
    const agent = pin.taskId === null ? byId.get(pin.agentId) : undefined;

    return agent === undefined ? [] : [{ agent, at: pin.pinnedAt, position: pin.pinPosition }];
  });

  return inPinOrder(pinned, (each) => each).map((each) => each.agent);
}

/**
 * The Managers of `workspaceId` while `listed` (the Managers experiment on
 * for it), from `liveAgents`, the window's live task list's agents, each
 * row acting through `control`, the window's agents control.
 */
export function useWorkspaceManagers(
  workspaceId: string | undefined,
  listed: boolean,
  liveAgents: readonly ListedAgent[] | undefined,
  control: AgentsControl,
): WorkspaceManagers {
  const queryClient = useQueryClient();

  const managers = useMemo(
    () =>
      !listed || workspaceId === undefined || liveAgents === undefined
        ? undefined
        : managersOf(liveAgents, workspaceId),
    [listed, workspaceId, liveAgents],
  );

  // Note that a Manager is read again by its own id before it is archived, because the window's control reads only the open task's agents.
  const agents = useMemo(
    (): AgentsControl => ({
      ...control,
      readAgent: (agentId: string) => readAgentById(queryClient, agentId),
    }),
    [control, queryClient],
  );

  return { managers, agents };
}
