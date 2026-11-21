import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { agentOfTab } from "@repo/ui/tab-strip-model";
import type { HistoryRows } from "./places/history-rows.js";
import type { RoutedPlace } from "./places/routed-places.js";
import type { StepTitle } from "./places/window-steps.js";
import { agentName } from "./tasks/agent-model.js";
import {
  stripTabTitle,
  type TabNames,
  UNREAD_TAB_NAMES,
  untitledStripTab,
} from "./tasks/strip-tab-kinds.js";
import { isOverviewTab, type MainTab } from "./tasks/use-main-tabs.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";
import type { RoutedViews } from "./workspace-routes.js";

/**
 * history-titles.ts -- what each step of the window's history is called, as Back's and Forward's menus and ⌃Tab's cards list it.
 *
 * A step is named as the window stands on it, since a tab's name is known
 * only while its task is open: the page by what the window's title calls it
 * (`window-title.ts`), and a task's step by the task, with the tabs its
 * column and side panel showed under it, "Fix token refresh · Code": the
 * column's Overview as the task's description, "Fix token refresh ·
 * Description", and an agent's threads over its transcript under the
 * agent's name, "Fix token refresh · Token renewal · Threads". An
 * Inbox item's step names the item's thread and the task it is of, so the
 * items of one task are told apart. A page of Settings, Admin, or the
 * Automations is named under its place, "Admin · Limits", so its steps read
 * apart.
 *
 * A step listed later is named again as what it names stands now
 * (`liveStepTitle`), by the ids it stood on: a task by the name the task
 * list gives it, an agent's tab by its agent's name as the open task's
 * agents or the task's row's agent line give it, each read by its id
 * (`places/history-rows.ts`), and a person's page by
 * the name the workspace's members give them. So a task, agent, or person
 * renamed since is listed under the new name, and the name kept as the step
 * stood is only what a step falls back to where nothing the window reads
 * names it now.
 */

/** What a version history's step says under its task's name. */
export const VERSION_HISTORY_WORDS = "Version history";

/** What the Inbox's step is called. */
export const INBOX_WORDS = "Inbox";

/** What the Merge queue page is called, its step's name and its row's. */
export const MERGE_QUEUE_WORDS = "Merge queue";

/** What Settings is called, its step's name over the page it stands on. */
export const SETTINGS_WORDS = "Settings";

/** What Admin is called, its step's name over the view it stands on. */
export const ADMIN_WORDS = "Admin";

/** What the Automations pages are called, their step's name over the page that stands. */
export const AUTOMATIONS_WORDS = "Automations";

/** What the Automations runs tab's step says under its name. */
export const AUTOMATION_RUNS_WORDS = "Runs";

/** What a new automation's step says under its name. */
export const NEW_AUTOMATION_WORDS = "New automation";

/** What Home is called, as its step and its page name it. */
export const HOME_WORDS = "Home";

/** What a task's step says of its column's Overview, the task's description. */
export const DESCRIPTION_WORDS = "Description";

/** What a task's step says after an agent's name where its card showed its threads. */
export const THREADS_WORDS = "Threads";

/** What a step's name is read again from: the task list's rows by id, the names being typed for tasks, the open task's agents and pages, and the thread an Inbox item's id names, where the account's items are read. */
type StepNameTasks = Pick<TasksControl, "typedNames" | "activeTaskId" | "agents" | "pages"> & {
  readonly rows: HistoryRows;
  readonly itemTitle?: ((itemId: string) => string | undefined) | undefined;
};

/** The name an agent of a task goes by now: as the open task's agents say, else as the list followed live does, where it lists the agent on that task; none where neither names it. */
function agentNameNow(tasks: StepNameTasks, taskId: string, agentId: string): string | undefined {
  const open = taskId === tasks.activeTaskId ? tasks.agents.rowNow(agentId) : undefined;

  const listed = tasks.rows.agent(agentId);
  const line = open ?? (listed?.taskId === taskId ? listed : undefined);

  return line === undefined ? undefined : agentName(line, tasks.agents.models);
}

/**
 * How a task's step names its tabs now: an agent as `agentNameNow` does, a
 * page by its title where its task is the open one, whose pages alone are
 * read, and a worker by the word for one.
 */
