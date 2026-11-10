/**
 * use-tasks.ts -- the Tasks tab as the app's screens read and act on it: the tree of the chosen workspace's tasks and what a search finds, each row's look, a task by its id or number with its agents, pages, description, and what waits on the reader, and its status set.
 *
 * What the tree holds, in what order, and what each row says are the
 * panel's own models (`@repo/features/task-tree-model`,
 * `task-agents-model`, `inbox-list-model`) read over the host's document;
 * this only reads them into the app's Query client, holds the live reads a
 * task's page shows followed while it shows them, and sends the panel's acts
 * on the host's port.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { INBOX_HOLDER, waitsOnReaderNow } from "@repo/features/inbox-list-model";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import { searchTokens } from "@repo/features/search-tokens";
import { inAgentListOrder } from "@repo/features/task-agents-model";
import { ASSIGNED_TO, NO_REPOSITORY, TASKS_HEAD_WORDS } from "@repo/features/task-list-model";
import {
  searchedTasks,
  type TaskRowLook,
  type TaskTree,
  taskRowLook,
  taskTree,
} from "@repo/features/task-tree-model";
import type { Task, TaskStatus, TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  selectInboxGroupsIn,
  selectInboxReader,
  selectTasks,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";

/** No task list read yet. */
const NO_TASKS: AppStateSnapshot["tasks"]["tasks"] = [];

/** No holder of Inbox items read yet. */
const NO_GROUPS: ReturnType<ReturnType<typeof selectInboxGroupsIn>> = [];

/** A follow as the act port answers it: a stream that carries nothing until it is let go. */
type OpenedFollow = AsyncIteratorObject<unknown, unknown, unknown>;

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/**
 * Holds the follow `open` opens for as long as the screen holds `key`, as
 * the panel holds a live read while its query is active
 * (`@repo/panel`'s `live-reads.ts`): the host follows the read and writes
 * it into the document, which the screen reads. Nothing while `key` is none.
 */
function useLiveFollow(key: string | undefined, open: (key: string) => Promise<OpenedFollow>) {
  // Note that only the key moves the follow, since `open` is made anew on each draw.
  useEffect(() => {
    if (key === undefined) return;
    let held = true;
    let stream: OpenedFollow | undefined;
    const drain = async (opened: OpenedFollow) => {
      stream = opened;
      if (!held) {
        await opened.return?.();
        return;
      }
      for await (const _ of opened) {
        if (!held) break;
      }
    };
    open(key).then(drain).catch(refused("Following a live read"));
    return () => {
      held = false;
      stream?.return?.().catch(refused("Letting a live read go"));
    };
  }, [key]);
}

/** The workspace the phone works in, among the account's, as Settings chose it. */
function useTasksWorkspace(): Workspace | undefined {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  return useChosenWorkspace(workspaces).chosen;
}

/** How many of the reader's threads wait on them, by the task holding them and by the agent that posted them, in the chosen workspace. */
function useWaiting(workspaceId: string | undefined): {
  readonly byTask: ReadonlyMap<string, number>;
  readonly byAgent: ReadonlyMap<string, number>;
} {
  const { data: groups = NO_GROUPS } = useQuery({
    ...appStateQuery,
    select: selectInboxGroupsIn(workspaceId),
  });
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  return useMemo(() => {
    const now = Date.now();
    const byTask = new Map<string, number>();
    const byAgent = new Map<string, number>();
    for (const { holder, items } of groups) {
      const waiting = items.filter((item) => waitsOnReaderNow(item, readerId, now));
      for (const item of waiting) byAgent.set(item.agentId, (byAgent.get(item.agentId) ?? 0) + 1);
      if (holder.kind === INBOX_HOLDER.TASK && waiting.length > 0) {
        byTask.set(holder.task.id, waiting.length);
      }
    }
    return { byTask, byAgent };
  }, [groups, readerId]);
}

/** A status a press set and the service has not yet drawn, by the task, as the panel draws a row's write before its answer. */
type HeldStatuses = ReadonlyMap<string, TaskStatus>;

/** The statuses pressed and not yet drawn, which every screen reads. */
let heldStatuses: HeldStatuses = new Map();

