/**
 * task-tree-model.ts -- the phone's Tasks list as the panel's sidebar stands it: Pinned, Following, the member's own sections, then the reader's tasks under the view they chose, each list's child tasks nested under their parents; the groups a wide window's sidebar lists as places of their own; and the workspace's tasks a search finds.
 *
 * Every piece is the sidebar's own (`task-list-model.ts`,
 * `task-sections-model.ts`, `pin-order.ts`) or the Tasks page's
 * (`tasks-page-model.ts`). The tasks no pin or section holds stand under the
 * view the reader chose on the Tasks tab (`TaskTreeView`): whose they are,
 * as the sidebar's Assigned to says, which statuses, how they are grouped
 * and ordered, which finished ones stand, and whether a sub-task stands
 * beside its parent, as the Tasks page's Filter and View options say. It
 * starts as the sidebar starts: the reader's own tasks, to do and in
 * progress, grouped by repository, the pinned repositories' groups first. A
 * pin or a section is the reader's own choice, which the view never thins,
 * as the sidebar's never does.
 */

import { Option, Schema } from "effect";
import { inPinOrder } from "./pin-order.js";
import { readsUnread } from "./read-mark.js";
import { matchesTokens } from "./search-tokens.js";
import {
  pullRequestsOfTask,
  type TaskAgentsStatus,
  taskAgentsStatus,
} from "./task-agents-model.js";
import {
  ASSIGNED_TO,
  type AssignedTo,
  type DrawnTaskRow,
  drawnTaskRows,
  followingTasks,
  homedTaskRows,
  orderTasks,
  repositoryHeadingsDrawn,
  repositoryLabel,
  TASK_ORDER,
  taskListed,
  tasksAssignedTo,
  tasksById,
  taskTime,
  withSubTasks,
} from "./task-list-model.js";
import type { TaskSection } from "./task-section-wire.js";
import { NO_TASK_SECTIONS, sectionedTasks, sectionWithoutSettled } from "./task-sections-model.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
} from "./task-standing-words.js";
import { isTaskSettled, TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";
import {
  COMPLETED_WINDOW,
  type CompletedWindow,
  mayHoldSettled,
  showsSettledInFull,
  standsCompleted,
  statusOf,
  TASKS_GROUP,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TasksDisplay,
  type TasksFilter,
  type TasksGroup,
  type TasksGroupHead,
  type TasksGrouping,
  type TasksOrder,
  tasksListGroups,
} from "./tasks-page-model.js";
import type { TaskListParts, TasksView } from "./tasks-view.js";
import { taskKey } from "./workspace-key.js";

/** What heads the reader's pinned tasks, as the sidebar's section is called. */
const PINNED_HEAD = "Pinned";

/** What heads the tasks the reader follows that no other list holds, as the sidebar's group is called. */
export const FOLLOWING_HEAD = "Following";

/** What a group of the tree stands for: Pinned, Following, one of the member's sections, or one of the reader's tasks' groups under the view: a repository, a status, a priority, an assignee, or all of them in one. */
export const TASK_TREE_GROUP = {
  PINNED: "pinned",
  FOLLOWING: "following",
  SECTION: "section",
  REPOSITORY: "repository",
  STATUS: "status",
  PRIORITY: "priority",
  ASSIGNEE: "assignee",
  ALL: "all",
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
  /** What one of the reader's tasks' groups stands for under the view's grouping, which its heading's mark is drawn from; none for Pinned, Following, or a section. */
  readonly head?: TasksGroupHead;
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

/**
 * How the reader's tasks under the Tasks tab stand, as the sidebar's View
 * options and the Tasks page's Filter and View options say it: whose they
 * are, which statuses, how they are grouped and ordered, which finished ones
 * stand, and whether a sub-task stands beside its parent rather than only
 * under it.
 */
export interface TaskTreeView {
  readonly assignedTo: AssignedTo;
  /** The statuses kept; none keeps the work to do and under way, as the sidebar does, with the finished the completed window keeps. */
  readonly statuses: readonly TaskStatus[];
  readonly grouping: TaskTreeGrouping;
  readonly order: TasksOrder;
  readonly completed: TaskTreeCompleted;
  readonly subTasks: boolean;
}

/**
 * The groupings the phone offers, the Tasks page's but by creator, which a
 * phone's one column has no person card to head with.
 */
export const TASK_TREE_GROUPINGS = [
  TASKS_GROUPING.STATUS,
  TASKS_GROUPING.PRIORITY,
  TASKS_GROUPING.REPOSITORY,
  TASKS_GROUPING.ASSIGNEE,
  TASKS_GROUPING.NONE,
] as const satisfies readonly TasksGrouping[];

type TaskTreeGrouping = (typeof TASK_TREE_GROUPINGS)[number];

/**
 * The completed windows the phone offers, the Tasks page's: All reads the
 * tasks finished before the list's live window from the service a page at a
 * time, as the page's does (`settled-paging.ts`).
 */
export const TASK_TREE_COMPLETED = [
  COMPLETED_WINDOW.NONE,
  COMPLETED_WINDOW.PAST_WEEK,
  COMPLETED_WINDOW.PAST_MONTH,
  COMPLETED_WINDOW.ALL,
] as const satisfies readonly CompletedWindow[];

type TaskTreeCompleted = (typeof TASK_TREE_COMPLETED)[number];

/** The view until the reader changes it, the sidebar's own: their tasks, to do and in progress, by repository, the latest active first, nothing finished, each sub-task under its parent. */
export const DEFAULT_TASK_TREE_VIEW: TaskTreeView = {
  assignedTo: { kind: ASSIGNED_TO.ME },
  statuses: [],
  grouping: TASKS_GROUPING.REPOSITORY,
  order: TASKS_ORDER.UPDATED,
  completed: COMPLETED_WINDOW.NONE,
  subTasks: false,
};

/** A kept Assigned to, as the sidebar keeps its own. */
const keptAssignedTo = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ME) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.FOLLOWING) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ANYONE) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.MEMBER), userId: Schema.String }),
]);