function stepNames(tasks: StepNameTasks, taskId: string): TabNames {
  return {
    ...UNREAD_TAB_NAMES,
    agent: (agentId) => agentNameNow(tasks, taskId, agentId),
    subagent: () => "Worker",
    page: (tab) =>
      taskId === tasks.activeTaskId
        ? tasks.pages?.find((page) => page.id === tab.page)?.title
        : undefined,
  };
}

/** What a column tab of a task is called now, the description for its Overview; none for an agent named nowhere the window reads. */
function columnTabLabel(tab: MainTab, taskId: string, tasks: StepNameTasks): string | undefined {
  return isOverviewTab(tab) ? DESCRIPTION_WORDS : stripTabTitle(tab, stepNames(tasks, taskId));
}

/** What a step's column is called, its agent's threads after its name where its card showed them. */
function withThreads(column: string, threads: boolean): string {
  return threads ? `${column} · ${THREADS_WORDS}` : column;
}

/** What a side panel tab of a task is called under its task's name now; none for an agent named nowhere the window reads, or a page of a task not open, whose pages are not read. */
function sideTabLabel(tab: SidePanelTab, taskId: string, tasks: StepNameTasks): string | undefined {
  return stripTabTitle(tab, stepNames(tasks, taskId));
}

/** What a side panel tab is called as the window stands on it, its kind's word where nothing names it. */
function shownSideTabLabel(tab: SidePanelTab, taskId: string, tasks: StepNameTasks): string {
  return sideTabLabel(tab, taskId, tasks) ?? untitledStripTab(tab);
}

/** The parts of the Tasks tab a step's name reads. */
type TitleTasksControl = Pick<
  TasksControl,
  | "typedNames"
  | "boundFor"
  | "activeTaskId"
  | "agents"
  | "pages"
  | "mainTabs"
  | "sidePanel"
  | "workspace"
  | "agentView"
  | "history"
  | "agentThreads"
>;

/** What a step's name reads: the parts of the Tasks tab it reads, and the task list's rows by id. */
export type StepTitleTasks = TitleTasksControl & { readonly rows: HistoryRows };

/** The name of a task the account lists, where it is listed, as it is being typed where it is. */
export function taskName(tasks: StepNameTasks, taskId: string | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  const listed = tasks.rows.task(taskId);

  return listed === undefined ? undefined : (tasks.typedNames.get(taskId) ?? listed.name);
}

/** What the step the window stands on is called; none while nothing names it, as a task not yet listed. A routed place names its step by its declaration (`places/routed-places.ts`), the place under it by the window's state. */
export function stepTitle(
  routed: RoutedPlace | undefined,
  control: TitleTasksControl,
  rows: HistoryRows,
  views: RoutedViews,
): StepTitle | undefined {
  const tasks: StepTitleTasks = { ...control, rows };
  const under = () => stateStepTitle(tasks);

  return routed === undefined ? under() : routed.title(tasks, under, views);
}

/** What the step of the place the window's state says is called. */
function stateStepTitle(tasks: StepTitleTasks): StepTitle | undefined {
  if (tasks.boundFor === undefined) return { label: HOME_WORDS };
  const name = taskName(tasks, tasks.boundFor);

  if (name === undefined) return undefined;

  // Note that the strips are named only once they are the task's, as the history reads them.
  if (tasks.activeTaskId !== tasks.boundFor) return { label: name };
  const { boundFor } = tasks;
  const columnTab = tasks.mainTabs.tab;
  const columnAgent = agentOfTab(columnTab);
  const label = columnTab === undefined ? undefined : columnTabLabel(columnTab, boundFor, tasks);

  const threads =
    columnAgent !== undefined && tasks.agentThreads.shown(boundFor, columnAgent) !== undefined;

  const column = label === undefined ? undefined : withThreads(label, threads);

  const side =
    tasks.sidePanel.open && tasks.sidePanel.tab !== undefined
      ? shownSideTabLabel(tasks.sidePanel.tab, boundFor, tasks)
      : undefined;

  const shown = [column, side].filter((part) => part !== undefined);

  if (shown.length === 0) return { label: name, detail: undefined };

  return { label: name, detail: shown.join(" · "), panes: { column, side } };
}