/** The screens reading them, each told as one is pressed or let go. */
const statusReaders = new Set<() => void>();

function holdStatuses(next: HeldStatuses): void {
  heldStatuses = next;
  for (const reader of statusReaders) reader();
}

function watchStatuses(reader: () => void): () => void {
  statusReaders.add(reader);
  return () => {
    statusReaders.delete(reader);
  };
}

/** The tasks as the screens draw them: each with the status a press set over the one the document holds. */
function withHeld(tasks: readonly TaskSummary[], held: HeldStatuses): readonly TaskSummary[] {
  if (held.size === 0) return tasks;
  return tasks.map((task) => {
    const status = held.get(task.id);
    return status === undefined ? task : { ...task, status };
  });
}

/**
 * The statuses a press set, drawn at once on every screen as the panel draws
 * its row write (`ROW_WRITE.TASK_STANDING`), each sent as the panel sends it
 * (`TASKS_SET_STANDING`), and let go where the host refuses it, so the row
 * stands as it did; one the document has since drawn is dropped too.
 */
function useStatusWrites(tasks: readonly TaskSummary[]): {
  readonly held: HeldStatuses;
  readonly setStatus: (taskId: string, status: TaskStatus) => void;
} {
  const acts = useHostActs();
  const held = useSyncExternalStore(watchStatuses, () => heldStatuses);
  // A status the document now holds is its own, and stands without the press's.
  useEffect(() => {
    const drawn = [...held].filter(([id, status]) =>
      tasks.some((task) => task.id === id && task.status === status),
    );
    if (drawn.length === 0) return;
    holdStatuses(new Map([...heldStatuses].filter(([id]) => !drawn.some(([at]) => at === id))));
  }, [tasks, held]);
  const setStatus = (taskId: string, status: TaskStatus) => {
    holdStatuses(new Map(heldStatuses).set(taskId, status));
    const letGo = () => holdStatuses(new Map([...heldStatuses].filter(([id]) => id !== taskId)));
    acts[ACT_KIND.TASKS_SET_STANDING]({ taskId, status }).then(
      (landed) => {
        if (!landed) letGo();
      },
      (error: unknown) => {
        refused("The status")(error);
        letGo();
      },
    );
  };
  return { held, setStatus };
}

/** What the Tasks tab draws: the tree, what a search finds, each row's look, and the acts on a row. */
export interface TasksListing {
  readonly tree: TaskTree;
  /** The workspace's tasks the search finds, whatever their status; none while nothing is typed. */
  readonly found: readonly TaskSummary[];
  readonly workspace: Workspace | undefined;
  readonly lookOf: (task: TaskSummary) => TaskRowLook;
  readonly setStatus: (taskId: string, status: TaskStatus) => void;
}

/**
 * The chosen workspace's tasks as the panel's phone Tasks lists them, under
 * `search` where one is typed, with each status a press set drawn at once;
 * every workspace's before the account's workspaces are read.
 */
export function useTasksListing(search: string): TasksListing {
  const workspace = useTasksWorkspace();
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const waiting = useWaiting(workspace?.id);
  const listed = view?.tasks ?? NO_TASKS;
  const { held, setStatus } = useStatusWrites(listed);
  return useMemo(() => {
    const tasks = withHeld(listed, held);
    const tree = taskTree({
      view: { tasks, taskSections: view?.taskSections, repositoryPins: view?.repositoryPins },
      workspaceId: workspace?.id,
      readerId,
      noRepository: NO_REPOSITORY,
      tasksHead: TASKS_HEAD_WORDS[ASSIGNED_TO.ME],
    });
    const found = searchedTasks({
      tasks,
      workspaceId: workspace?.id,
      workspaceName: workspace?.name,
      tokens: searchTokens(search),
    });
    const lookOf = (task: TaskSummary) =>
      taskRowLook(task, waiting.byTask.get(task.id) ?? 0, view?.taskPullRequests);
    return { tree, found, workspace, lookOf, setStatus };
  }, [listed, held, view, workspace, readerId, waiting, search]);
}