/** A view as a device keeps it: each choice optional, so one kept before a choice existed reads the default for it. */
const keptTreeView = Schema.Struct({
  assignedTo: Schema.optionalKey(keptAssignedTo),
  statuses: Schema.optionalKey(Schema.Array(Schema.Literals(Object.values(TASK_STATUS)))),
  grouping: Schema.optionalKey(Schema.Literals(TASK_TREE_GROUPINGS)),
  order: Schema.optionalKey(Schema.Literals(Object.values(TASKS_ORDER))),
  completed: Schema.optionalKey(Schema.Literals(TASK_TREE_COMPLETED)),
  subTasks: Schema.optionalKey(Schema.Boolean),
});

/** Each workspace's view as a device keeps it, by the workspace's id. */
export type KeptTreeViews = Readonly<Record<string, typeof keptTreeView.Type>>;

const readKept = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, keptTreeView)),
);

/**
 * Each workspace's view from the words a device kept them as, none where
 * it kept none or they read as nothing. Note that a record kept by a later build, naming a
 * choice this one lacks, reads as none, so every workspace opens on the
 * default rather than half a view.
 */
export function readTreeViews(words: string | undefined): KeptTreeViews {
  if (words === undefined) return {};
  const read = readKept(words);

  return Option.isSome(read) ? read.value : {};
}

/** A workspace's view among those kept, the default for whatever it lacks. */
export function treeViewIn(views: KeptTreeViews, workspaceId: string): TaskTreeView {
  return { ...DEFAULT_TASK_TREE_VIEW, ...views[workspaceId] };
}

/** The words the views are kept as, with one workspace's changed. */
export function keptTreeViews(
  views: KeptTreeViews,
  workspaceId: string,
  view: TaskTreeView,
): string {
  return JSON.stringify({ ...views, [workspaceId]: view });
}

