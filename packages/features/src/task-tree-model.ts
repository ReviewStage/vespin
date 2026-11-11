/**
 * task-tree-model.ts -- the phone's Tasks list as the panel's sidebar stands it: Pinned, the member's own sections, then My tasks grouped by repository, each list's child tasks nested under their parents; and the workspace's tasks a search finds.
 *
 * Every piece is the sidebar's own (`task-list-model.ts`,
 * `task-sections-model.ts`, `pin-order.ts`), read under the view the
 * sidebar starts from (`DEFAULT_TASK_LIST_VIEW`): the reader's own tasks,
 * to do and in progress, grouped by repository, the pinned repositories'
 * groups first. A pin is the reader's own choice and is never filtered, as
 * the sidebar never filters one.
 */

import { inPinOrder } from "./pin-order.js";
import { readsUnread } from "./read-mark.js";
import { matchesTokens } from "./search-tokens.js";
import {
  pullRequestsOfTask,
  type TaskAgentsStatus,
  taskAgentsStatus,
} from "./task-agents-model.js";
import {
  DEFAULT_TASK_LIST_VIEW,
  type DrawnTaskRow,
  drawnTaskRows,
  homedTaskRows,
  orderTasks,
  repositoryHeadingsDrawn,
  repositoryLabel,
  TASK_GROUPING,
  TASK_ORDER,
  taskInView,
  taskSections,
  tasksAssignedTo,
  tasksById,
  taskTime,
} from "./task-list-model.js";
import type { TaskSection } from "./task-section-wire.js";
import { NO_TASK_SECTIONS, sectionedTasks, sectionInView } from "./task-sections-model.js";
import type { TaskSummary } from "./task-wire.js";
import type { TasksView } from "./tasks-view.js";
import { taskKey } from "./workspace-key.js";

/** What heads the reader's pinned tasks, as the sidebar's section is called. */
const PINNED_HEAD = "Pinned";

/** What a group of the tree stands for: Pinned, one of the member's sections, or a repository under My tasks. */
const TASK_TREE_GROUP = {
  PINNED: "pinned",
  SECTION: "section",
  REPOSITORY: "repository",
} as const;

type TaskTreeGroupKind = (typeof TASK_TREE_GROUP)[keyof typeof TASK_TREE_GROUP];

/** One list of the tree: its kind, a key it is told apart by, its heading, and its rows in order, child tasks nested. */
export interface TaskTreeGroup {
  readonly kind: TaskTreeGroupKind;
  /** The group's own id: Pinned's kind, a section's id, or a repository's full name, none for the tasks with none. */
  readonly key: string;
  /** What heads it; none for a repository group where the tree draws no repository headings. */
  readonly title: string | undefined;
  readonly rows: readonly DrawnTaskRow[];
  /** A section's own icon, where its member gave it one. */
  readonly icon?: TaskSection["icon"];
}

/** The phone's Tasks list: Pinned where anything is pinned, the member's sections, and My tasks' repository groups. */
export interface TaskTree {
  readonly pinned: TaskTreeGroup | undefined;
  readonly sections: readonly TaskTreeGroup[];
  /** What heads the tasks no pin or section holds. */
  readonly tasksHead: string;
  readonly tasks: readonly TaskTreeGroup[];
}

/** What the tree is read from: the host's task list, the workspace it is narrowed to, the reader, and what the group headings say of no repository. */
export interface TaskTreeInput {
  readonly view: {
    readonly tasks: TasksView["tasks"];
    readonly taskSections?: TasksView["taskSections"] | undefined;
    readonly repositoryPins?: TasksView["repositoryPins"] | undefined;
  };
  /** The workspace the phone works in; every listed task while none is known. */
  readonly workspaceId: string | undefined;
  readonly readerId: string | undefined;
  /** What a group of tasks with no repository is headed. */
  readonly noRepository: string;
  /** What heads the tasks no pin or section holds: "My tasks". */
  readonly tasksHead: string;
}

/** The workspace's tasks; every task while no workspace is known. */
function workspaceTasks(
  tasks: readonly TaskSummary[],
  workspaceId: string | undefined,
): readonly TaskSummary[] {
  return tasks.filter((task) => workspaceId === undefined || task.workspaceId === workspaceId);
}

/** Every task row stands open, since a phone's list folds no parent. */
const ALL_OPEN = () => true;

/** No row is held standing under a fold, since none is folded. */
const NONE_STANDING = () => false;

/**
 * The tree the phone's Tasks tab draws, as the sidebar draws it under its
 * first view: Pinned in the order dragged, each section with its tasks to do
 * and in progress in its own order, and the reader's other tasks to do and
 * in progress grouped by repository, each child task moved under its parent
 * wherever a list holds it (`homedTaskRows`) and nested there, but one
 * pinned or put in a section of its own, which stays where it was put.
 */
