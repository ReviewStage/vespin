import { AGENT_STATUS, PULL_REQUEST_STATE, type TasklessAgent } from "@repo/features/agent-wire";
import { agentName } from "@repo/features/model-label";
import {
  TASK_STATUS,
  type TaskPullRequestLine,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";

/**
 * task-list-model.ts -- how the sidebar's task list is grouped and filtered: the view a workspace keeps, the groups it draws, and the time each row shows.
 *
 * The list is one section of the sidebar, the work under way, its tasks
 * drawn by repository, by progress, or in one run, newest updated first,
 * browsing left to the Tasks page. By repository draws its headings only
 * where the rows span two repositories or more (`repositoryHeadingsDrawn`),
 * so a workspace of one repository, or of none, reads as one run. By
 * progress stands each row in the first of its groups it qualifies for
 * (`taskRowProgress`): Needs you, Working, In review, then Up next. Home's Recent and ⌘K order tasks by the same last
 * activity (`taskTime`), which is the time each row shows, so the order
 * and the label never disagree.
 *
 * A row of the sidebar's list is a task, or an agent an automation started
 * with no task, which stands among the tasks by the same rules rather than
 * in a group of its own: under its repository, as the reader's where the
 * reader started it, and in the order of its last activity.
 *
 * The list holds the reader's own tasks until they choose Anyone or a
 * teammate (`ASSIGNED_TO`): those assigned to them, and those no one is on
 * that they created, so a task of theirs nobody picked up never leaves it.
 * It holds the tasks to do and in progress alone (`SHOWN_STATUSES`), so a
 * filed backlog and the settled tasks stay out of the way of the work under
 * way, unless the reader asks for the finished sub-tasks back, which stand
 * under their parents (`taskRowInView`); an agent with no task, and a task
 * from a service before statuses, has no status to leave it out by and
 * always stands. The Tasks page lays the same tasks out its own way
 * (`tasks-page-model.ts`).
 */

/** How the list groups its tasks. */
export const TASK_GROUPING = {
  REPOSITORY: "repository",
  PROGRESS: "progress",
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
  /** Whether a parent's finished sub-tasks stand under it (`taskRowInView`). */
  readonly finishedSubTasks: boolean;
}

/** The statuses the list shows: the work to do and under way, the backlog and the settled left out. */
export const SHOWN_STATUSES: readonly TaskStatus[] = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS];

export const DEFAULT_TASK_LIST_VIEW: TaskListView = {
  grouping: TASK_GROUPING.REPOSITORY,
  assignedTo: { kind: ASSIGNED_TO.ME },
  finishedSubTasks: false,
};

/** What a row of the list stands for: a task, or an agent with no task. */
export const TASK_ROW = {
  TASK: "task",
  AGENT: "agent",
} as const;

/** One row of the list: a task, or an agent an automation started with no task. */
export type TaskRow =
  | { readonly kind: typeof TASK_ROW.TASK; readonly task: TaskSummary }
  | { readonly kind: typeof TASK_ROW.AGENT; readonly agent: TasklessAgent };

/** The rows of one repository, as the sidebar groups them under its header; null is the rows with none. */
export interface RepositoryGroup {
  readonly repository: string | null;
  readonly rows: readonly TaskRow[];
}

/** The key a row is followed by, out of one list and into another: its task's id, or its agent's. */
export function taskRowKey(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.task.id : row.agent.id;
}

/** A task as a row of the list. */
export function taskRow(task: TaskSummary): TaskRow {
  return { kind: TASK_ROW.TASK, task };
}

/** An agent with no task as a row of the list. */
export function agentRow(agent: TasklessAgent): TaskRow {
  return { kind: TASK_ROW.AGENT, agent };
}

/** The row's name: its task's, or its agent's as its tab names it (`agentName`). */
export function taskRowName(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.task.name : agentName(row.agent);
}

/** The repository the row works in; null for a task with none chosen yet. */
export function taskRowRepository(row: TaskRow): string | null {
  return row.kind === TASK_ROW.TASK ? row.task.repository : row.agent.repository;
}

/** Who created a plan, by account id: the creator the wire names, else its owner. */
function creatorIdOf(task: TaskSummary): string | undefined {
  return task.createdBy?.userId ?? task.ownerId;
}

/** Who created the row, by account id: a task's creator, or whoever started the agent, whose automation it ran on. */
function taskRowCreatorId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? creatorIdOf(row.task) : row.agent.startedBy?.userId;
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

