import { isTaskSettled, TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";

/**
 * task-list-model.ts -- how the sidebar's task list is grouped and filtered: the view a workspace keeps, the groups it draws, and the time each row shows.
 *
 * The list is one section of the sidebar, the work under way, its tasks
 * drawn by repository or in one run, newest updated first, browsing left
 * to the Tasks page. By repository draws its headings only where the rows
 * span two repositories or more (`repositoryHeadingsDrawn`), so a workspace
 * of one repository, or of none, reads as one run. Home's Recent and ⌘K
 * order tasks by the same last activity (`taskTime`), which is the time
 * each row shows, so the order and the label never disagree.
 *
 * The list holds the reader's own tasks until they choose Anyone or a
 * teammate (`ASSIGNED_TO`): those assigned to them, and those no one is on
 * that they created, so a task of theirs nobody picked up never leaves it.
 * It holds the tasks to do and in progress alone (`SHOWN_STATUSES`), so a
 * filed backlog and the settled tasks stay out of the way of the work under
 * way, unless the reader asks for the finished sub-tasks back, which stand
 * under their parents (`taskInView`); a task from a service before
 * statuses has no status to leave it out by and always stands. The Tasks page lays the same tasks out its own way
 * (`tasks-page-model.ts`).
 */

/** How the list groups its tasks. */
export const TASK_GROUPING = {
  REPOSITORY: "repository",
  NONE: "none",
} as const;

export type TaskGrouping = (typeof TASK_GROUPING)[keyof typeof TASK_GROUPING];

/** How the Tasks page and a row's time order tasks; the sidebar orders by last update alone. */
export const TASK_ORDER = {
  UPDATED: "updated",
  CREATED: "created",
  NAME: "name",
} as const;

export type TaskOrder = (typeof TASK_ORDER)[keyof typeof TASK_ORDER];

/** Whose tasks the list holds: the reader's, anyone's, or one teammate's. */
export const ASSIGNED_TO = {
  ME: "me",
  ANYONE: "anyone",
  MEMBER: "member",
} as const;

/** Whose tasks the list holds, a teammate by account id. */
export type AssignedTo =
  | { readonly kind: typeof ASSIGNED_TO.ME }
  | { readonly kind: typeof ASSIGNED_TO.ANYONE }
  | { readonly kind: typeof ASSIGNED_TO.MEMBER; readonly userId: string };

/** How a workspace's list is drawn: by repository, the reader's own tasks, its finished sub-tasks left out, until it is changed. */
export interface TaskListView {
  readonly grouping: TaskGrouping;
  readonly assignedTo: AssignedTo;
  /** Whether a parent's finished sub-tasks stand under it (`taskInView`). */
  readonly finishedSubTasks: boolean;
}

/** What the Tasks head says for Me and Anyone; a member's list is called by their name (the panel's `tasksHeadWords`). */
export const TASKS_HEAD_WORDS = {
  [ASSIGNED_TO.ME]: "My tasks",
  [ASSIGNED_TO.ANYONE]: "Everyone's tasks",
} as const;

/** The statuses the list shows: the work to do and under way, the backlog and the settled left out. */
export const SHOWN_STATUSES: readonly TaskStatus[] = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS];

export const DEFAULT_TASK_LIST_VIEW: TaskListView = {
  grouping: TASK_GROUPING.REPOSITORY,
  assignedTo: { kind: ASSIGNED_TO.ME },
  finishedSubTasks: false,
};

/** The tasks of one repository, as the sidebar groups them under its header; null is the tasks with none. */
export interface RepositoryGroup {
  readonly repository: string | null;
  readonly tasks: readonly TaskSummary[];
}

/** Who created a plan, by account id: the creator the wire names, else its owner. */
function creatorIdOf(task: TaskSummary): string | undefined {
  return task.createdBy?.userId ?? task.ownerId;
}

/**
 * The time a row shows and is ordered by: when it was started under
 * Created, else when it last saw activity, the later of its description's last save
 * and its agents' last settled activity (`agents.activityAt`: one started,
 * or a turn ended), so a task an agent worked through stands with the tasks
 * worked on lately, as "last activity" does in Linear and Cursor. Neither
 * moves when an agent's turn starts or while it runs, so a row holds its
 * place, and its time, while the agent works.
 */
