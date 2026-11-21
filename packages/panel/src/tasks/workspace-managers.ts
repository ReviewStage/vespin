/**
 * workspace-managers.ts -- the workspace's Managers, as the sidebar's Managers lists them: drawn from the window's live task list, newest started first.
 *
 * A Manager is an agent of kind `manager` on no task, which the live task
 * list carries beside the tasks' agents (`tasklessLiveParam`), so the list
 * is the window's listed agents narrowed to the workspace's unarchived
 * Managers (`@repo/features/workspace-managers-model`, as the iOS app lists
 * them too), read as a live query of their own. It follows the live read, so a Manager made, renamed,
 * archived, or at work anywhere moves here as that read hears it, with no
 * read of its own to ask again. The ones the reader pinned stand under Pinned too
 * (`pinnedManagersOf`), in the order the pins stand, as the same read
 * carries the reader's pins.
 */

import { AGENT_KIND, type AgentSummary, type ListedAgent } from "@repo/features/agent-wire";
import { inPinOrder } from "@repo/features/pin-order";
import type { TaskAgentPin } from "@repo/features/task-wire";
import { workspaceManagersOf } from "@repo/features/workspace-managers-model";
import { and, eq, isNull, isUndefined, useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTaskListCollections } from "../task-list-collections.js";
import {
  type AgentsControl,
  placeAgents,
  readAgentById,
  type TaskAgentsControl,
} from "./use-agents.js";

/** The workspace's Managers as the sidebar draws them, and the agents control a Manager's row acts through. */
interface WorkspaceManagers {
  /** The Managers; none while the live list carries no agents yet. */
  readonly managers: readonly ListedAgent[] | undefined;
  readonly agents: AgentsControl;
}

/**
 * The Managers of `managers` the reader pinned, by `pins`, the reader's pins
 * of agents, in the order Pinned stands its pins: those dragged to a place
 * by it, then the rest newest pinned first (`pin-order.ts`).
 */
export function pinnedManagersOf<Agent extends AgentSummary>(
  managers: readonly Agent[],
  pins: readonly TaskAgentPin[],
): readonly Agent[] {
  const byId = new Map(managers.map((agent) => [agent.id, agent]));

  const pinned = pins.flatMap((pin) => {
    const agent = pin.taskId === null ? byId.get(pin.agentId) : undefined;

    return agent === undefined ? [] : [{ agent, at: pin.pinnedAt, position: pin.pinPosition }];
  });

  return inPinOrder(pinned, (each) => each).map((each) => each.agent);
}

/**
 * The Managers of `workspaceId` while `listed` (the Managers experiment on
 * for it) and the window's live task list carries its agents (`carried`),
 * each row acting through `control`, the window's agents control. Note that
 * the live query holds the workspace's unarchived Managers alone, so a step
 * of any other agent's turn tells it nothing.
 */
export function useWorkspaceManagers(
  workspaceId: string | undefined,
  listed: boolean,
  carried: boolean,
  control: TaskAgentsControl,
): WorkspaceManagers {
  const queryClient = useQueryClient();
  const collections = useTaskListCollections();

  const { data: held } = useLiveQuery((q) =>
    !listed || !carried || workspaceId === undefined
      ? undefined
      : q
          .from({ agent: collections.agents })
          .where(({ agent }) =>
            and(
              eq(agent.kind, AGENT_KIND.MANAGER),
              isNull(agent.taskId),
              eq(agent.workspaceId, workspaceId),
              isUndefined(agent.archivedAt),
            ),
          ),
  );

  const managers = useMemo(
    () =>
      held === undefined || workspaceId === undefined
        ? undefined
        : workspaceManagersOf(held, workspaceId),
    [held, workspaceId],
  );

  // Note that a Manager is read again by its own id before it is archived, because the window's control reads only the open task's agents.
  const agents = useMemo(
    (): AgentsControl => ({
      ...placeAgents(control),
      readAgent: (agentId: string) => readAgentById(queryClient, agentId),
    }),
    [control, queryClient],
  );

  return { managers, agents };
}