/** The kinds of step a name is read again for: those naming a task, a task's Inbox item, or a person. */
export const NAMED_STEP = {
  TASK: "task",
  VERSION_HISTORY: "version-history",
  INBOX: "inbox",
  PERSON: "person",
} as const;

/** A step by the ids its name is read from: a task with the tabs its panes showed, its version history, the Inbox on an item of a task, or a person's page. */
export type NamedStep =
  | {
      readonly kind: typeof NAMED_STEP.TASK;
      readonly taskId: string;
      readonly column: MainTab | undefined;
      readonly side: SidePanelTab | undefined;
      /** Whether the column's agent's card showed its threads. */
      readonly threads: boolean;
    }
  | { readonly kind: typeof NAMED_STEP.VERSION_HISTORY; readonly taskId: string }
  | {
      readonly kind: typeof NAMED_STEP.INBOX;
      readonly taskId: string | undefined;
      readonly itemId: string | undefined;
    }
  | { readonly kind: typeof NAMED_STEP.PERSON; readonly userId: string };

/** The name a person goes by now, by their id, as the workspace's members say; none for someone not among them, or while they are unread. */
function memberName(
  members: readonly WorkspaceMember[] | undefined,
  userId: string,
): string | undefined {
  return members?.find((member) => member.userId === userId)?.name;
}

/** A task's step named again: its task's name now, and each of its tabs' now, or as the step called it where nothing names it now. */
function liveTaskTitle(
  step: Extract<NamedStep, { kind: typeof NAMED_STEP.TASK }>,
  kept: StepTitle | undefined,
  tasks: StepNameTasks,
): StepTitle | undefined {
  const label = taskName(tasks, step.taskId) ?? kept?.label;

  if (label === undefined) return undefined;
  const { taskId, column, side, threads } = step;
  const named = column === undefined ? undefined : columnTabLabel(column, taskId, tasks);

  // Note that `null` is a pane that showed no tab, and `undefined` a tab named neither now nor as kept, which leaves the words kept whole.
  const columnName =
    column === undefined
      ? null
      : named === undefined
        ? kept?.panes?.column
        : withThreads(named, threads);

  const sideName =
    side === undefined ? null : (sideTabLabel(side, taskId, tasks) ?? kept?.panes?.side);

  if (columnName === undefined || sideName === undefined) return { label, detail: kept?.detail };
  const shown = [columnName, sideName].filter((part) => part !== null);

  return { label, detail: shown.length === 0 ? undefined : shown.join(" · ") };
}

/**
 * What a step listed later is called: its name as it was kept, `kept`,
 * read again from what it names as that stands now, by the ids it stood on
 * (`step`), so a renamed task, agent, or person is listed by the new name.
 * Note that what nothing the window reads names now keeps its kept name,
 * and a step of no kind named again is called as it was kept.
 */
export function liveStepTitle(
  step: NamedStep | undefined,
  kept: StepTitle | undefined,
  tasks: StepNameTasks,
  members: readonly WorkspaceMember[] | undefined,
): StepTitle | undefined {
  switch (step?.kind) {
    case undefined:
      return kept;
    case NAMED_STEP.TASK:
      return liveTaskTitle(step, kept, tasks);
    case NAMED_STEP.VERSION_HISTORY: {
      const label = taskName(tasks, step.taskId) ?? kept?.label;

      return label === undefined ? undefined : { label, detail: VERSION_HISTORY_WORDS };
    }

    case NAMED_STEP.INBOX: {
      // Note that an Inbox step names an item only where it was kept naming one, as one column standing its list names none.
      const task = kept?.detail === undefined ? undefined : taskName(tasks, step.taskId);
      const thread = step.itemId === undefined ? undefined : tasks.itemTitle?.(step.itemId);
      const shown = [thread, task ?? kept?.detail].filter((part) => part !== undefined);

      return {
        label: kept?.label ?? INBOX_WORDS,
        detail: shown.length === 0 ? undefined : shown.join(" · "),
      };
    }

    case NAMED_STEP.PERSON: {
      const label = memberName(members, step.userId) ?? kept?.label;

      return label === undefined ? undefined : { label, detail: kept?.detail };
    }
  }
}