export function taskTime(task: TaskSummary, order: TaskOrder): number {
  if (order === TASK_ORDER.CREATED) return task.createdAt;
  return Math.max(task.updatedAt, task.agents?.activityAt ?? 0);
}

/** The time a task last saw activity (`taskTime`). */
function activityTime(task: TaskSummary): number {
  return taskTime(task, TASK_ORDER.UPDATED);
}

/** The tasks newest active first. */
export function orderTasks(tasks: readonly TaskSummary[]): TaskSummary[] {
  return tasks.toSorted((a, b) => activityTime(b) - activityTime(a));
}

/** The tasks split by a key, each run kept in the order it was handed. */
function grouped<K>(
  tasks: readonly TaskSummary[],
  keyOf: (task: TaskSummary) => K,
): Map<K, TaskSummary[]> {
  const groups = new Map<K, TaskSummary[]>();
  for (const task of tasks) {
    const key = keyOf(task);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [task]);
    else group.push(task);
  }
  return groups;
}

/** The latest time among a group's tasks. */
function latest(tasks: readonly TaskSummary[]): number {
  return Math.max(...tasks.map(activityTime));
}

/** What every surface calls the state of naming no repository: a task's, a group's, a filter's, a pick's. */
export const NO_REPOSITORY = "No repository";

/** A repository's two parts, `acme` and `relay` of `acme/relay`; a name with no owner is its name alone. */
export interface RepositoryParts {
  readonly owner: string | undefined;
  readonly name: string;
}

/** A repository's owner and its name, split at the slash GitHub writes between them. */
export function repositoryParts(repository: string): RepositoryParts {
  const slash = repository.indexOf("/");
  if (slash <= 0) return { owner: undefined, name: repository };
  return { owner: repository.slice(0, slash), name: repository.slice(slash + 1) };
}

/** A repository's name without its owner: `relay` of `acme/relay`. */
function nameOf(repository: string): string {
  return repositoryParts(repository).name;
}

/**
 * The tasks grouped by their repository, newest updated first: the group
 * holding the latest task first, and the tasks with none last whatever
 * their age.
 */
export function repositoryGroups(tasks: readonly TaskSummary[]): readonly RepositoryGroup[] {
  const groups = [...grouped(orderTasks(tasks), (task) => task.repository)].map(
    ([repository, members]) => ({ repository, tasks: members }),
  );
  return groups.sort((a, b) => {
    if (a.repository === null || b.repository === null) {
      return Number(a.repository === null) - Number(b.repository === null);
    }
    return latest(b.tasks) - latest(a.tasks);
  });
}

/**
 * Whether the list draws its repositories' headings: only where its groups
 * span two repositories or more, the rows with none counted as one, since a
 * lone heading over every row tells the reader nothing.
 */
export function repositoryHeadingsDrawn(groups: readonly RepositoryGroup[]): boolean {
  return groups.length > 1;
}

/**
 * What a group's header says for its repository: the repository's name
 * alone, its owner left to the hover, unless another group's repository
 * shares the name, where both say `owner/name` so neither is mistaken.
 */
export function repositoryLabel(
  repository: string,
  groups: readonly Pick<RepositoryGroup, "repository">[],
): string {
  const name = nameOf(repository);
  const shared = groups.some(
    (group) =>
      group.repository !== null &&
      group.repository !== repository &&
      nameOf(group.repository) === name,
  );
  return shared ? repository : name;
}

/** The plans one member created, or every plan where the view names nobody. */
export function createdByOnly(
  tasks: readonly TaskSummary[],
  createdBy: string | undefined,
): readonly TaskSummary[] {
  return createdBy === undefined ? tasks : tasks.filter((task) => creatorIdOf(task) === createdBy);
}

/**
 * The tasks the view's Assigned to holds: every task for Anyone; one
 * teammate's; and for Me the reader's, and the tasks no one is on that the
 * reader created, so their own unassigned work never leaves the list. A
 * reader not yet known filters nothing.
 */
