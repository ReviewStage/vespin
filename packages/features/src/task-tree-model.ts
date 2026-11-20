/**
 * task-tree-model.ts -- the phone's Tasks list as the panel's sidebar stands it: Pinned, Following, the member's own sections, then My tasks grouped by repository, each list's child tasks nested under their parents; the groups a wide window's sidebar lists as places of their own; and the workspace's tasks a search finds.
 *
 * Every piece is the sidebar's own (`task-list-model.ts`,
 * `task-sections-model.ts`, `pin-order.ts`), read under the view the
 * sidebar starts from (`DEFAULT_TASK_LIST_VIEW`): the reader's own tasks,
 * to do and in progress, grouped by repository, the pinned repositories'
 * groups first. A pin or a section is the reader's own choice, which the
 * view's filters never thin, as the sidebar's never do.
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
  followingTasks,
  homedTaskRows,
  orderTasks,
  repositoryHeadingsDrawn,
  repositoryLabel,
  TASK_GROUPING,
  TASK_ORDER,
  taskListed,
  taskSections,
  tasksAssignedTo,
  tasksById,
  taskTime,
  withSubTasks,
} from "./task-list-model.js";
import type { TaskSection } from "./task-section-wire.js";
import { NO_TASK_SECTIONS, sectionedTasks, sectionWithoutSettled } from "./task-sections-model.js";
import type { TaskSummary } from "./task-wire.js";
import type { TaskListParts, TasksView } from "./tasks-view.js";
import { taskKey } from "./workspace-key.js";

/** What heads the reader's pinned tasks, as the sidebar's section is called. */
const PINNED_HEAD = "Pinned";

/** What heads the tasks the reader follows that no other list holds, as the sidebar's group is called. */
export const FOLLOWING_HEAD = "Following";

/** What a group of the tree stands for: Pinned, Following, one of the member's sections, or a repository under My tasks. */
export const TASK_TREE_GROUP = {
  PINNED: "pinned",
  FOLLOWING: "following",
  SECTION: "section",
  REPOSITORY: "repository",
} as const;

export type TaskTreeGroupKind = (typeof TASK_TREE_GROUP)[keyof typeof TASK_TREE_GROUP];

/** The key of the repository group holding the tasks with no repository, which no repository's full name can take. */
export const NO_REPOSITORY_KEY = "";

/** One list of the tree: its kind, a key it is told apart by, its heading, and its rows in order, child tasks nested. */
export interface TaskTreeGroup {
  readonly kind: TaskTreeGroupKind;
  /** The group's own id: Pinned's or Following's kind, a section's id, or a repository's full name, none for the tasks with none. */
  readonly key: string;
  /** What heads it; none for a repository group where the tree draws no repository headings. */
  readonly title: string | undefined;
  readonly rows: readonly DrawnTaskRow[];
  /** A section's own icon, where its member gave it one. */
  readonly icon?: TaskSection["icon"];
}

/** The phone's Tasks list: Pinned where anything is pinned, Following where the reader follows a task no other list holds, the member's sections, and My tasks' repository groups. */
export interface TaskTree {
  readonly pinned: TaskTreeGroup | undefined;
  readonly following: TaskTreeGroup | undefined;
  readonly sections: readonly TaskTreeGroup[];
  /** What heads the tasks no pin or section holds. */
  readonly tasksHead: string;
  readonly tasks: readonly TaskTreeGroup[];
}

