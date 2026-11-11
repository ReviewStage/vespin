/**
 * use-tasks.ts -- the Tasks tab as the app's screens read and act on it: the tree of the chosen workspace's tasks and what a search finds, each row's look, a task by its id or number with its agents, pages, description, and what waits on the reader, its status set, asking first where that stops agents, its pin and read mark, and the look opening it takes.
 *
 * What the tree holds, in what order, and what each row says are the
 * panel's own models (`@repo/features/task-tree-model`,
 * `task-agents-model`, `inbox-list-model`) read over the host's document;
 * this only reads them into the app's Query client, holds the live reads a
 * task's page shows followed while it shows them, and sends the panel's acts
 * on the host's port.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { waitsOnReaderNow } from "@repo/features/inbox-list-model";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import { READ_MARK, type ReadMark } from "@repo/features/read-mark";
import { searchTokens } from "@repo/features/search-tokens";
import {
  agentStillWriting,
  agentsOfTask,
  inAgentListOrder,
} from "@repo/features/task-agents-model";
import { ASSIGNED_TO, NO_REPOSITORY, TASKS_HEAD_WORDS } from "@repo/features/task-list-model";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import {
  searchedTasks,
  type TaskRowLook,
  type TaskTree,
  taskRowLook,
  taskTree,
} from "@repo/features/task-tree-model";
import {
  isTaskSettled,
  type Task,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import { type StopAgentsWords, settleStopWords } from "@repo/features/tasks-model";
import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  selectInboxGroupsIn,
  selectInboxReader,
  selectTasks,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";

/** No task list read yet. */
const NO_TASKS: AppStateSnapshot["tasks"]["tasks"] = [];

/** No holder of Inbox items read yet. */
const NO_GROUPS: ReturnType<ReturnType<typeof selectInboxGroupsIn>> = [];

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/** The workspace the phone works in, among the account's, as Settings chose it. */
export function useTasksWorkspace(): Workspace | undefined {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  return useChosenWorkspace(workspaces).chosen;
}

/** How many of the reader's threads wait on them, by the task holding them and by the agent that posted them, in the chosen workspace. */
export function useWaiting(workspaceId: string | undefined): {
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
      if (waiting.length > 0) byTask.set(holder.task.id, waiting.length);
    }
    return { byTask, byAgent };
  }, [groups, readerId]);
}

/** Sets a task's status, stopping its working agents with it where the reader confirmed that. */
type SetStatus = (taskId: string, status: TaskStatus, stopAgents?: true) => void;