export function tasksAssignedTo(
  tasks: readonly TaskSummary[],
  assignedTo: AssignedTo,
  readerId: string | undefined,
): readonly TaskSummary[] {
  switch (assignedTo.kind) {
    case ASSIGNED_TO.ANYONE:
      return tasks;
    case ASSIGNED_TO.MEMBER:
      return tasks.filter((task) => task.assignee?.userId === assignedTo.userId);
    case ASSIGNED_TO.ME:
      if (readerId === undefined) return tasks;
      return tasks.filter((task) => {
        const assignee = task.assignee?.userId;
        return assignee === undefined ? creatorIdOf(task) === readerId : assignee === readerId;
      });
  }
}

/** Whether the view draws a task: one of a status shown, or one with no status to leave it out by, a task from a service before statuses. */
function taskInStatuses(task: TaskSummary, statuses: readonly TaskStatus[]): boolean {
  const status = task.status;
  return status === undefined || statuses.includes(status);
}

/** The tasks the view draws by status (`taskInStatuses`). */
export function tasksInStatuses(
  tasks: readonly TaskSummary[],
  statuses: readonly TaskStatus[],
): readonly TaskSummary[] {
  return tasks.filter((task) => taskInStatuses(task, statuses));
}

/**
 * Whether the view draws a task: one of a status the list shows
 * (`SHOWN_STATUSES`), or, while it shows finished sub-tasks, a sub-task
 * done or canceled, which stands under its parent wherever that is drawn
 * and nowhere where it is not (`homedTaskRows`), so a finished task at the
 * top stays out of the list.
 */
export function taskInView(
  task: TaskSummary,
  view: Pick<TaskListView, "finishedSubTasks">,
): boolean {
  if (taskInStatuses(task, SHOWN_STATUSES)) return true;
  return view.finishedSubTasks && task.parentTaskId !== undefined && taskFinished(task);
}

/** One task as a list nesting child tasks draws its row: how deep it stands, and whether the child tasks under it stand open. */
export interface DrawnTaskRow {
  readonly task: TaskSummary;
  /** How deep it stands: 0 at the top, one more for each parent above it. */
  readonly depth: number;
  /** Whether its child tasks stand open under it; undefined where the list holds none of them. */
  readonly open: boolean | undefined;
}

/** One task and the tasks standing under it, each a tree of its own. */
interface TaskNode {
  readonly task: TaskSummary;
  readonly children: readonly TaskNode[];
}

/** Every task of the workspace by its id, those no list draws among them, through which a task's ancestors are walked. */
export type TasksById = ReadonlyMap<string, TaskSummary>;

/** Every task of `tasks` by its id. */
export function tasksById(tasks: readonly TaskSummary[]): TasksById {
  return new Map(tasks.map((task) => [task.id, task]));
}

/**
 * The nearest of a task's ancestors `held` holds, walked up through `every`
 * past those it leaves out, as a finished parent the view hides; none for
 * a task at the top, a pinned one, which stands on its own pin, or one
 * none of whose ancestors `held` holds. Note that the walk ends where a
 * loop of parents, which nothing writes, closes, and at a task out of the
 * reader's sight, which `every` does not hold.
 */
function heldAncestor(
  task: TaskSummary,
  held: (taskId: string) => boolean,
  every: TasksById,
): string | undefined {
  if (task.pinnedAt !== undefined) return undefined;
  const walked = new Set([task.id]);
  let at = task.parentTaskId;
  while (at !== undefined && !walked.has(at)) {
    if (held(at)) return at;
    walked.add(at);
    at = every.get(at)?.parentTaskId;
  }
  return undefined;
}

/** Whether a task stands under a parent, which the sidebar draws it under or nowhere: one not pinned, naming a parent other than itself. */
function underParent(task: TaskSummary): boolean {
  return (
    task.pinnedAt === undefined && task.parentTaskId !== undefined && task.parentTaskId !== task.id
  );
}

/** The task a task stands under where `tasks` holds it: its nearest ancestor `tasks` holds (`heldAncestor`). */
function parentIn(
  task: TaskSummary,
  held: ReadonlySet<string>,
  every: TasksById,
): string | undefined {
  return heldAncestor(task, (taskId) => held.has(taskId), every);
}

/**
 * The tasks as a tree, each in the order `tasks` hands it. Note that a loop
 * of parents, which nothing writes, is reached from no task at the top, so
 * its first task is stood at the top, the loop cut where it closes, rather
 * than the loop leaving the list.
 */