export function taskTree(input: TaskTreeInput): TaskTree {
  const { view, workspaceId, readerId } = input;
  const listed = workspaceTasks(view.tasks, workspaceId);
  const every = tasksById(listed);
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    (task) => ({ position: task.pinPosition, at: task.pinnedAt ?? 0 }),
  );
  const free = listed.filter((task) => task.pinnedAt === undefined);
  const sectioned = sectionedTasks(view.taskSections ?? NO_TASK_SECTIONS, workspaceId, free);
  const sections = sectioned.sections.map((drawn) =>
    sectionInView(drawn, DEFAULT_TASK_LIST_VIEW, readerId),
  );
  const rest = tasksAssignedTo(
    free.filter((task) => !sectioned.taskIds.has(task.id)),
    DEFAULT_TASK_LIST_VIEW.assignedTo,
    readerId,
  ).filter((task) => taskInView(task, DEFAULT_TASK_LIST_VIEW));
  const grouped = taskSections(
    rest,
    TASK_GROUPING.REPOSITORY,
    (view.repositoryPins ?? []).map((pin) => pin.repository),
  );
  const groups = grouped.grouping === TASK_GROUPING.REPOSITORY ? grouped.groups : [];
  const homed = homedTaskRows(
    [pinned, ...sections.map((drawn) => drawn.tasks), ...groups.map((group) => group.tasks)],
    every,
    1 + sections.length,
  );
  const drawn = (at: number) => drawnTaskRows(homed[at] ?? [], ALL_OPEN, NONE_STANDING, every);
  const headings = repositoryHeadingsDrawn(groups);
  return {
    pinned:
      pinned.length === 0
        ? undefined
        : {
            kind: TASK_TREE_GROUP.PINNED,
            key: TASK_TREE_GROUP.PINNED,
            title: PINNED_HEAD,
            rows: drawn(0),
          },
    sections: sections.map((section, at) => ({
      kind: TASK_TREE_GROUP.SECTION,
      key: section.section.id,
      title: section.section.title,
      icon: section.section.icon,
      rows: drawn(at + 1),
    })),
    tasksHead: input.tasksHead,
    tasks: groups.map((group, at) => ({
      kind: TASK_TREE_GROUP.REPOSITORY,
      key: group.repository ?? "",
      title: !headings
        ? undefined
        : group.repository === null
          ? input.noRepository
          : repositoryLabel(group.repository, groups),
      rows: drawn(at + 1 + sections.length),
    })),
  };
}

/**
 * The workspace's tasks a search finds, whatever their status, newest
 * updated first, as ⌘K finds a task: every word typed in its name, its key
 * (`ACME-42`), or its repository. None for a search of no words.
 */
export function searchedTasks(input: {
  readonly tasks: readonly TaskSummary[];
  readonly workspaceId: string | undefined;
  /** The workspace's name, which a task's key is spelled from. */
  readonly workspaceName: string | undefined;
  readonly tokens: readonly string[];
}): readonly TaskSummary[] {
  const { tokens, workspaceName } = input;
  if (tokens.length === 0) return [];
  const found = workspaceTasks(input.tasks, input.workspaceId).filter((task) =>
    matchesTokens(
      [
        task.name,
        task.repository ?? "",
        workspaceName === undefined || task.number === undefined
          ? ""
          : taskKey(workspaceName, task.number),
      ],
      tokens,
    ),
  );
  return orderTasks(found);
}

/** What a task's row says beyond its status and name: whether it reads unread, whether a thread of it waits on the reader, what its agents say, and when it last moved. */
export interface TaskRowLook {
  readonly unread: boolean;
  readonly needsYou: boolean;
  readonly agents: TaskAgentsStatus;
  readonly at: number;
}

/**
 * A task's row as the sidebar draws it (`SidebarTask`): unread where it was
 * marked so or moved since it was read, the needs-you mark where any thread
 * of it waits on the reader, its agents' status with its pull requests, and
 * its newest change, its agents' among them.
 */
export function taskRowLook(
  task: TaskSummary,
  waiting: number,
  taskPullRequests: TasksView["taskPullRequests"],
): TaskRowLook {
  const at = taskTime(task, TASK_ORDER.UPDATED);
  return {
    unread: readsUnread(task, at),
    needsYou: waiting > 0,
    agents: taskAgentsStatus(task.agents, pullRequestsOfTask(taskPullRequests, task.id)),
    at,
  };
}

/** One task of a group with the sub-tasks standing under it, each a node of its own. */
export interface TaskTreeNode {
  readonly task: TaskSummary;
  readonly children: readonly TaskTreeNode[];
}

/** A group's rows as the nodes they nest into: each row under the nearest row above it standing one less deep. */
export function taskTreeNodes(rows: readonly DrawnTaskRow[]): readonly TaskTreeNode[] {
  const tops: { task: TaskSummary; children: TaskTreeNode[] }[] = [];
  const open: { depth: number; node: { task: TaskSummary; children: TaskTreeNode[] } }[] = [];
  for (const { task, depth } of rows) {
    const node = { task, children: [] };
    while ((open.at(-1)?.depth ?? -1) >= depth) open.pop();
    const parent = open.at(-1);
    if (parent === undefined) tops.push(node);
    else parent.node.children.push(node);
    open.push({ depth, node });
  }
  return tops;
}
