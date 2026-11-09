import type { Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { ChevronDownIcon, dropBelowStart, GearIcon, NavItem, PlusIcon, useMenu } from "@repo/ui";
import { ShieldUserIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { useNewTaskDrafted } from "../composer-drafts.js";
import { useOpenSettings } from "../open-settings.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectAdminAccess } from "../use-app-state.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { NewTaskButton } from "./new-task-button.js";
import { useOpenNewWorkspace } from "./new-workspace.js";
import { sharedWords, WORKSPACE_REF_SIZE, WorkspaceCard, WorkspaceRef } from "./workspace-ref.js";
import { WorkspaceTile } from "./workspace-tile.js";

/**
 * workspace-switcher.tsx -- the sidebar's head: the workspace listed, by its tile and name and who shares it, the menu that lists another, and New task at the row's end.
 *
 * A workspace is a team's shared tasks, the first one made for the account
 * among them, and the sidebar lists one at a time. Its head stands at the
 * sidebar's top left, where Slack, Linear, and Vercel name the scope
 * everything under it belongs to: one control's row, standing on the line
 * the agents' tabs beside it stand on, its middle where theirs is
 * (`shell.css`), holding the workspace's tile and its name alone, as
 * Linear's and Slack's do. Who shares it, "5 members", or "Personal
 * workspace" for the account's own first workspace while no one else is in
 * it (`automations-page.tsx` reads the first listed as the account's own
 * too), is what a reader hears after its name and what its menu's row says,
 * since beside the name on one control's row it would be cut short. A press
 * drops the menu of every workspace the account is a member of from its left
 * edge, each by its tile with who shares it under its name, the listed one
 * checked and the workspace's card hung beside it while the pointer rests on it, then New workspace, which
 * opens its cards over the window (`new-workspace-steps.tsx`), and Workspace settings, which
 * opens Settings on the listed workspace's page, where its members and its
 * GitHub are managed, and for an admin alone, Admin, which opens the
 * window's Admin place (`desktop-admin.tsx`) in the task's place, its chunk
 * read as the pointer comes onto it; a non-admin is offered nothing in its
 * place, and the service's own gate decides every read the place makes.
 * Nothing else stands in the menu. New task's glyph closes the row, the
 * switcher keeping the rest of it, so its fill stops short of the glyph and
 * a long name fades out before it (`new-task-button.tsx`). The head stands
 * whenever an account is signed in and its workspaces are read, its first
 * workspace alone included, because its menu is where a workspace is made;
 * before then the sidebar's head is the app's.
 */

/** What Admin's item opens, and reads ahead of a press as the pointer comes onto it. */
export interface AdminMenuDoor {
  readonly onOpen: () => void;
  readonly onPreload: () => void;
}

/** What the menu's last items open: New workspace's cards, Settings, and for an admin, Admin. */
export interface WorkspaceMenuDoors {
  readonly onNewWorkspace: () => void;
  readonly onOpenSettings: (link: SettingsLink) => void;
  /** Admin's door, for an admin alone; none offers no Admin item. */
  readonly admin?: AdminMenuDoor | undefined;
}

/** The window's doors the menu's last items open, read where the menu is drawn, Admin's handed in and kept for an admin alone. */
export function useWorkspaceMenuDoors(admin: AdminMenuDoor): WorkspaceMenuDoors {
  const isAdmin = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  return {
    onNewWorkspace: useOpenNewWorkspace(),
    onOpenSettings: useOpenSettings(),
    admin: isAdmin ? admin : undefined,
  };
}

/** The menu's items: every workspace by its tile, with who shares it under its name, the listed one checked; then New workspace, Workspace settings, which opens Settings on the listed workspace's page, and Admin where its door is given. */
export function workspaceMenuGroups(
  listed: Workspace,
  tasks: TasksControl,
  doors: WorkspaceMenuDoors,
): MenuAction[][] {
  const first = tasks.workspaces[0]?.id;
  const choices = tasks.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      key: workspace.id,
      replayMasked: true,
      icon: (
        <ReplayMask>
          <WorkspaceTile workspace={workspace} />
        </ReplayMask>
      ),
      detail: sharedWords(workspace.memberCount, workspace.id === first),
      card: <WorkspaceCard workspace={workspace} personal={workspace.id === first} />,
      checked: workspace.id === listed.id,
      onSelect: () => tasks.onChooseWorkspace(workspace.id),
    }),
  );
  return [
    choices,
    [
      { label: "New workspace", icon: <PlusIcon />, onSelect: doors.onNewWorkspace },
      {
        label: "Workspace settings",
        icon: <GearIcon />,
        onSelect: () =>
          doors.onOpenSettings({ page: SETTINGS_VIEW.WORKSPACE, workspaceId: listed.id }),
      },
      ...(doors.admin === undefined
        ? []
        : [
            {
              label: "Admin",
              icon: <ShieldUserIcon />,
              onSelect: doors.admin.onOpen,
              // The pointer on the item is the way to the place, so its chunk, charts and all, is read now rather than at the press.
              onPoint: doors.admin.onPreload,
            },
          ]),
    ],
  ];
}

/** What New task's glyph at the row's end is drawn with and opens. */
export interface WorkspaceRowNewTask {
  /** Whether New task's words are in sight: its card open, or Home shown. */
  readonly shown: boolean;
  readonly onOpen: () => void;
}

/** The sidebar's head while an account is signed in and its workspaces are read. */
export function WorkspaceSwitcher({
  tasks,
  inSight,
  newTask,
  admin,
}: {
  tasks: TasksControl;
  /** Whether the sidebar is in sight, so the menu closes with it folding away. */
  inSight: boolean;
  newTask: WorkspaceRowNewTask;
  admin: AdminMenuDoor;
}): React.JSX.Element | null {
  const menu = useMenu(tasks.shown && inSight);
  const doors = useWorkspaceMenuDoors(admin);
  const drafted = useNewTaskDrafted(tasks.newTask.workspaceId) && tasks.signedIn && !newTask.shown;
  const listed = tasks.workspace;
  if (listed === undefined) return null;
  const personal = tasks.workspaces[0]?.id === listed.id;
  return (
    <div className="sidebar-workspace flex flex-none items-center gap-control-gap">
      <NavItem
        // The name a reader hears says who shares it too, since the label stands for the button's text.
        aria-label={[`Workspace: ${listed.name}`, sharedWords(listed.memberCount, personal)]
          .filter((part) => part !== undefined)
          .join(", ")}
        menu={menu.trigger(dropBelowStart)}
        mark={<ChevronDownIcon />}
      >
        <WorkspaceRef workspace={listed} size={WORKSPACE_REF_SIZE.HEAD} />
      </NavItem>
      <NewTaskButton
        tasks={tasks}
        current={newTask.shown}
        drafted={drafted}
        onNewTask={newTask.onOpen}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Workspaces"
          replayUnmasked
          menu={menu.drawn}
          groups={workspaceMenuGroups(listed, tasks, doors)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}
