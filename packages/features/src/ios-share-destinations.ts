/**
 * ios-share-destinations.ts -- where a share may go in the workspace the phone works in, read from what the app's own lists read, for the share sheet's snapshot (`ios-share-wire.ts`).
 *
 * The share extension reads no host, so the app hands it, in its snapshot,
 * the places its composers send to: the workspace's Managers, as the Tasks
 * tab lists them (`workspaceManagersOf`); its open Inbox threads, from the
 * Inbox's own groups; its tasks still open; and the agents working on them.
 * Each kind is held newest moved first and cut at its bound
 * (`SHARE_DESTINATION_BOUNDS`), so the file stays small whatever the
 * account's size. Only rows of the workspace named are kept, and an agent
 * only where its task is one of the account's, so the snapshot never holds
 * a row the account's own reads did not hand it. A row says what names it,
 * never a live state such as whether an agent works, since the snapshot
 * stands until the app writes it again.
 */

import { AGENT_KIND, type ListedAgent } from "./agent-wire.js";
import {
  holderName,
  holderTask,
  holderWorkspaceId,
  type InboxAnyHolder,
  type InboxGroup,
} from "./inbox-list-model.js";
import { INBOX_STATUS } from "./inbox-wire.js";
import {
  SHARE_DESTINATION_BOUNDS,
  SHARE_DESTINATION_KIND,
  type ShareDestination,
  type ShareDestinations,
} from "./ios-share-wire.js";
import { agentName, providerOf } from "./model-label.js";
import { cardTitle } from "./plain-words.js";
import { agentLastMovedAt } from "./task-agents-model.js";
import { TASK_SETTLED, TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";
import { isManager } from "./workspace-managers-model.js";

/** A task as the destinations read it: a live read may hand its status as undefined where the summary leaves it out. */
type SourceTask = Pick<TaskSummary, "id" | "workspaceId" | "name" | "updatedAt"> & {
  readonly status?: TaskStatus | undefined;
};

/** What the destinations are read from: the workspace the phone works in, and the app's own lists. */
export interface ShareDestinationSource {
  readonly workspaceId: string;
  /** The task list's agents, every workspace's, the archived among them. */
  readonly agents: readonly ListedAgent[];
  /** The account's tasks, every workspace's. */
  readonly tasks: readonly SourceTask[];
  /** The Inbox's groups, each holder with its threads. */
  readonly inbox: readonly InboxGroup<InboxAnyHolder>[];
}

/** `words` cut to what a row keeps. */
function clipped(words: string): string {
  return words.slice(0, SHARE_DESTINATION_BOUNDS.MAX_NAME_CHARS);
}

/** Newest moved first. */
function newestFirst(a: ShareDestination, b: ShareDestination): number {
  return b.at - a.at;
}

/** A task's status, To do where its read named none, as its row draws it. */
function statusOf(task: SourceTask): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

/** The workspace's unarchived Managers. */
function managers(source: ShareDestinationSource): readonly ShareDestination[] {
  return source.agents.flatMap((agent) =>
    isManager(agent) && agent.workspaceId === source.workspaceId && agent.archivedAt === undefined
      ? [
          {
            kind: SHARE_DESTINATION_KIND.MANAGER,
            id: agent.id,
            name: clipped(agentName(agent)),
            ...(agent.face === undefined ? undefined : { face: agent.face }),
            at: agentLastMovedAt(agent),
          },
        ]
      : [],
  );
}

/** The workspace's unarchived agents on its tasks, each named with its task. */
function agents(
  source: ShareDestinationSource,
  tasks: ReadonlyMap<string, SourceTask>,
): readonly ShareDestination[] {
  return source.agents.flatMap((agent) => {
    const task = agent.taskId === null ? undefined : tasks.get(agent.taskId);

    if (
      task === undefined ||
      agent.kind === AGENT_KIND.MANAGER ||
      agent.workspaceId !== source.workspaceId ||
      agent.archivedAt !== undefined
    ) {
      return [];
    }

    const harness = providerOf(agent.model);

    return [
      {
        kind: SHARE_DESTINATION_KIND.AGENT,
        id: agent.id,
        name: clipped(agentName(agent)),
        task: clipped(task.name),
        ...(harness === undefined ? undefined : { harness }),
        at: agentLastMovedAt(agent),
      },
    ];
  });
}

/** The workspace's open Inbox threads, each with what holds it. */
function threads(source: ShareDestinationSource): readonly ShareDestination[] {
  return source.inbox.flatMap(({ holder, items }) => {
    if (holderWorkspaceId(holder) !== source.workspaceId) return [];
    const task = holderTask(holder);
    const face = "agent" in holder ? holder.agent.face : undefined;

    return items.flatMap((item) =>
      item.status === INBOX_STATUS.OPEN
        ? [
            {
              kind: SHARE_DESTINATION_KIND.THREAD,
              id: item.id,
              title: clipped(cardTitle(item.title)),
              agentId: item.agentId,
              holder: clipped(holderName(holder)),
              ...(task === undefined ? undefined : { holderStatus: statusOf(task) }),
              ...(face === undefined ? undefined : { holderFace: face }),
              at: item.updatedAt,
            },
          ]
        : [],
    );
  });
}

/** The workspace's tasks still open. */
function openTasks(tasks: readonly SourceTask[]): readonly ShareDestination[] {
  const settled: readonly TaskStatus[] = TASK_SETTLED;

  return tasks.flatMap((task) => {
    const status = statusOf(task);

    return settled.includes(status)
      ? []
      : [
          {
            kind: SHARE_DESTINATION_KIND.TASK,
            id: task.id,
            name: clipped(task.name),
            status,
            at: task.updatedAt,
          },
        ];
  });
}

/** The newest `bound` of `rows`, newest moved first. */
function newest(rows: readonly ShareDestination[], bound: number): readonly ShareDestination[] {
  return rows.toSorted(newestFirst).slice(0, bound);
}

/**
 * Where a share may go in `source.workspaceId`: its Managers, open Inbox
 * threads, open tasks, and agents on its tasks, each kind newest moved first
 * and cut at its bound, in that order.
 */
export function shareDestinationsOf(source: ShareDestinationSource): ShareDestinations {
  const own = source.tasks.filter((task) => task.workspaceId === source.workspaceId);
  const tasks = new Map(own.map((task) => [task.id, task]));
  const { MANAGERS, THREADS, TASKS, AGENTS } = SHARE_DESTINATION_BOUNDS;

  return {
    workspaceId: source.workspaceId,
    rows: [
      ...newest(managers(source), MANAGERS),
      ...newest(threads(source), THREADS),
      ...newest(openTasks(own), TASKS),
      ...newest(agents(source, tasks), AGENTS),
    ],
  };
}
