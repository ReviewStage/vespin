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
import { LINK_DESTINATION, taskNumberOf } from "@repo/features/link-grammar";
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
import { TASK_SECTION_WRITE, type TaskSection } from "@repo/features/task-section-wire";
import {
  NO_TASK_SECTIONS,
  placeWrites,
  SECTION_WRITE_FAILED_NOTE,
  sectionOfTask,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "@repo/features/task-sections-model";
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
import {
  DELETE_FAILED_NOTE,
  deleteTaskWords,
  MARK_FAILED_NOTES,
  RENAME_FAILED_NOTE,
  repositoryChangeFailureNote,
  type StopAgentsWords,
  settleFailedNote,
  settleStopWords,
  TASK_MARK,
} from "@repo/features/tasks-model";
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
import { BUZZ } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";
import { type TaskRelationWrites, useTaskRelationWrites } from "./use-relations.js";
import { useWorkspaceRepositories } from "./use-start.js";

/** No task list read yet. */
const NO_TASKS: AppStateSnapshot["tasks"]["tasks"] = [];

/** No holder of Inbox items read yet. */
const NO_GROUPS: ReturnType<ReturnType<typeof selectInboxGroupsIn>> = [];

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (cause: unknown) => void {
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

type UseStatusWritesResult = {
  readonly held: HeldStatuses;
  readonly setStatus: SetStatus;
};

/**
 * The statuses a press set, drawn at once on every screen as the panel draws
 * its row write (`ROW_WRITE.TASK_STANDING`), each sent as the panel sends it
 * (`TASKS_SET_STANDING`), and let go where the host refuses it, so the row
 * stands as it did; one the document has since drawn is dropped too.
 */
function useStatusWrites(tasks: readonly TaskSummary[]): UseStatusWritesResult {
  const acts = useHostActs();
  const write = useWrite();
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
    const letGo = () => holdStatuses(new Map([...heldStatuses].filter(([id]) => id !== taskId)));
    const stopping = stopAgents === undefined ? undefined : { stopAgents };
    // Note that each attempt, Try again's among them, draws the status before it sends it and lets it go once it is not kept.
    write(
      () => {
        holdStatuses(new Map(heldStatuses).set(taskId, status));

        return acts[ACT_KIND.TASKS_SET_STANDING]({ taskId, status, ...stopping }).then(
          (landed) => {
            if (!landed) letGo();

            return landed;
          },
          (cause: unknown) => {
            letGo();
            throw cause;
          },
        );
      },
      {
        refused: (landed) => (landed ? undefined : settleFailedNote(status, 1)),
        retry: true,
        subject: { kind: WRITE_SUBJECT.TASK_STATUS, id: taskId },
        went: BUZZ.SUCCESS,
      },
    );
  };

  return { held, setStatus };
}

/** A task's rename and its delete, as the panel's menu sends them. */
export interface TaskWrites {
  /** Renames a task, as the panel's Rename does (`TASKS_RENAME`): the host draws the name at once and puts it back where the service refused it. */
  readonly rename: (taskId: string, name: string) => void;
  /** Deletes a task for good, as the panel's Permanently delete does once asked (`TASKS_DELETE`), the host taking its row at once. */
  readonly remove: (taskId: string) => void;
}

/** A task's rename and delete, sent on the host's port. */
export function useTaskWrites(): TaskWrites {
  const acts = useHostActs();
  const write = useWrite();

  return useMemo(
    () => ({
      rename: (taskId, name) => {
        write(() => acts[ACT_KIND.TASKS_RENAME]({ taskId, name }), {
          refused: (landed) => (landed ? undefined : RENAME_FAILED_NOTE),
          unanswered: RENAME_FAILED_NOTE,
          retry: true,
          subject: { kind: WRITE_SUBJECT.TASK_NAME, id: taskId },
          went: BUZZ.SUCCESS,
        });
      },
      remove: (taskId) => {
        write(() => acts[ACT_KIND.TASKS_DELETE]({ taskId }), {
          refused: (landed) => (landed ? undefined : DELETE_FAILED_NOTE),
          unanswered: DELETE_FAILED_NOTE,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
    }),
    [acts, write],
  );
}

/** Where a task stands in the member's sections and which repository it works in, with the writes that move either, as a task's menus offer them. */
export interface TaskPlacing {
  /** The member's sections of the workspace, in the order the list draws them. */
  readonly sections: readonly TaskSection[];
  /** The section the member keeps a task in, a pinned task's stored entry among them; none where it is in none. */
  readonly sectionOf: (taskId: string) => string | undefined;
  /** Puts a task on top of a section, or takes it out of every section under null, as the panel's Move to section does. */
  readonly moveToSection: (taskId: string, sectionId: string | null) => void;
  /** The repositories the workspace's GitHub reaches, which a task's repository is picked among. */
  readonly repositories: readonly string[];
  /** Gives a task its repository, or takes it away under null, as the panel's Change repository does. */
  readonly setRepository: (taskId: string, repository: string | null) => void;
}

/**
 * A workspace's sections and repositories, the repositories followed while
 * the screen stands, and the writes that move a task among them: a section
 * move as the panel's Move to section sends it, on top of the section
 * (`placeWrites`) or out of every one (`unplaceAllWrites`), which the host
 * draws at once and puts back where the service refused it; and a
 * repository set as the panel's Change repository sends it
 * (`TASKS_SET_REPOSITORY`), drawn as the service answers it, a refusal
 * said in the panel's words for it.
 */
export function useTaskPlacing(workspaceId: string | undefined): TaskPlacing {
  const acts = useHostActs();
  const write = useWrite();

  const { data: state = NO_TASK_SECTIONS } = useQuery({
    ...appStateQuery,
    select: (snapshot) => snapshot.tasks.taskSections ?? NO_TASK_SECTIONS,
  });

  const { listed } = useWorkspaceRepositories(workspaceId);

  return useMemo(() => {
    const moveToSection = (taskId: string, sectionId: string | null) => {
      const [first, ...rest] =
        sectionId === null
          ? unplaceAllWrites([taskId])
          : placeWrites(sectionOrder(state, sectionId), taskId, sectionId, 0, Date.now());

      if (first === undefined) return;
      // Note that Try again is offered only where the move writes this task alone, because a batch that also places its neighbors would put back one the member has since moved.
      const alone = rest.every((each) => "taskId" in each && each.taskId === taskId);
      void write(() => acts[ACT_KIND.TASKS_WRITE_SECTION]({ writes: [first, ...rest] }), {
        refused: (landed) => (landed ? undefined : SECTION_WRITE_FAILED_NOTE),
        retry: alone,
        subject: { kind: WRITE_SUBJECT.TASK_SECTION, id: taskId },
        went: BUZZ.SUCCESS,
      });
    };

    const setRepository = (taskId: string, repository: string | null) => {
      void write(() => acts[ACT_KIND.TASKS_SET_REPOSITORY]({ taskId, repository }), {
        refused: (answer) =>
          "failure" in answer ? repositoryChangeFailureNote(answer.failure) : undefined,
        retry: true,
        subject: { kind: WRITE_SUBJECT.TASK_REPOSITORY, id: taskId },
        went: BUZZ.SUCCESS,
      });
    };

    return {
      sections: workspaceId === undefined ? [] : workspaceSections(state, workspaceId),
      sectionOf: (taskId: string) => sectionOfTask(state, taskId),
      moveToSection,
      repositories: listed,
      setRepository,
    };
  }, [acts, write, state, workspaceId, listed]);
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
  /** The section the member keeps a task in, as the stored entries hold it, a pinned task's among them; none where it is in none. */
  readonly sectionOf: (taskId: string) => string | undefined;
  /** Puts a task in one of the member's sections, or under null in none, as the panel's Move to section does, answering whether the service took it. */
  readonly place: (taskId: string, sectionId: string | null) => Promise<boolean>;
  readonly rename: TaskWrites["rename"];
  /** Asks first whether to delete a task for good, as the panel's Permanently delete does. */
  readonly askDelete: (task: TaskSummary) => void;
  /** A task at a glance, as its row's preview draws it: how many of its threads wait on the reader, and its agents not archived, as its Overview lists them. */
  readonly glanceOf: (taskId: string) => TaskGlance;
  /** The workspace's sections and repositories, and the writes that move a task among them. */
  readonly placing: TaskPlacing;
  /** The writes that relate a task to another, change how it stands, or take it out from under its parent. */
  readonly relations: TaskRelationWrites;
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

/** The listing as it is read, before the screen that draws it holds the questions its acts ask first. */
export type ReadListing = Omit<TasksListing, "askDelete">;

/**
 * The chosen workspace's tasks as the panel's phone Tasks lists them, under
 * `search` where one is typed, with each status a press set drawn at once;
 * every workspace's before the account's workspaces are read.
 */
export function useTasksListing(search: string): ReadListing {
  const acts = useHostActs();
  const write = useWrite();
  const workspace = useTasksWorkspace();
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const waiting = useWaiting(workspace?.id);
  const listed = view?.tasks ?? NO_TASKS;
  const { held, setStatus } = useStatusWrites(listed);
  const { rename } = useTaskWrites();
  const placing = useTaskPlacing(workspace?.id);
  const relations = useTaskRelationWrites();

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
      write(() => acts[ACT_KIND.TASKS_MARK_READ]({ taskId, readMark }), {
        retry: true,
        subject: { kind: WRITE_SUBJECT.TASK_READ, id: taskId },
      });
    };

    // Note that a pin taps as a toggle does, lighter than a status's buzz.
    const pin = (taskId: string, pinned: boolean) => {
      write(() => acts[ACT_KIND.TASKS_PIN]({ taskId, pinned }), {
        refused: (landed) =>
          landed ? undefined : MARK_FAILED_NOTES[pinned ? TASK_MARK.PIN : TASK_MARK.UNPIN],
        retry: true,
        subject: { kind: WRITE_SUBJECT.TASK_PIN, id: taskId },
        went: BUZZ.SELECTION,
      });
    };

    // Note that the host draws the move on the list the moment it is asked, and puts it back where the service refused it, which the failure notice says.
    const place = (taskId: string, sectionId: string | null) =>
      write(
        () =>
          acts[ACT_KIND.TASKS_WRITE_SECTION]({
            writes: [{ kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId }],
          }),
        {
          refused: (landed) => (landed ? undefined : SECTION_WRITE_FAILED_NOTE),
          // Note that the move offers no Try again, but voids an older menu move's, which would put the task back.
          subject: { kind: WRITE_SUBJECT.TASK_SECTION, id: taskId },
          went: BUZZ.SUCCESS,
        },
      );

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
      sectionOf: (taskId: string) => sectionOfTask(view?.taskSections ?? NO_TASK_SECTIONS, taskId),
      rename,
      glanceOf,
      placing,
      relations,
    };
  }, [
    acts,
    write,
    listed,
    held,
    view,
    workspace,
    readerId,
    waiting,
    search,
    rename,
    placing,
    relations,
  ]);
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
  /** Reads its document again, as the panel's Try again does (`TASKS_DOCUMENT_RETRY`), where its read failed and none is held; none otherwise. */
  readonly documentRetry: (() => void) | undefined;
  readonly workspace: Workspace | undefined;
  readonly agents: readonly TaskAgentLine[];
  readonly pages: readonly PageLine[];
  /** How many of its threads wait on the reader whose agent no row lists, which its Inbox line counts. */
  readonly waitingElsewhere: number;
  /** Every task of the workspace, which its relations name. */
  readonly tasks: readonly TaskSummary[];
  readonly setStatus: SetStatus;
  readonly agentsWorking: (taskId: string) => boolean;
  readonly rename: TaskWrites["rename"];
  /** Its workspace's sections and repositories, and the writes that move it among them. */
  readonly placing: TaskPlacing;
  /** The writes that relate it to another task, change how one stands to it, or take it out from under its parent. */
  readonly relations: TaskRelationWrites;
}

/** Says on the console a description read asked again that did not go; the page still says the read failed. */
function documentRetryLost(cause: unknown): void {
  console.error("Reading the description again did not go.", cause);
}

/** Whether a link's word names the task: its id, or its number as a task link spells one. */
function namesTask(task: TaskSummary, named: string): boolean {
  return task.id === named || (task.number !== undefined && String(task.number) === named);
}

/**
 * The tasks the list has held this session, by their ids. Note that one that
 * leaves the list was deleted or moved out of the member's reach, so its
 * description, which the host keeps after a delete, is never drawn in its
 * place; only a task the list never held stands on its own read.
 */
const listedOnce = new Set<string>();

/** The id a link's word names a task by, or none where it names one by its number. */
function idNamed(named: string | undefined): string | undefined {
  if (named === undefined) return undefined;

  return taskNumberOf({ kind: LINK_DESTINATION.TASK, planId: named }) === undefined
    ? named
    : undefined;
}

/**
 * One task by its id or its number, as a link names it, with all its page
 * shows, its description and pages followed while the page stands, as the
 * panel's Overview follows them (`TASKS_DOCUMENT_FOLLOW`, `TASKS_PAGES_FOLLOW`).
 * A task the list doesn't hold, named by its id, stands on its own
 * description read, as the panel's page stands on it (`use-found-task.ts`
 * finds one a link names by number); none until that read answers with it.
 */
export function useTaskOverview(named: string | undefined): TaskOverview | undefined {
  const acts = useHostActs();
  const workspace = useTasksWorkspace();
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const waiting = useWaiting(workspace?.id);
  const { held: statuses, setStatus } = useStatusWrites(view?.tasks ?? NO_TASKS);
  const { rename } = useTaskWrites();
  const listed = useMemo(() => withHeld(view?.tasks ?? NO_TASKS, statuses), [view, statuses]);

  const listedTask =
    named === undefined ? undefined : listed.find((each) => namesTask(each, named));

  // Note that an id the list doesn't hold is followed by its own read, while a number it doesn't hold names nothing to follow.
  const taskId = listedTask?.id ?? idNamed(named);
  const relations = useTaskRelationWrites();
  useLiveFollow(taskId, (id) => acts[ACT_KIND.TASKS_DOCUMENT_FOLLOW]({ taskId: id }));
  useLiveFollow(taskId, (id) => acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: (state) =>
      taskId === undefined
        ? undefined
        : {
            document: state[LIVE_READ.DESCRIPTION_DOCUMENT][taskId]?.rows,
            documentFailed: state[LIVE_READ.DESCRIPTION_DOCUMENT][taskId]?.failed === true,
            pages: state[LIVE_READ.PAGES][PAGE_OWNER.TASK][taskId]?.rows,
          },
  });

  useEffect(() => {
    if (listedTask !== undefined) listedOnce.add(listedTask.id);
  }, [listedTask]);

  const read = held?.document;

  const unlistedTask =
    taskId !== undefined && !listedOnce.has(taskId) && read !== undefined && "task" in read
      ? read.task
      : undefined;

  const task = listedTask ?? unlistedTask;
  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  // Note that a task stands under its own workspace, its path and its link named by that workspace's key, since a link may open one outside the workspace the phone works in.
  const taskWorkspace = workspaces?.find((each) => each.id === task?.workspaceId) ?? workspace;

  // Note that a task opened by a link may stand in another workspace than the one the phone works in, so its own workspace's sections and repositories are read.
  const placing = useTaskPlacing(task?.workspaceId);

  return useMemo(() => {
    if (task === undefined) return undefined;

    const agents = taskAgentsInOrder(agentsByTask(view), task.id, waiting.byAgent).map((agent) =>
      agentLine(agent, waiting.byAgent, view),
    );

    const listedWaiting = agents.reduce((sum, line) => sum + line.waiting, 0);
    const document = held?.document;

    // Note that a read that failed with a document still held keeps drawing it, as the panel does, so Try again stands only where nothing is.
    const documentRetry =
      held?.documentFailed === true && document === undefined
        ? () => {
            acts[ACT_KIND.TASKS_DOCUMENT_RETRY]({ taskId: task.id }).catch(documentRetryLost);
          }
        : undefined;

    return {
      task,
      document: document !== undefined && "task" in document ? document.task : undefined,
      documentRetry,
      workspace: taskWorkspace,
      agents,
      pages: held?.pages ?? [],
      waitingElsewhere: Math.max(0, (waiting.byTask.get(task.id) ?? 0) - listedWaiting),
      tasks: listed,
      setStatus,
      agentsWorking: agentsWorkingIn(view, listed),
      rename,
      placing,
      relations,
    };
  }, [task, view, waiting, held, taskWorkspace, listed, rename, placing, relations, acts]);
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

type UseStatusAskResult = {
  readonly setStatus: (taskId: string, status: TaskStatus) => void;
  readonly question: StatusQuestion;
};

/**
 * Sets a task's status as the panel does (`useStandingWrites`): Done or
 * Canceled on a task whose agents are working asks first, since it stops
 * them and the work they are in the middle of, and goes out confirmed as a
 * settle that stops them; anything else goes out at once. Answers the
 * asking `setStatus` and its question, which the screen draws.
 */
export function useStatusAsk(
  doors: Pick<TasksListing, "setStatus" | "agentsWorking">,
): UseStatusAskResult {
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

/** A delete held for its question, kept past its answer so the alert keeps its words as it goes. */
interface HeldDelete {
  readonly taskId: string;
  readonly words: StopAgentsWords;
  readonly presented: boolean;
}

type UseDeleteAskResult = {
  readonly askDelete: (task: TaskSummary) => void;
  readonly question: StatusQuestion;
};

/**
 * Deletes a task for good as the panel does, asking first in the panel's
 * words (`deleteTaskWords`), since nothing brings it back. Answers the
 * asking `askDelete` and its question, which the screen draws; `onDeleted`
 * runs as the delete goes, such as the task's own page giving way.
 */
export function useDeleteAsk(
  remove: TaskWrites["remove"],
  onDeleted?: () => void,
): UseDeleteAskResult {
  const [held, setHeld] = useState<HeldDelete>();
  const letGo = () => setHeld((was) => (was === undefined ? was : { ...was, presented: false }));

  const question: StatusQuestion = {
    words: held?.words ?? NO_WORDS,
    presented: held?.presented === true,
    confirm: () => {
      if (held === undefined || !held.presented) return;
      letGo();
      remove(held.taskId);
      onDeleted?.();
    },
    dismiss: letGo,
  };

  return {
    askDelete: (task) =>
      setHeld({ taskId: task.id, words: deleteTaskWords(task.name, task), presented: true }),
    question,
  };
}

type UseListingAsksResult = {
  readonly listing: TasksListing;
  readonly status: StatusQuestion;
  readonly deletion: StatusQuestion;
};

/**
 * A list's acts that ask first, as every list of tasks offers them: its
 * status set, asking where it stops agents, and its delete, asking always.
 * Answers the listing its rows act through and the two questions, which the
 * screen draws.
 */
export function useListingAsks(read: ReadListing): UseListingAsksResult {
  const { setStatus, question } = useStatusAsk(read);
  const { remove } = useTaskWrites();
  const deletion = useDeleteAsk(remove);

  return {
    listing: { ...read, setStatus, askDelete: deletion.askDelete },
    status: question,
    deletion: deletion.question,
  };
}