/** What the tree is read from: the host's task list, the workspace it is narrowed to, the reader, and what the group headings say of no repository. */
export interface TaskTreeInput {
  readonly view: {
    readonly tasks: TaskListParts["tasks"];
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
 * first view: Pinned in the order dragged, Following with the tasks to do and
 * in progress the reader follows that no other list holds (`followingTasks`),
 * each section with its open tasks in its own order, and the reader's other
 * tasks to do and in progress grouped by repository, each child task moved
 * under its parent wherever a list holds it (`homedTaskRows`), an open one
 * whatever its status or whoever is on it (`withSubTasks`), and nested
 * there, but one pinned or put in a section of its own, which stays where
 * it was put.
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

  const sections = sectioned.sections.map(sectionWithoutSettled);
  const unplaced = free.filter((task) => !sectioned.taskIds.has(task.id));

  const rest = tasksAssignedTo(unplaced, DEFAULT_TASK_LIST_VIEW.assignedTo, readerId).filter(
    taskListed,
  );

  const followed = followingTasks(unplaced, rest, readerId);

  const grouped = taskSections(
    orderTasks(rest),
    TASK_GROUPING.REPOSITORY,
    (view.repositoryPins ?? []).map((pin) => pin.repository),
  );

  const groups = grouped.grouping === TASK_GROUPING.REPOSITORY ? grouped.groups : [];

  const homed = withSubTasks(
    homedTaskRows(
      [
        pinned,
        ...sections.map((drawn) => drawn.tasks),
        followed,
        ...groups.map((group) => group.tasks),
      ],
      every,
      1 + sections.length,
    ),
    orderTasks(free),
    DEFAULT_TASK_LIST_VIEW.finishedSubTasks,
  );

  const followingRows = drawnTaskRows(
    homed[1 + sections.length] ?? [],
    ALL_OPEN,
    NONE_STANDING,
    every,
  );

  const drawn = (at: number) => drawnTaskRows(homed[at] ?? [], ALL_OPEN, NONE_STANDING, every);

  // A repository group whose every task moved under a parent another list holds is left out, as the sidebar leaves it, and the headings read the groups left.
  const homedGroups = groups
    .map((group, at) => ({ ...group, tasks: homed[at + 2 + sections.length] ?? [] }))
    .filter((group) => group.tasks.length > 0);

  const headings = repositoryHeadingsDrawn(homedGroups);

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
    following:
      followingRows.length === 0
        ? undefined
        : {
            kind: TASK_TREE_GROUP.FOLLOWING,
            key: TASK_TREE_GROUP.FOLLOWING,
            title: FOLLOWING_HEAD,
            rows: followingRows,
          },
    sections: sections.map((section, at) => ({
      kind: TASK_TREE_GROUP.SECTION,
      key: section.section.id,
      title: section.section.title,
      icon: section.section.icon,
      rows: drawn(at + 1),
    })),
    tasksHead: input.tasksHead,
    tasks: homedGroups.map((group) => ({
      kind: TASK_TREE_GROUP.REPOSITORY,
      key: group.repository ?? NO_REPOSITORY_KEY,
      title: !headings
        ? undefined
        : group.repository === null
          ? input.noRepository
          : repositoryLabel(group.repository, homedGroups),
      rows: drawnTaskRows(group.tasks, ALL_OPEN, NONE_STANDING, every),
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
  taskPullRequests: TaskListParts["taskPullRequests"],
): TaskRowLook {
  const at = taskTime(task, TASK_ORDER.UPDATED);

  return {
    unread: readsUnread(task, at),
    needsYou: waiting > 0,
    agents: taskAgentsStatus(task.agents, pullRequestsOfTask(taskPullRequests, task.id)),
    at,
  };
}

/** Who a task's row names by face: a person, or no one, drawn as the unassigned mark. */
export const TASK_ROW_FACE = {
  PERSON: "person",
  NOBODY: "nobody",
} as const;

/** A task row's face: the member assigned, or the unassigned mark. */
export type TaskRowFace =
  | { readonly kind: typeof TASK_ROW_FACE.PERSON; readonly userId: string; readonly name: string }
  | { readonly kind: typeof TASK_ROW_FACE.NOBODY };

/**
 * The face a task's row wears, as the panel's sidebar row wears it
 * (`@repo/ui`'s `assigneeFace`): the member it is assigned to where that is
 * someone other than the reader, and the unassigned mark where no one is,
 * but in a workspace of one, where no one else could be on it; a task
 * assigned to the reader wears none.
 */
export function taskRowFace(
  task: TaskSummary,
  readerId: string | undefined,
  soleMember: boolean,
): TaskRowFace | undefined {
  const { assignee } = task;

  if (assignee === undefined) return soleMember ? undefined : { kind: TASK_ROW_FACE.NOBODY };

  if (assignee.userId === readerId) return undefined;

  return { kind: TASK_ROW_FACE.PERSON, userId: assignee.userId, name: assignee.name };
}

/** A row of a group with the rows nested under it, each a branch of its own, as a list folds them under it. */
export interface TaskBranch {
  readonly row: DrawnTaskRow;
  readonly branches: readonly TaskBranch[];
}

/**
 * A group's rows as the phone nests them under SwiftUI's disclosure: each
 * row at the group's top a branch, holding the rows under it, however deep,
 * as branches of its own, in the order the group stands them. Note that a
 * row stands under the nearest row above it that stands shallower.
 */
export function taskBranches(rows: readonly DrawnTaskRow[]): readonly TaskBranch[] {
  const top: { row: DrawnTaskRow; branches: TaskBranch[] }[] = [];
  const path: { row: DrawnTaskRow; branches: TaskBranch[] }[] = [];

  for (const row of rows) {
    while (path.length > 0 && (path.at(-1)?.row.depth ?? 0) >= row.depth) path.pop();
    const branch = { row, branches: [] };
    const parent = path.at(-1);

    if (parent === undefined) top.push(branch);
    else parent.branches.push(branch);
    path.push(branch);
  }

  return top;
}