function taskNodes(tasks: readonly TaskSummary[], every: TasksById): TaskNode[] {
  const held = new Set(tasks.map((task) => task.id));
  const childrenOf = new Map<string, TaskSummary[]>();
  const tops: TaskSummary[] = [];
  for (const task of tasks) {
    const parent = parentIn(task, held, every);
    if (parent === undefined) tops.push(task);
    else childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), task]);
  }
  const reached = new Set<string>();
  const node = (task: TaskSummary): TaskNode => {
    reached.add(task.id);
    const children = childrenOf.get(task.id) ?? [];
    return {
      task,
      children: children.filter((child) => !reached.has(child.id)).map(node),
    };
  };
  const tree = tops.map(node);
  for (const task of tasks) if (!reached.has(task.id)) tree.push(node(task));
  return tree;
}

/** Whether a task or any task under it is one `standing` keeps drawn. */
function holdsStanding(node: TaskNode, standing: (task: TaskSummary) => boolean): boolean {
  return standing(node.task) || node.children.some((child) => holdsStanding(child, standing));
}

/**
 * The rows as a list nesting child tasks draws them, in order: each row,
 * then the child tasks under it while `opened` says it stands open, to any
 * depth, each in the order `tasks` hands it. A task stands under its parent
 * where `tasks` holds that parent, which the sidebar sees to across its
 * lists (`homedTaskRows`), or under its nearest ancestor `tasks` holds where
 * the parent is one the view hides, walked through `every`; one none of
 * whose ancestors `tasks` holds, as a fold leaves out all but the open task,
 * stands at the top, so it is never out of reach, and no row stands twice.
 * A row folded shut still draws the one `standing` keeps (the open task),
 * and the rows between it and that one, so the task worked on never leaves
 * the list, as a folded group keeps it.
 */
export function drawnTaskRows(
  tasks: readonly TaskSummary[],
  opened: (taskId: string) => boolean,
  standing: (task: TaskSummary) => boolean,
  every: TasksById,
): DrawnTaskRow[] {
  const drawn: DrawnTaskRow[] = [];
  const draw = (node: TaskNode, depth: number) => {
    const { task, children } = node;
    const open = children.length === 0 ? undefined : opened(task.id);
    drawn.push({ task, depth, open });
    const under =
      open === false ? children.filter((child) => holdsStanding(child, standing)) : children;
    for (const child of under) draw(child, depth + 1);
  };
  for (const node of taskNodes(tasks, every)) draw(node, 0);
  return drawn;
}

/**
 * The sidebar's lists, each as it draws its rows: Pinned, a section, or a
 * group under Tasks. A child task stands only under its parent, wherever a
 * list holds that parent, so each is moved out of the list it would sort
 * into and into the list holding its top task, or its nearest pinned one,
 * after that list's own rows, where `drawnTaskRows` nests it. A parent no
 * list holds, finished and hidden by the view, filtered out, or out of the
 * reader's sight, is passed by, walked through `every`, so its child task
 * stands under the nearest ancestor a list does hold, and its open work
 * never leaves the sidebar; one none of whose ancestors any list holds is
 * drawn nowhere, never at the top, and so is every task under it, however
 * deep. A task the member put in a list by hand, a pinned one in Pinned
 * or a sectioned one in its section, the first `placed` lists, stays there
 * with every task under it, and nests under its parent only where that
 * list holds the parent too, so a child task dragged into a section stands
 * in it rather than going back under its parent.
 */
