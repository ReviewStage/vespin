/**
 * use-managers.ts -- the chosen workspace's Managers as the Tasks tab and Search list them, and the reader's looks at a Manager's chat while its page stands open.
 *
 * A Manager is an agent on no task that its workspace shares, which the
 * task list's live read carries beside the tasks' agents, so the list is
 * the host's listed agents narrowed to the workspace's unarchived Managers,
 * newest started first (`@repo/features/workspace-managers-model`), as the
 * desktop's sidebar lists them. It stands only where the workspace has the
 * Managers experiment on, as the sidebar's does, and moves as the live read
 * hears a Manager made, renamed, archived, or at work.
 */

import { AGENT_KIND, type ListedAgent } from "@repo/features/agent-wire";
import { READ_MARK, type ReadMark } from "@repo/features/read-mark";
import { workspaceManagersOf } from "@repo/features/workspace-managers-model";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaceExperiment } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useListedAgents } from "../host/host-provider.js";

/** No Manager, the same array every render. */
const NO_MANAGERS: readonly ListedAgent[] = [];

/** Says on the console a look the host refused, which the next delivery of the document corrects. */
function lookRefused(cause: unknown): void {
  console.error("The look at a Manager's chat did not go.", cause);
}

/** Whether `workspaceId` has the Managers experiment on, which every place that lists or finds a Manager asks. */
export function useManagersListed(workspaceId: string | undefined): boolean {
  const { data: listed = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(workspaceId, EXPERIMENT.MANAGERS),
  });

  return listed;
}

/** The unarchived Managers of `workspaceId`, newest started first; none while it has the Managers experiment off. */
export function useWorkspaceManagers(workspaceId: string | undefined): readonly ListedAgent[] {
  const listed = useManagersListed(workspaceId);
  const agents = useListedAgents();

  return useMemo(
    () =>
      !listed || workspaceId === undefined ? NO_MANAGERS : workspaceManagersOf(agents, workspaceId),
    [listed, workspaceId, agents],
  );
}

/**
 * Moves the reader's mark of a Manager's chat while its page stands open, as
 * the panel's page does (`manager-chat-looks.ts`): read through as it opens,
 * seen as it is left, and seen again whenever the chat says something while
 * it stands open, so the unread dot its row draws is one the phone clears.
 * Nothing for an agent that is no Manager. Note that each look goes
 * quietly, whatever comes back, since no person pressed for it.
 */
export function useManagerChatLooks(
  agent: Pick<ListedAgent, "id" | "kind" | "saidAt"> | undefined,
): void {
  const acts = useHostActs();
  const agentId = agent?.kind === AGENT_KIND.MANAGER ? agent.id : undefined;
  const saidAt = agent?.saidAt;

  useEffect(() => {
    if (agentId === undefined) return;

    const look = (readMark: ReadMark) => {
      acts[ACT_KIND.AGENTS_MARK_READ]({ agentId, readMark }).catch(lookRefused);
    };

    look(READ_MARK.READ);

    return () => look(READ_MARK.SEEN);
  }, [acts, agentId]);

  // Note that what the chat said as the page opened is read by the look opening it, so only a message during the stay is a look of its own.
  const seen = useRef<{ agentId: string; saidAt: number | undefined } | undefined>(undefined);

  useEffect(() => {
    const was = seen.current;
    seen.current = agentId === undefined ? undefined : { agentId, saidAt };

    if (agentId === undefined || was?.agentId !== agentId || was.saidAt === saidAt) return;

    acts[ACT_KIND.AGENTS_MARK_READ]({ agentId, readMark: READ_MARK.SEEN }).catch(lookRefused);
  }, [acts, agentId, saidAt]);
}