/** Whether two views stand the list alike, so Reset view offers itself only where it would change it. */
export function sameTreeView(a: TaskTreeView, b: TaskTreeView): boolean {
  const sameAssignee =
    a.assignedTo.kind === b.assignedTo.kind &&
    (a.assignedTo.kind !== ASSIGNED_TO.MEMBER ||
      (b.assignedTo.kind === ASSIGNED_TO.MEMBER && a.assignedTo.userId === b.assignedTo.userId));

  return (
    sameAssignee &&
    a.statuses.length === b.statuses.length &&
    a.statuses.every((status) => b.statuses.includes(status)) &&
    a.grouping === b.grouping &&
    a.order === b.order &&
    a.completed === b.completed &&
    a.subTasks === b.subTasks
  );
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
  /** How the tasks no pin or section holds stand. */
  readonly treeView: TaskTreeView;
  /** A person's name, which an assignee's group is headed and ordered by. */
  readonly personName: (userId: string) => string;
  /** Epoch milliseconds now, which the completed window reaches back from. */
  readonly now: number;
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

/** The tasks the view keeps by status before the Tasks page's filter reads them: with no status named, the work to do and under way and the finished, as the sidebar holds them, Backlog left out; every one where a status is named, which the filter then keeps. */
function inViewStatuses(tasks: readonly TaskSummary[], view: TaskTreeView): readonly TaskSummary[] {
  if (view.statuses.length > 0) return tasks;

  return tasks.filter((task) => taskListed(task) || isTaskSettled(statusOf(task)));
}

/** The latest a group's tasks saw activity, which the sidebar orders its repositories' groups by. */
function latestIn(group: TasksGroup): number {
  return Math.max(0, ...group.tasks.map((task) => taskTime(task, TASK_ORDER.UPDATED)));
}

/**
 * The repositories' groups in the sidebar's order: the pinned repositories'
 * first, in the order pinned, then the one holding the latest active task
 * first, the tasks with none last whatever their age (`taskSections`).
 */
function inSidebarOrder(
  groups: readonly TasksGroup[],
  pinnedRepositories: readonly string[],
): readonly TasksGroup[] {
  const repositoryOf = (group: TasksGroup) =>
    group.head.kind === TASKS_GROUP.REPOSITORY ? group.head.repository : null;

  const pinnedAt = (group: TasksGroup) => {
    const repository = repositoryOf(group);

    return repository === null ? -1 : pinnedRepositories.indexOf(repository);
  };

  const pinned = groups.filter((group) => pinnedAt(group) >= 0);
  const rest = groups.filter((group) => pinnedAt(group) < 0);

  return [
    ...pinned.toSorted((a, b) => pinnedAt(a) - pinnedAt(b)),
    ...rest.toSorted(
      (a, b) =>
        Number(repositoryOf(a) === null) - Number(repositoryOf(b) === null) ||
        latestIn(b) - latestIn(a),
    ),
  ];
}

/** The Tasks page's filter the view's statuses stand for: none where it names none. */
function viewFilter(treeView: TaskTreeView): TasksFilter {
  return treeView.statuses.length === 0 ? {} : { status: treeView.statuses };
}

/** The Tasks page's List display the view stands for. */
function viewDisplay(treeView: TaskTreeView): TasksDisplay {
  return {
    grouping: treeView.grouping,
    order: treeView.order,
    emptyGroups: false,
    completed: treeView.completed,
    pinnedFirst: false,
    subTasks: treeView.subTasks,
    properties: [],
  };
}

/** The reader's tasks no pin or section holds as the view groups, orders, and keeps them, through the Tasks page's own List (`tasksListGroups`), the repositories' groups in the sidebar's order. */
function viewGroups(unplaced: readonly TaskSummary[], input: TaskTreeInput): readonly TasksGroup[] {
  const { treeView, readerId } = input;
  const filter = viewFilter(treeView);

  const groups = tasksListGroups(
    inViewStatuses(tasksAssignedTo(unplaced, treeView.assignedTo, readerId), treeView),
    {
      filter,
      display: viewDisplay(treeView),
      pinned: [],
      sections: [],
      readerId,
      personName: input.personName,
      members: [],
      now: input.now,
    },
  ).filter((group) => group.tasks.length > 0);

  if (treeView.grouping !== TASKS_GROUPING.REPOSITORY) return groups;

  return inSidebarOrder(
    groups,
    (input.view.repositoryPins ?? []).map((pin) => pin.repository),
  );
}

/** The kind of tree group one of the view's groups stands as. */
function groupKind(head: TasksGroupHead): TaskTreeGroupKind {
  switch (head.kind) {
    case TASKS_GROUP.STATUS:
      return TASK_TREE_GROUP.STATUS;
    case TASKS_GROUP.PRIORITY:
      return TASK_TREE_GROUP.PRIORITY;
    case TASKS_GROUP.ASSIGNEE:
      return TASK_TREE_GROUP.ASSIGNEE;
    case TASKS_GROUP.REPOSITORY:
      return TASK_TREE_GROUP.REPOSITORY;
    default:
      return TASK_TREE_GROUP.ALL;
  }
}

/** The key a view's group is told apart by, such as its fold: its repository's full name, its status, its priority, or its assignee's id; none for the tasks with none, or all of them in one. */
function groupKey(head: TasksGroupHead): string {
  switch (head.kind) {
    case TASKS_GROUP.STATUS:
      return head.status;
    case TASKS_GROUP.PRIORITY:
      return head.priority;
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId ?? NO_REPOSITORY_KEY;
    case TASKS_GROUP.REPOSITORY:
      return head.repository ?? NO_REPOSITORY_KEY;
    default:
      return NO_REPOSITORY_KEY;
  }
}

/** What heads a view's group: its status, priority, or assignee in the panel's words, its repository as the sidebar names it where the list draws two or more, and none where the list stands as one, which My tasks then heads. */
function groupTitle(
  head: TasksGroupHead,
  groups: readonly TasksGroup[],
  input: TaskTreeInput,
): string | undefined {
  switch (head.kind) {
    case TASKS_GROUP.STATUS:
      return TASK_STATUS_WORDS[head.status];
    case TASKS_GROUP.PRIORITY:
      return TASK_PRIORITY_WORDS[head.priority];
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId === null ? NO_ASSIGNEE_WORDS : input.personName(head.assigneeId);
    case TASKS_GROUP.REPOSITORY: {
      const repositories = groups.map((group) => ({
        repository: group.head.kind === TASKS_GROUP.REPOSITORY ? group.head.repository : null,
        tasks: group.tasks,
      }));

      if (!repositoryHeadingsDrawn(repositories)) return undefined;

      return head.repository === null
        ? input.noRepository
        : repositoryLabel(head.repository, repositories);
    }

    default:
      return undefined;
  }
}

/** A list's rows standing flat, each sub-task on its own, as the view draws them while it shows sub-tasks beside their parents. */
function flatRows(tasks: readonly TaskSummary[]): readonly DrawnTaskRow[] {
  return tasks.map((task) => ({ task, depth: 0, open: undefined }));
}

/**
 * The tree the phone's Tasks tab draws, as the sidebar draws it: Pinned in
 * the order dragged, Following with the tasks to do and in progress the
 * reader follows that no other list holds (`followingTasks`), each section
 * with its open tasks in its own order, and the rest of the reader's tasks
 * under the view (`viewGroups`). While the view folds sub-tasks under their
 * parents, each child task moves under its parent wherever a list holds it
 * (`homedTaskRows`), an open one whatever its status or whoever is on it,
 * and a finished one the completed window keeps (`withSubTasks`), and nests
 * there, but one pinned or put in a section of its own, which stays where it
 * was put; while it shows them, each list stands its own tasks flat.
 */
export function taskTree(input: TaskTreeInput): TaskTree {
  const { view, workspaceId, readerId, treeView } = input;
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
  const groups = viewGroups(unplaced, input);

  const followed = followingTasks(
    unplaced,
    groups.flatMap((group) => group.tasks),
    readerId,
  );

  const lists = [
    pinned,
    ...sections.map((drawn) => drawn.tasks),
    followed,
    ...groups.map((group) => group.tasks),
  ];

  // Note that a pool's finished task stands under its parent only where the completed window keeps it, as the Tasks page keeps it.
  const homed = treeView.subTasks
    ? lists
    : withSubTasks(
        homedTaskRows(lists, every, 1 + sections.length),
        orderTasks(free).filter((task) => standsCompleted(task, treeView.completed, input.now)),
        treeView.completed !== COMPLETED_WINDOW.NONE,
      );

  const drawn = (at: number) =>
    treeView.subTasks
      ? flatRows(homed[at] ?? [])
      : drawnTaskRows(homed[at] ?? [], ALL_OPEN, NONE_STANDING, every);

  const followingRows = drawn(1 + sections.length);

  // A group whose every task moved under a parent another list holds is left out, as the sidebar leaves it, and the headings read the groups left.
  const homedGroups = groups
    .map((group, at) => ({ ...group, tasks: homed[at + 2 + sections.length] ?? [], at }))
    .filter((group) => group.tasks.length > 0);

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
      kind: groupKind(group.head),
      key: groupKey(group.head),
      title: groupTitle(group.head, homedGroups, input),
      head: group.head,
      rows: drawn(group.at + 2 + sections.length),
    })),
  };
}

/** Whether the view shows settled tasks in full, as the Tasks page's does (`showsSettledInFull`): its completed window at All, or its statuses naming Done or Canceled, so the list reads those finished before its live window from the service. */
export function treeShowsSettledInFull(treeView: TaskTreeView): boolean {
  return showsSettledInFull(viewFilter(treeView), viewDisplay(treeView));
}

/** Whether any of the view's groups that may hold settled tasks draws a row, whose run has an end to come to (`settledRowsDrawn`); Pinned, Following, and a section hold none the paging reads. */
export function treeDrawsSettled(tree: TaskTree): boolean {
  return tree.tasks.some(
    (group) => group.head !== undefined && mayHoldSettled(group.head) && group.rows.length > 0,
  );
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