/** The time a row shows and is ordered by: its task's last activity (`taskTime`), or its agent's. */
export function taskRowTime(row: TaskRow): number {
  return row.kind === TASK_ROW.TASK ? taskTime(row.task, TASK_ORDER.UPDATED) : row.agent.activityAt;
}

/** The rows newest active first. */
export function orderTaskRows(rows: readonly TaskRow[]): TaskRow[] {
  return rows.toSorted((a, b) => taskRowTime(b) - taskRowTime(a));
}

/** The rows split by a key, each run kept in the order it was handed. */
function grouped<K>(rows: readonly TaskRow[], keyOf: (row: TaskRow) => K): Map<K, TaskRow[]> {
  const groups = new Map<K, TaskRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

/** The latest time among a group's rows. */
function latest(rows: readonly TaskRow[]): number {
  return Math.max(...rows.map(taskRowTime));
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
 * The rows grouped by their repository, newest updated first: the group
 * holding the latest row first, and the rows with none last whatever their
 * age.
 */
export function repositoryGroups(rows: readonly TaskRow[]): readonly RepositoryGroup[] {
  const groups = [...grouped(orderTaskRows(rows), taskRowRepository)].map(
    ([repository, members]) => ({ repository, rows: members }),
  );
  return groups.sort((a, b) => {
    if (a.repository === null || b.repository === null) {
      return Number(a.repository === null) - Number(b.repository === null);
    }
    return latest(b.rows) - latest(a.rows);
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

/** Where a row stands by progress, in the order the groups are drawn. */
export const TASK_PROGRESS = {
  NEEDS_YOU: "needs-you",
  WORKING: "working",
  IN_REVIEW: "in-review",
  UP_NEXT: "up-next",
} as const;

export type TaskProgress = (typeof TASK_PROGRESS)[keyof typeof TASK_PROGRESS];

/** What each progress group's heading says. */
export const TASK_PROGRESS_LABEL = {
  [TASK_PROGRESS.NEEDS_YOU]: "Needs you",
  [TASK_PROGRESS.WORKING]: "Working",
  [TASK_PROGRESS.IN_REVIEW]: "In review",
  [TASK_PROGRESS.UP_NEXT]: "Up next",
} as const satisfies Record<TaskProgress, string>;

/** The rows of one progress group, as the sidebar draws them under its heading. */
export interface ProgressGroup {
  readonly progress: TaskProgress;
  readonly rows: readonly TaskRow[];
}

/** What a row's progress is read from beside the row itself: the reader's waiting Inbox items, and each task's pull requests. */
export interface ProgressSignals {
  /** Whether an Inbox item of the row waits on the reader now (`needsYouOf`). */
  readonly needsYou: (row: TaskRow) => boolean;
  /** Every pull request a task's agents opened (`pullRequestsOfTask`). */
  readonly pullRequests: (taskId: string) => readonly Pick<TaskPullRequestLine, "state">[];
}

/** The agent statuses under which an agent with no task is at work. */
const AT_WORK: ReadonlySet<string> = new Set([AGENT_STATUS.STARTING, AGENT_STATUS.RUNNING]);

/**
 * Where a row stands by progress, the first group it qualifies for: Needs
 * you where an Inbox item of it waits on the reader or an agent of it
 * failed; Working where an agent is at work; In review where a pull request
 * of it is open, a draft not yet asking for review; else Up next.
 */
export function taskRowProgress(row: TaskRow, signals: ProgressSignals): TaskProgress {
  const failed =
    row.kind === TASK_ROW.TASK
      ? (row.task.agents?.failed ?? 0) > 0
      : row.agent.status === AGENT_STATUS.FAILED;
  if (signals.needsYou(row) || failed) return TASK_PROGRESS.NEEDS_YOU;
  const working =
    row.kind === TASK_ROW.TASK
      ? (row.task.agents?.working ?? 0) > 0
      : AT_WORK.has(row.agent.status);
  if (working) return TASK_PROGRESS.WORKING;
  const pullRequests =
    row.kind === TASK_ROW.TASK
      ? signals.pullRequests(row.task.id)
      : row.agent.pullRequest === undefined
        ? []
        : [row.agent.pullRequest];
  if (pullRequests.some((each) => each.state === PULL_REQUEST_STATE.OPEN)) {
    return TASK_PROGRESS.IN_REVIEW;
  }
  return TASK_PROGRESS.UP_NEXT;
}

/** The rows grouped by progress (`taskRowProgress`), the groups in their fixed order and an empty one left out, each newest updated first. */
export function progressGroups(
  rows: readonly TaskRow[],
  progressOf: (row: TaskRow) => TaskProgress,
): readonly ProgressGroup[] {
  const groups = grouped(orderTaskRows(rows), progressOf);
  return Object.values(TASK_PROGRESS).flatMap((progress) => {
    const members = groups.get(progress);
    return members === undefined ? [] : [{ progress, rows: members }];
  });
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
 * Who the row is assigned to, by account id: a task's assignee, none for a
 * task no one is on, or whoever started an agent with no task, which is
 * theirs.
 */
function taskRowAssigneeId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.assignee?.userId : row.agent.startedBy?.userId;
}

/**
 * The rows the view's Assigned to holds: every row for Anyone; one
 * teammate's (`taskRowAssigneeId`); and for Me the reader's, and the tasks
 * no one is on that the reader created, so their own unassigned work never
 * leaves the list. A reader not yet known filters nothing.
 */
export function taskRowsAssignedTo(
  rows: readonly TaskRow[],
  assignedTo: AssignedTo,
  readerId: string | undefined,
): readonly TaskRow[] {
  switch (assignedTo.kind) {
    case ASSIGNED_TO.ANYONE:
      return rows;
    case ASSIGNED_TO.MEMBER:
      return rows.filter((row) => taskRowAssigneeId(row) === assignedTo.userId);
    case ASSIGNED_TO.ME:
      if (readerId === undefined) return rows;
      return rows.filter((row) => {
        const assignee = taskRowAssigneeId(row);
        return assignee === undefined ? taskRowCreatorId(row) === readerId : assignee === readerId;
      });
  }
}

/** The status a row is left out by: its task's, or none for an agent with no task or a task from a service before statuses. */
function taskRowStatus(row: TaskRow): TaskStatus | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.status : undefined;
}

/** Whether the view draws a row: one of a status shown, or one with no status to leave it out by. */
export function taskRowInStatuses(row: TaskRow, statuses: readonly TaskStatus[]): boolean {
  const status = taskRowStatus(row);
  return status === undefined || statuses.includes(status);
}

/** The rows the view draws by status (`taskRowInStatuses`). */
export function taskRowsInStatuses(
  rows: readonly TaskRow[],
  statuses: readonly TaskStatus[],
): readonly TaskRow[] {
  return rows.filter((row) => taskRowInStatuses(row, statuses));
}

/**
 * Whether the view draws a row: one of a status the list shows
 * (`SHOWN_STATUSES`), or, while it shows finished sub-tasks, a sub-task
 * done or canceled, which stands under its parent wherever that is drawn
 * and nowhere where it is not (`homedTaskRows`), so a finished task at the
 * top stays out of the list.
 */
export function taskRowInView(row: TaskRow, view: Pick<TaskListView, "finishedSubTasks">): boolean {
  if (taskRowInStatuses(row, SHOWN_STATUSES)) return true;
  return (
    view.finishedSubTasks &&
    row.kind === TASK_ROW.TASK &&
    row.task.parentTaskId !== undefined &&
    taskFinished(row.task)
  );
}

/** One row as a list nesting child tasks draws it: how deep it stands, and whether the child tasks under it stand open. */
export interface DrawnTaskRow {
  readonly row: TaskRow;
  /** How deep it stands: 0 at the top, one more for each parent above it. */
  readonly depth: number;
  /** Whether its child tasks stand open under it; undefined where the list holds none of them. */
  readonly open: boolean | undefined;
}

/** One row and the rows standing under it, each a tree of its own. */
interface TaskRowNode {
  readonly row: TaskRow;
  readonly children: readonly TaskRowNode[];
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

/** The row a row stands under where `rows` holds it: its task's nearest ancestor `rows` holds (`heldAncestor`); none for an agent. */
function parentIn(row: TaskRow, held: ReadonlySet<string>, every: TasksById): string | undefined {
  if (row.kind !== TASK_ROW.TASK) return undefined;
  return heldAncestor(row.task, (taskId) => held.has(taskId), every);
}

/**
 * The rows as a tree, each in the order `rows` hands it. Note that a loop
 * of parents, which nothing writes, is reached from no row at the top, so
 * its first row is stood at the top, the loop cut where it closes, rather
 * than the loop leaving the list.
 */
function taskRowTree(rows: readonly TaskRow[], every: TasksById): TaskRowNode[] {
  const held = new Set(rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : [])));
  const childrenOf = new Map<string, TaskRow[]>();
  const tops: TaskRow[] = [];
  for (const row of rows) {
    const parent = parentIn(row, held, every);
    if (parent === undefined) tops.push(row);
    else childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), row]);
  }
  const reached = new Set<string>();
  const node = (row: TaskRow): TaskRowNode => {
    reached.add(taskRowKey(row));
    const children = row.kind === TASK_ROW.TASK ? (childrenOf.get(row.task.id) ?? []) : [];
    return {
      row,
      children: children.filter((child) => !reached.has(taskRowKey(child))).map(node),
    };
  };
  const tree = tops.map(node);
  for (const row of rows) if (!reached.has(taskRowKey(row))) tree.push(node(row));
  return tree;
}

