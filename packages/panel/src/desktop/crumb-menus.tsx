import { AGENT_BOUNDS, type AgentSummary } from "@repo/features/agent-wire";
import { TASK_BOUNDS, type TaskSummary } from "@repo/features/task-wire";
import { RENAME_FAILED_NOTE } from "@repo/features/tasks-model";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import { ANNOUNCE, type CrumbMenu, InlineEdit, moreLabel, useMenu } from "@repo/ui";
import { confirmAsked } from "@repo/ui/confirm-state";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import { useMutation } from "@tanstack/react-query";
import { FOCUSED_OFFER, useAppCommand } from "../app-commands.js";
import { renameWrite } from "../rename-write.js";
import { useShortcutTarget } from "../shortcut-target.js";
import { agentName } from "../tasks/agent-model.js";
import { TASK_RENAME_TERMS, useTaskRename } from "../tasks/task-rename.js";
import { TRANSCRIPT_COPY } from "../tasks/transcript-copy.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { ActionMenu } from "./action-menu.js";
import { agentMenuGroups, useAgentActions } from "./agent-actions.js";
import { openedTaskOf, TASK_MENU_LABEL, taskRowTab, useTaskMenuItems } from "./task-actions.js";

/**
 * crumb-menus.tsx -- the menus a path's crumbs hold on a right-click: a task's crumb the task's one menu, as its sidebar row and its topbar offer it, and an agent's crumb the agent's, as its page's bar offers it, each crumb turning into its name's field while Rename edits it.
 *
 * Each is drawn around the path holding its crumb and hands the crumb its
 * menu and its field (`children`), so a path naming no task, or an agent
 * the window does not list, draws neither and reads nothing for them.
 *
 * A path may hand a crumb's thing the window's keys (`keys`), as an Inbox
 * thread holding the keyboard hands its task ⌘⌫ and Version history and its
 * agent its transcript's copies, as Linear's Inbox acts on the issue shown:
 * the crumb offers each key as its menu's item runs it, Permanently delete
 * still asking first, answering over whatever else offers it while it
 * stands, and says the keys act on its thing (`useShortcutTarget`), so its
 * menu prints them. U and P stay the thread's, so no crumb is handed them.
 */

/** No keys: a crumb drawn where its path holds none of the window's. */
export const NO_CRUMB_KEYS: readonly KeyedCommand[] = [];

/** The keys an Inbox thread hands its task. */
export const THREAD_TASK_KEYS: readonly KeyedCommand[] = [
  APP_COMMAND.DELETE,
  APP_COMMAND.VERSION_HISTORY,
];

/** The keys an Inbox thread on a task hands its agent: its transcript's copies, its task taking ⌘⌫. */
export const THREAD_AGENT_COPY_KEYS: readonly KeyedCommand[] = [
  APP_COMMAND.COPY_CONTENT,
  APP_COMMAND.COPY_FULL_TRANSCRIPT,
];

/** What the agent's menu is named, as its page's ⋯ names it. */
const AGENT_THING = "Agent";

/** What a crumb holds of what it names: the menu its right-click opens, and the field it stands as while Rename edits its name. */
export interface CrumbHeld {
  readonly menu: CrumbMenu;
  readonly editing: React.ReactNode;
}

/**
 * A task's crumb's menu: the task's one menu (`useTaskMenuItems`), its
 * Rename turning the crumb into the task's name field, as a sidebar row's
 * turns the row, and the questions its items ask.
 */
export function TaskCrumbMenu({
  tasks,
  task,
  keys,
  children,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  /** The window's keys the path hands the task while it holds them (`THREAD_TASK_KEYS`). */
  keys: readonly KeyedCommand[];
  children: (held: CrumbHeld) => React.ReactNode;
}): React.JSX.Element {
  const menu = useMenu(tasks.shown);
  const renaming = useMutation(useTaskRename(tasks.drawnTasks));
  const rename = useInlineRename(task.id, renameWrite(renaming, TASK_RENAME_TERMS));
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const unread = useUnreadTasks({ staged: false })(task);

  const items = useTaskMenuItems(taskRowTab(tasks), task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread,
    opened: openedTaskOf(tasks),
  });

  const { deletion } = items;
  const descriptions = useWorkspaceExperiment(task.workspaceId, EXPERIMENT.DESCRIPTIONS);
  useShortcutTarget(keys.length === 0 ? undefined : items.keysOn, keys);
  useAppCommand(
    APP_COMMAND.DELETE,
    keys.includes(APP_COMMAND.DELETE) && !confirmAsked(deletion.stage) && !deletion.busy
      ? deletion.ask
      : undefined,
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.VERSION_HISTORY,
    keys.includes(APP_COMMAND.VERSION_HISTORY) && descriptions
      ? () => tasks.onOpenHistory(task.id)
      : undefined,
    FOCUSED_OFFER,
  );

  const editing = rename.editing ? (
    <InlineEdit
      value={rename.asked ?? task.name}
      label="Task name"
      maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
      editing
      onEnd={(edit) => rename.end(edit.value)}
    />
  ) : undefined;

  return (
    <>
      {children({ menu: { contextMenu: menu.contextMenu(), keyMenu: menu.keyMenu }, editing })}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={TASK_MENU_LABEL}
          menu={menu.drawn}
          subject={items.subject}
          footer={items.footer}
          groups={items.groups()}
          onClose={menu.close}
        />
      )}
      {items.dialog}
    </>
  );
}

/**
 * An agent's crumb's menu: the agent's one menu as its page's bar offers it
 * (`agentMenuGroups`), its Rename turning the crumb into the agent's name
 * field, and the questions its items ask.
 * Note that no side panel stands beside the path, so it opens no terminal.
 */
export function AgentCrumbMenu({
  tasks,
  agents,
  agent,
  keys,
  children,
}: {
  tasks: TasksControl;
  agents: AgentsControl;
  agent: AgentSummary;
  /** The window's keys the path hands the agent while it holds them (`THREAD_AGENT_COPY_KEYS`). */
  keys: readonly KeyedCommand[];
  children: (held: CrumbHeld) => React.ReactNode;
}): React.JSX.Element {
  const { shown } = tasks;
  const label = agentName(agent, agents.models);
  const menu = useMenu(shown);

  const actions = useAgentActions(agent, agents, {
    label,
    shown,
    terminals: { onOpenTerminal: undefined },
  });

  const { onCopy } = actions.doors;
  const copies = onCopy === undefined ? NO_CRUMB_KEYS : keys;
  useShortcutTarget(keys.length === 0 ? undefined : actions.subject, keys);
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    copies.includes(APP_COMMAND.COPY_CONTENT) && onCopy !== undefined
      ? () => onCopy(TRANSCRIPT_COPY.CONCISE)
      : undefined,
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.COPY_FULL_TRANSCRIPT,
    copies.includes(APP_COMMAND.COPY_FULL_TRANSCRIPT) && onCopy !== undefined
      ? () => onCopy(TRANSCRIPT_COPY.FULL)
      : undefined,
    FOCUSED_OFFER,
  );
  const groups = agentMenuGroups({ ...actions.doors, subject: actions.subject });
  const { rename } = actions;

  const editing =
    rename?.editing === true ? (
      <InlineEdit
        value={rename.asked ?? label}
        label="Agent name"
        maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
        editing
        onEnd={(edit) => rename.end(edit.value)}
      />
    ) : undefined;

  return (
    <>
      {children({ menu: { contextMenu: menu.contextMenu(), keyMenu: menu.keyMenu }, editing })}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(AGENT_THING)}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {actions.dialog}
    </>
  );
}
