/**
 * workspace-managers-model.ts -- the workspace's Managers as every client lists them: its unarchived agents of kind `manager` on no task, newest started first, and whether a Manager's chat said something the reader has not read.
 *
 * A Manager is an agent on no task that its workspace shares, which the live
 * task list carries beside the tasks' agents (`tasklessLiveParam`), so the
 * list is the listed agents narrowed to the workspace's unarchived Managers.
 * The desktop's sidebar (`@repo/panel`'s `workspace-managers.ts`) and the
 * iOS app's Tasks tab and Search list them alike from here. A reader may
 * sort them otherwise (`MANAGER_SORT`, `sortedManagers`): by when each last
 * moved, by name, or by when each was started, the default. The ones the
 * reader pinned stand under Pinned instead (`pinnedManagersOf`), each where
 * its pin stands.
 */

import { AGENT_KIND, type AgentSummary, type ListedAgent } from "./agent-wire.js";
import { inPinOrder, type PinPlace } from "./pin-order.js";
import { readsUnread } from "./read-mark.js";
import { agentLastMovedAt } from "./task-agents-model.js";
import type { TaskAgentPin } from "./task-wire.js";

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

/** How a list of Managers is sorted: by when each last moved, by name, or newest started first. */
export const MANAGER_SORT = {
  RECENT_ACTIVITY: "recent-activity",
  NAME: "name",
  CREATED: "created",
} as const;

export type ManagerSort = (typeof MANAGER_SORT)[keyof typeof MANAGER_SORT];

/** What a list of Managers is sorted by where the reader chose nothing: newest started first, as it always stood. */
export const DEFAULT_MANAGER_SORT: ManagerSort = MANAGER_SORT.CREATED;

/** An agent as a sorted list of Managers reads it: when it started and last moved, and its name. */
type SortedManager = ListedManager &
  Pick<ListedAgent, "title" | "status" | "runStartedAt" | "settledAt">;

/** By name, ignoring case and accents, then newest started first among those named alike. */
function byName(a: SortedManager, b: SortedManager): number {
  const named = (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" });

  return named !== 0 ? named : newestFirst(a, b);
}

/** Moved last first, then newest started first among those that moved at one instant. */
function lastMovedFirst(a: SortedManager, b: SortedManager): number {
  const moved = agentLastMovedAt(b) - agentLastMovedAt(a);

  return moved !== 0 ? moved : newestFirst(a, b);
}

/** `managers` sorted as `sort` says. */
export function sortedManagers<Agent extends SortedManager>(
  managers: readonly Agent[],
  sort: ManagerSort,
): readonly Agent[] {
  switch (sort) {
    case MANAGER_SORT.RECENT_ACTIVITY:
      return managers.toSorted(lastMovedFirst);
    case MANAGER_SORT.NAME:
      return managers.toSorted(byName);
    case MANAGER_SORT.CREATED:
      return managers.toSorted(newestFirst);
  }
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

/** Whether a Manager's chat reads unread for the reader (`read-mark.ts`): marked so by hand (Mark as unread), or said something after their mark of it; never a coder's, whose row carries no mark. */
export function managerChatUnread(
  agent: Pick<AgentSummary, "kind" | "saidAt" | "readThrough" | "markedUnread">,
): boolean {
  if (agent.kind !== AGENT_KIND.MANAGER) return false;

  if (agent.markedUnread === true) return true;

  if (agent.saidAt === undefined) return false;

  return readsUnread(
    { ...(agent.readThrough === undefined ? undefined : { readThrough: agent.readThrough }) },
    agent.saidAt,
  );
}

/** A Manager the reader pinned, and where its pin stands among the reader's other pins. */
export interface PinnedManager<Agent extends AgentSummary = ListedAgent> {
  readonly agent: Agent;
  readonly place: PinPlace;
}

/**
 * The Managers of `managers` the reader pinned, by `pins`, the reader's pins
 * of agents, each with where its pin stands, in the order Pinned stands its
 * pins: those dragged to a place by it, then the rest newest pinned first
 * (`pin-order.ts`).
 */
export function pinnedManagersOf<Agent extends AgentSummary>(
  managers: readonly Agent[],
  pins: readonly TaskAgentPin[],
): readonly PinnedManager<Agent>[] {
  const byId = new Map(managers.map((agent) => [agent.id, agent]));

  const pinned = pins.flatMap((pin): PinnedManager<Agent>[] => {
    const agent = pin.taskId === null ? byId.get(pin.agentId) : undefined;

    return agent === undefined
      ? []
      : [{ agent, place: { at: pin.pinnedAt, position: pin.pinPosition } }];
  });

  return inPinOrder(pinned, (each) => each.place);
}