/** One agent on a task as its row draws it: the agent, how many of its threads wait on the reader, and the pull request it opened. */
interface TaskAgentLine {
  readonly agent: ListedAgent;
  readonly waiting: number;
  readonly pullRequest:
    | NonNullable<AppStateSnapshot["tasks"]["agentPullRequests"]>[number]["pullRequest"]
    | undefined;
}

/** A task's page as the screen draws it: the task, its description where it is read, its agents, its pages, and what waits on the reader. */
export interface TaskOverview {
  readonly task: TaskSummary;
  /** Its whole document, where the host has read it: its description and the tasks it waits on and holds up. */
  readonly document: Task | undefined;
  readonly workspace: Workspace | undefined;
  readonly agents: readonly TaskAgentLine[];
  readonly pages: readonly PageLine[];
  /** How many of its threads wait on the reader whose agent no row lists, which its Inbox line counts. */
  readonly waitingElsewhere: number;
  /** Every task of the workspace, which its relations name. */
  readonly tasks: readonly TaskSummary[];
  readonly setStatus: (taskId: string, status: TaskStatus) => void;
}

/** Whether a link's word names the task: its id, or its number as a task link spells one. */
function namesTask(task: TaskSummary, named: string): boolean {
  return task.id === named || (task.number !== undefined && String(task.number) === named);
}

/**
 * One task by its id or its number, as a link names it, with all its page
 * shows, its description and pages followed while the page stands, as the
 * panel's Overview follows them (`TASKS_DOCUMENT_FOLLOW`, `TASKS_PAGES_FOLLOW`);
 * none where the list holds no such task.
 */
export function useTaskOverview(named: string | undefined): TaskOverview | undefined {
  const acts = useHostActs();
  const workspace = useTasksWorkspace();
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const waiting = useWaiting(workspace?.id);
  const { held: statuses, setStatus } = useStatusWrites(view?.tasks ?? NO_TASKS);
  const listed = useMemo(() => withHeld(view?.tasks ?? NO_TASKS, statuses), [view, statuses]);
  const task = named === undefined ? undefined : listed.find((each) => namesTask(each, named));
  const taskId = task?.id;
  useLiveFollow(taskId, (id) => acts[ACT_KIND.TASKS_DOCUMENT_FOLLOW]({ taskId: id }));
  useLiveFollow(taskId, (id) => acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }));
  const { data: held } = useQuery({
    ...appStateQuery,
    select: (state) =>
      taskId === undefined
        ? undefined
        : {
            document: state[LIVE_READ.DESCRIPTION_DOCUMENT][taskId]?.rows,
            pages: state[LIVE_READ.PAGES][PAGE_OWNER.TASK][taskId]?.rows,
          },
  });
  return useMemo(() => {
    if (task === undefined) return undefined;
    const onTask = (view?.taskAgents ?? []).filter(
      (agent) => agent.planId === task.id && agent.archivedAt === undefined,
    );
    const agents = inAgentListOrder(
      onTask,
      (agent) => agent,
      (agent) => (waiting.byAgent.get(agent.id) ?? 0) > 0,
    ).map(
      (agent): TaskAgentLine => ({
        agent,
        waiting: waiting.byAgent.get(agent.id) ?? 0,
        pullRequest: view?.agentPullRequests?.find((each) => each.agentId === agent.id)
          ?.pullRequest,
      }),
    );
    const listedWaiting = agents.reduce((sum, line) => sum + line.waiting, 0);
    const document = held?.document;
    return {
      task,
      document: document !== undefined && "task" in document ? document.task : undefined,
      workspace,
      agents,
      pages: held?.pages ?? [],
      waitingElsewhere: Math.max(0, (waiting.byTask.get(task.id) ?? 0) - listedWaiting),
      tasks: listed,
      setStatus,
    };
  }, [task, view, waiting, held, workspace, listed]);
}

/** Whether the host has read the task list once, so a task it does not hold is one that is not there rather than one still on its way. */
export function useTasksRead(): boolean {
  const { data: status } = useQuery({
    ...appStateQuery,
    select: (state) => state.tasks.listStatus,
  });
  return status === TASKS_READ.READY;
}
