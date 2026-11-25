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
 * (`pinnedManagersOf`), each where its pin stands, as the same read
 * carries the reader's pins.
 */

import { AGENT_KIND, type ListedAgent } from "@repo/features/agent-wire";
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

/** The workspace's Managers as the sidebar draws them. */
interface WorkspaceManagers {
  /** The Managers; none while the live list carries no agents yet. */
  readonly managers: readonly ListedAgent[] | undefined;
}

/**
 * The Managers of `workspaceId` while `listed` (the Managers experiment on
 * for it) and the window's live task list carries its agents (`carried`).
 * Note that the live query holds the workspace's unarchived Managers alone,
 * so a step of any other agent's turn tells it nothing.
 */
export function useWorkspaceManagers(
  workspaceId: string | undefined,
  listed: boolean,
  carried: boolean,
): WorkspaceManagers {
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

  return { managers };
}

/** What the window's agents control holds of the open task alone, which a Manager, on no task, acts through none of. */
const OPEN_TASK_AGENTS: ReadonlySet<keyof TaskAgentsControl> = new Set([
  "rows",
  "rowNow",
  "pullRequestNow",
  "archivedIds",
  "workingIds",
  "agentIds",
  "heldIds",
  "draft",
  "keywords",
  "readSkills",
] as const);

/** No words a dictation is likely to say, a Manager's row taking no dictation. */
const NO_KEYWORDS: readonly string[] = [];

/**
 * Whether a Manager's row acts through `now` as it acted through `was`:
 * all but the open task's own fields the same. Note that the control moves
 * as a task opens, and a Manager's row read it whole, so every Manager's row
 * drew again on every open though none of what it acts through moved.
 */
export function sameForManagers(was: TaskAgentsControl, now: TaskAgentsControl): boolean {
  // SAFETY: the keys of a control are its own fields, each named in `TaskAgentsControl`.
  const keys = Object.keys(now) as (keyof TaskAgentsControl)[];

  return (
    keys.length === Object.keys(was).length &&
    keys.every((key) => OPEN_TASK_AGENTS.has(key) || was[key] === now[key])
  );
}

/**
 * The agents control a Manager's row acts through, over `control`, the
 * window's agents control: none of the open task's own fields, so a row
 * holding a control from before a task opened (`sameForManagers`) acts
 * through what it would act through now.
 */
export function useManagerAgents(control: TaskAgentsControl): AgentsControl {
  const queryClient = useQueryClient();

  // Note that a Manager is read again by its own id before it is archived, because the window's control reads only the open task's agents.
  return useMemo(
    (): AgentsControl => ({
      ...placeAgents(control),
      agentIds: undefined,
      heldIds: undefined,
      draft: undefined,
      keywords: NO_KEYWORDS,
      readSkills: undefined,
      readAgent: (agentId: string) => readAgentById(queryClient, agentId),
    }),
    [control, queryClient],
  );
}