/** Whether a row or any row under it is one `standing` keeps drawn. */
function holdsStanding(node: TaskRowNode, standing: (row: TaskRow) => boolean): boolean {
  return standing(node.row) || node.children.some((child) => holdsStanding(child, standing));
}

/**
 * The rows as a list nesting child tasks draws them, in order: each row,
 * then the child tasks under it while `opened` says it stands open, to any
 * depth, each in the order `rows` hands it. A task stands under its parent
 * where `rows` holds that parent, which the sidebar sees to across its
 * lists (`homedTaskRows`), or under its nearest ancestor `rows` holds where
 * the parent is one the view hides, walked through `every`; one none of
 * whose ancestors `rows` holds, as a fold leaves out all but the open task,
 * stands at the top, so it is never out of reach, and no row stands twice.
 * A row folded shut still draws the one `standing` keeps (the open task),
 * and the rows between it and that one, so the task worked on never leaves
 * the list, as a folded group keeps it.
 */
export function drawnTaskRows(
  rows: readonly TaskRow[],
  opened: (taskId: string) => boolean,
  standing: (row: TaskRow) => boolean,
  every: TasksById,
): DrawnTaskRow[] {
  const drawn: DrawnTaskRow[] = [];
  const draw = (node: TaskRowNode, depth: number) => {
    const { row, children } = node;
    const open =
      children.length === 0 || row.kind !== TASK_ROW.TASK ? undefined : opened(row.task.id);
    drawn.push({ row, depth, open });
    const under =
      open === false ? children.filter((child) => holdsStanding(child, standing)) : children;
    for (const child of under) draw(child, depth + 1);
  };
  for (const node of taskRowTree(rows, every)) draw(node, 0);
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
 * drawn nowhere, never at the top. A pinned task stays in Pinned, under no
 * parent.
 */
export function homedTaskRows(
  lists: readonly (readonly TaskRow[])[],
  every: TasksById,
): TaskRow[][] {
  const listOf = new Map<string, number>();
  const byId = new Map<string, TaskSummary>();
  lists.forEach((rows, list) => {
    for (const row of rows) {
      if (row.kind !== TASK_ROW.TASK || listOf.has(row.task.id)) continue;
      listOf.set(row.task.id, list);
      byId.set(row.task.id, row.task);
    }
  });
  const held = (taskId: string) => listOf.has(taskId);
  const homeOf = (row: TaskRow, list: number): number | undefined => {
    if (row.kind !== TASK_ROW.TASK) return list;
    const walked = new Set([row.task.id]);
    let at = row.task;
    // Note that a loop of parents, which nothing writes, ends the walk where it closes, at the last task it reached.
    for (let above = heldAncestor(at, held, every); above !== undefined; ) {
      const parent = byId.get(above);
      if (parent === undefined || walked.has(parent.id)) break;
      walked.add(parent.id);
      at = parent;
      above = heldAncestor(at, held, every);
    }
    return at === row.task && underParent(at) ? undefined : listOf.get(at.id);
  };
  const homed = lists.map((rows, list) => rows.map((row) => ({ row, home: homeOf(row, list) })));
  return lists.map((_, list) => [
    ...(homed[list] ?? []).flatMap(({ row, home }) => (home === list ? [row] : [])),
    ...homed.flatMap((rows, from) =>
      from === list ? [] : rows.flatMap(({ row, home }) => (home === list ? [row] : [])),
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
  return task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.CANCELED;
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