export function homedTaskRows(
  lists: readonly (readonly TaskSummary[])[],
  every: TasksById,
  placed: number,
): TaskSummary[][] {
  const listOf = new Map<string, number>();
  const byId = new Map<string, TaskSummary>();
  lists.forEach((tasks, list) => {
    for (const task of tasks) {
      if (listOf.has(task.id)) continue;
      listOf.set(task.id, list);
      byId.set(task.id, task);
    }
  });
  const held = (taskId: string) => listOf.has(taskId);
  const putByHand = (taskId: string) => (listOf.get(taskId) ?? placed) < placed;
  const homeOf = (task: TaskSummary): number | undefined => {
    const walked = new Set([task.id]);
    let at = task;
    let above = heldAncestor(at, held, every);
    // Note that a loop of parents, which nothing writes, ends the walk where it closes, at the last task it reached, `above` still set.
    while (above !== undefined && !walked.has(above) && !putByHand(at.id)) {
      walked.add(above);
      at = byId.get(above) ?? at;
      above = heldAncestor(at, held, every);
    }
    // The walk ends at a task put in its list by hand, which every task under it follows.
    if (putByHand(at.id)) return listOf.get(at.id);
    // The top of the walk is drawn nowhere where it stands under a parent no list holds, so neither is anything under it.
    return above === undefined && underParent(at) ? undefined : listOf.get(at.id);
  };
  const homed = lists.map((tasks) => tasks.map((task) => ({ task, home: homeOf(task) })));
  return lists.map((_, list) => [
    ...(homed[list] ?? []).flatMap(({ task, home }) => (home === list ? [task] : [])),
    ...homed.flatMap((tasks, from) =>
      from === list ? [] : tasks.flatMap(({ task, home }) => (home === list ? [task] : [])),
    ),
  ]);
}

/** How many of a task's child tasks are finished, of all of them. */
export interface ChildTaskCount {
  readonly finished: number;
  readonly total: number;
}

/** Whether a task has settled: done, or canceled, which is as settled as done. */
export function taskFinished(task: TaskSummary): boolean {
  return isTaskSettled(task.status);
}

/** A task's direct sub-tasks, oldest first, so they read in the order they were made; never itself, which no one writes. */
export function subTasksOf(
  tasks: readonly TaskSummary[],
  parentId: string,
): readonly TaskSummary[] {
  return tasks
    .filter((task) => task.parentTaskId === parentId && task.id !== parentId)
    .toSorted((one, other) => one.createdAt - other.createdAt);
}

/** How many of `subTasks` are finished (done or canceled), of all of them. */
export function subTaskCount(subTasks: readonly TaskSummary[]): ChildTaskCount {
  return { finished: subTasks.filter(taskFinished).length, total: subTasks.length };
}

/**
 * How many of each parent's child tasks are finished (done or canceled),
 * by the parent's id, for the parents with any. Note that only a task's
 * direct children count, never theirs, and that `tasks` is every task the
 * workspace holds rather than the rows a view draws, since the view
 * hides the finished ones by default and the count is how many of them there are.
 */
export function childTaskCounts(
  tasks: readonly TaskSummary[],
): ReadonlyMap<string, ChildTaskCount> {
  const counts = new Map<string, ChildTaskCount>();
  for (const task of tasks) {
    const { id, parentTaskId } = task;
    if (parentTaskId === undefined || parentTaskId === id) continue;
    const was = counts.get(parentTaskId) ?? { finished: 0, total: 0 };
    counts.set(parentTaskId, {
      finished: was.finished + (taskFinished(task) ? 1 : 0),
      total: was.total + 1,
    });
  }
  return counts;
}

/** The listed tasks as the view groups them: by repository, or in one run. */
export type TaskSections =
  | {
      readonly grouping: typeof TASK_GROUPING.REPOSITORY;
      readonly groups: readonly RepositoryGroup[];
    }
  | { readonly grouping: typeof TASK_GROUPING.NONE; readonly tasks: readonly TaskSummary[] };

/**
 * The tasks under Tasks as the view groups them, newest updated first.
 * Grouped by repository, the pinned repositories' groups stand above the
 * rest in the order `pinnedRepositories` names them, newest pinned first,
 * and the rest keep the order's.
 */
export function taskSections(
  tasks: readonly TaskSummary[],
  grouping: TaskSections["grouping"],
  pinnedRepositories: readonly string[],
): TaskSections {
  if (grouping === TASK_GROUPING.NONE) {
    return { grouping, tasks: orderTasks(tasks) };
  }
  const grouped = repositoryGroups(tasks);
  const pinnedAt = (group: RepositoryGroup) =>
    group.repository === null ? -1 : pinnedRepositories.indexOf(group.repository);
  return {
    grouping,
    groups: [
      ...grouped.filter((group) => pinnedAt(group) >= 0).sort((a, b) => pinnedAt(a) - pinnedAt(b)),
      ...grouped.filter((group) => pinnedAt(group) < 0),
    ],
  };
}
