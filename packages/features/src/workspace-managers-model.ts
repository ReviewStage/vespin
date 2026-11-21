/**
 * workspace-managers-model.ts -- the workspace's Managers as every client lists them: its unarchived agents of kind `manager` on no task, newest started first, and whether a Manager's chat said something the reader has not read.
 *
 * A Manager is an agent on no task that its workspace shares, which the live
 * task list carries beside the tasks' agents (`tasklessLiveParam`), so the
 * list is the listed agents narrowed to the workspace's unarchived Managers.
 * The desktop's sidebar (`@repo/panel`'s `workspace-managers.ts`) and the
 * iOS app's Tasks tab and Search list them alike from here.
 */

import { AGENT_KIND, type AgentSummary, type ListedAgent } from "./agent-wire.js";
import { readsUnread } from "./read-mark.js";

/** An agent as a list of Managers reads it: who it is, where, whether archived, and when it started. */
type ListedManager = Pick<
  ListedAgent,
  "id" | "kind" | "taskId" | "workspaceId" | "archivedAt" | "createdAt"
>;

/** Newest started first, and by id among those started at one instant. */
function newestFirst(a: ListedManager, b: ListedManager): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Whether `agent` is a Manager, an agent of kind `manager` on no task. */
export function isManager(agent: Pick<AgentSummary, "kind" | "taskId">): boolean {
  return agent.kind === AGENT_KIND.MANAGER && agent.taskId === null;
}

/** The unarchived Managers of `workspaceId` among `listed`, newest started first. */
export function workspaceManagersOf<Agent extends ListedManager>(
  listed: readonly Agent[],
  workspaceId: string,
): readonly Agent[] {
  return listed
    .filter(
      (agent) =>
        isManager(agent) && agent.workspaceId === workspaceId && agent.archivedAt === undefined,
    )
    .toSorted(newestFirst);
}

/** Whether a Manager's chat said something after the reader's mark of it (`read-mark.ts`); never a coder's, whose row carries no mark. */
export function managerChatUnread(
  agent: Pick<AgentSummary, "kind" | "saidAt" | "readThrough">,
): boolean {
  if (agent.kind !== AGENT_KIND.MANAGER || agent.saidAt === undefined) return false;

  return readsUnread(
    { ...(agent.readThrough === undefined ? undefined : { readThrough: agent.readThrough }) },
    agent.saidAt,
  );
}