/** Whether any of a task's agents is starting or running, read off the agents the list follows, else its row's count of them, as the panel reads it. */
function agentsWorkingIn(
  view: TasksView | undefined,
  tasks: readonly TaskSummary[],
): (taskId: string) => boolean {
  return (taskId) => {
    const listed = view?.taskAgents;
    if (listed !== undefined) {
      return agentsOfTask(listed, taskId).some((agent) => agentStillWriting(agent.status));
    }
    return (tasks.find((task) => task.id === taskId)?.agents?.working ?? 0) > 0;
  };
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
  readonly setStatus: SetStatus;
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
  const setStatus: SetStatus = (taskId, status, stopAgents) => {
    holdStatuses(new Map(heldStatuses).set(taskId, status));
    const letGo = () => holdStatuses(new Map([...heldStatuses].filter(([id]) => id !== taskId)));
    const stopping = stopAgents === undefined ? undefined : { stopAgents };
    acts[ACT_KIND.TASKS_SET_STANDING]({ taskId, status, ...stopping }).then(
      (landed) => {
        buzz(landed ? BUZZ.SUCCESS : BUZZ.ERROR);
        if (!landed) letGo();
      },
      (error: unknown) => {
        refused("The status")(error);
        buzz(BUZZ.ERROR);
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
  readonly setStatus: SetStatus;
  readonly agentsWorking: (taskId: string) => boolean;
  /** Marks a task unread by hand, or read, as the panel's Mark as unread and Mark as read do. */
  readonly markRead: (taskId: string, unread: boolean) => void;
  /** Pins a task to the list's Pinned group, or unpins it. */
  readonly pin: (taskId: string, pinned: boolean) => void;
  /** Puts a task in one of the member's sections, or under null in none, as the panel's Move to section does. */
  readonly place: (taskId: string, sectionId: string | null) => void;
  /** A task at a glance, as its row's preview draws it: how many of its threads wait on the reader, and its agents not archived, as its Overview lists them. */
  readonly glanceOf: (taskId: string) => TaskGlance;
}

/** A task at a glance: how many of its threads wait on the reader, and its agents not archived, in its Overview's order. */
export interface TaskGlance {
  readonly waiting: number;
  readonly agents: readonly ListedAgent[];
}

/** The agents not archived, by the task they work on, read once for every row. */
function agentsByTask(view: TasksView | undefined): ReadonlyMap<string, readonly ListedAgent[]> {
  const byTask = new Map<string, ListedAgent[]>();
  for (const agent of view?.taskAgents ?? []) {
    if (agent.archivedAt !== undefined) continue;
    const onTask = byTask.get(agent.planId);
    if (onTask === undefined) byTask.set(agent.planId, [agent]);
    else onTask.push(agent);
  }
  return byTask;
}

/** A task's agents not archived, in the order its Overview lists them: those waiting on the reader first. */
function taskAgentsInOrder(
  byTask: ReadonlyMap<string, readonly ListedAgent[]>,
  taskId: string,
  waitingByAgent: ReadonlyMap<string, number>,
): readonly ListedAgent[] {
  return inAgentListOrder(
    byTask.get(taskId) ?? [],
    (agent) => agent,
    (agent) => (waitingByAgent.get(agent.id) ?? 0) > 0,
  );
}

/**
 * The chosen workspace's tasks as the panel's phone Tasks lists them, under
 * `search` where one is typed, with each status a press set drawn at once;
 * every workspace's before the account's workspaces are read.
 */
export function useTasksListing(search: string): TasksListing {
  const acts = useHostActs();
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
    // Note that the host draws a mark and a pin on the row the moment they are asked, and puts either back where the service refused it.
    const markRead = (taskId: string, unread: boolean) => {
      const readMark = unread ? READ_MARK.UNREAD : READ_MARK.READ;
      acts[ACT_KIND.TASKS_MARK_READ]({ taskId, readMark }).catch(refused("The mark"));
    };
    // Note that a pin taps as a toggle does, lighter than a status's buzz, and a refused one buzzes as any refusal does.
    const pin = (taskId: string, pinned: boolean) => {
      acts[ACT_KIND.TASKS_PIN]({ taskId, pinned }).then(
        (landed) => buzz(landed ? BUZZ.SELECTION : BUZZ.ERROR),
        (error: unknown) => {
          refused("The pin")(error);
          buzz(BUZZ.ERROR);
        },
      );
    };
    // Note that the host draws the move on the list the moment it is asked, and puts it back where the service refused it.
    const place = (taskId: string, sectionId: string | null) => {
      acts[ACT_KIND.TASKS_WRITE_SECTION]({
        writes: [{ kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId }],
      }).then(
        (landed) => buzz(landed ? BUZZ.SUCCESS : BUZZ.ERROR),
        (error: unknown) => {
          refused("The move")(error);
          buzz(BUZZ.ERROR);
        },
      );
    };
    const agentsWorking = agentsWorkingIn(view, tasks);
    // Note that the agents are grouped by task once, since every row's preview reads its own.
    const byTask = agentsByTask(view);
    const glanceOf = (taskId: string): TaskGlance => ({
      waiting: waiting.byTask.get(taskId) ?? 0,
      agents: taskAgentsInOrder(byTask, taskId, waiting.byAgent),
    });
    return {
      tree,
      found,
      workspace,
      lookOf,
      setStatus,
      agentsWorking,
      markRead,
      pin,
      place,
      glanceOf,
    };
  }, [acts, listed, held, view, workspace, readerId, waiting, search]);
}

/** One agent on a task as its row draws it: the agent, how many of its threads wait on the reader, and the pull request it opened. */
export interface TaskAgentLine {
  readonly agent: ListedAgent;
  readonly waiting: number;
  readonly pullRequest:
    | NonNullable<AppStateSnapshot["tasks"]["agentPullRequests"]>[number]["pullRequest"]
    | undefined;
}

/** An agent's line: how many of its threads wait on the reader, and the pull request the document holds for it. */
export function agentLine(
  agent: ListedAgent,
  waitingByAgent: ReadonlyMap<string, number>,
  view: AppStateSnapshot["tasks"] | undefined,
): TaskAgentLine {
  return {
    agent,
    waiting: waitingByAgent.get(agent.id) ?? 0,
    pullRequest: view?.agentPullRequests?.find((each) => each.agentId === agent.id)?.pullRequest,
  };
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
  readonly setStatus: SetStatus;
  readonly agentsWorking: (taskId: string) => boolean;
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
    const agents = taskAgentsInOrder(agentsByTask(view), task.id, waiting.byAgent).map((agent) =>
      agentLine(agent, waiting.byAgent, view),
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
      agentsWorking: agentsWorkingIn(view, listed),
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

/**
 * Marks the task read as it opens and seen as it is left, as the panel's
 * window does (`useTaskLooks`), so a dot the phone draws is one the phone
 * clears. Note that each look goes quietly, whatever comes back, since no
 * person pressed for it.
 */
export function useTaskReadOnOpen(taskId: string | undefined): void {
  const acts = useHostActs();
  useEffect(() => {
    if (taskId === undefined) return;
    const look = (readMark: ReadMark) => {
      acts[ACT_KIND.TASKS_MARK_READ]({ taskId, readMark }).catch(refused("The look"));
    };
    look(READ_MARK.READ);
    return () => look(READ_MARK.SEEN);
  }, [acts, taskId]);
}

/** A status held for its question while the task's agents work, kept past its answer so the alert keeps its words as it goes. */
interface HeldStatus {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly words: StopAgentsWords;
  readonly presented: boolean;
}

/** What a question asks before it is asked, which no reader sees. */
const NO_WORDS: StopAgentsWords = { title: "", body: "", verb: "" };

/** The question a status asks first, whether it stands, and its two answers. */
export interface StatusQuestion {
  readonly words: StopAgentsWords;
  readonly presented: boolean;
  /** Sets the status and stops the task's agents with it. */
  readonly confirm: () => void;
  readonly dismiss: () => void;
}

/**
 * Sets a task's status as the panel does (`useStandingWrites`): Done or
 * Canceled on a task whose agents are working asks first, since it stops
 * them and the work they are in the middle of, and goes out confirmed as a
 * settle that stops them; anything else goes out at once. Answers the
 * asking `setStatus` and its question, which the screen draws.
 */
export function useStatusAsk(doors: Pick<TasksListing, "setStatus" | "agentsWorking">): {
  readonly setStatus: (taskId: string, status: TaskStatus) => void;
  readonly question: StatusQuestion;
} {
  const [held, setHeld] = useState<HeldStatus>();
  const setStatus = (taskId: string, status: TaskStatus) => {
    if (isTaskSettled(status) && doors.agentsWorking(taskId)) {
      setHeld({ taskId, status, words: settleStopWords(status), presented: true });
      return;
    }
    doors.setStatus(taskId, status);
  };
  const letGo = () => setHeld((was) => (was === undefined ? was : { ...was, presented: false }));
  const question: StatusQuestion = {
    words: held?.words ?? NO_WORDS,
    presented: held?.presented === true,
    confirm: () => {
      if (held === undefined || !held.presented) return;
      letGo();
      doors.setStatus(held.taskId, held.status, true);
    },
    dismiss: letGo,
  };
  return { setStatus, question };
}
