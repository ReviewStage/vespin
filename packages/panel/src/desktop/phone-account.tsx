import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { WORKSPACE_SWITCHER_WORDS, workspaceSharedWords } from "@repo/features/workspace-tile";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { dropBelowStart, IconButton, useMenu } from "@repo/ui";
import { MessageSquareIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { runAppCommand } from "../app-commands.js";
import { useAdminDoor } from "../places/routed-doors.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import { AccountAvatar, useAccountMenuGroups } from "./sidebar-foot.js";
import type { SidebarTasksControl } from "./sidebar-open.js";
import { useWorkspaceMenuDoors, workspaceMenuGroups } from "./workspace-switcher.js";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

/**
 * phone-account.tsx -- a phone's switcher: the listed workspace's tile in the start corner of a place's head, opening one menu of the workspaces and the account.
 *
 * On the desktop the sidebar splits these between its head, the workspace
 * switcher, and its foot, the account's menu. A phone's places draw neither
 * (`desktop-sidebar.tsx`), so every place's head leads with the workspace's
 * tile alone, with no name, as the iOS app's tab roots do, the place's
 * actions at the head's other end. Its menu holds what the iOS app's does,
 * in its order: the workspaces, the listed one checked; New workspace;
 * Workspace settings, and Admin for an admin, as the desktop's switcher
 * names them; then Settings, led by the account's face, with whose account
 * it is under it. After them stand what the web offers beyond the iOS app:
 * Send feedback, which the desktop's foot draws beside its account, then the
 * account menu's items, each the same as the desktop's. Until the
 * workspaces are read, the account's face stands in the tile's place.
 */

/** The tile and its menu; see the module's head. */
export function PhoneAccount({
  tasks,
  account,
  onSettings,
  onSignOut,
}: {
  tasks: SidebarTasksControl;
  account: AccountSnapshot;
  onSettings: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const menu = useMenu(tasks.shown);
  const accountGroups = useAccountMenuGroups(account, onSignOut);
  const admin = useAdminDoor(tasks);
  const doors = useWorkspaceMenuDoors({ onOpen: () => admin.open(), onPreload: admin.preload });
  const listed = tasks.workspace;
  const workspaceGroups = listed === undefined ? [] : workspaceMenuGroups(listed, tasks, doors);
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined;

  // Settings, led by whose account it is, as the iOS app's last row is; then Send feedback, which the desktop's foot draws beside the account.
  const accountGroup: MenuEntry[] = [
    {
      label: "Settings",
      icon: <AccountAvatar account={account} />,
      detail: signedIn?.email,
      detailMasked: true,
      onSelect: onSettings,
    },
    {
      label: "Send feedback",
      icon: <MessageSquareIcon />,
      onSelect: () => runAppCommand(APP_COMMAND.SEND_FEEDBACK),
    },
  ];

  // The name a reader hears says who shares it too, as the desktop's switcher says it.
  const label =
    listed === undefined
      ? "Account"
      : [
          `Workspace: ${listed.name}`,
          workspaceSharedWords(listed.memberCount, tasks.workspaces[0]?.id === listed.id),
        ]
          .filter((part) => part !== undefined)
          .join(", ");

  return (
    <>
      <IconButton
        icon={
          listed === undefined ? (
            <AccountAvatar account={account} />
          ) : (
            <ReplayMask>
              <WorkspaceTile workspace={listed} size={TILE_SIZE.BAR} />
            </ReplayMask>
          )
        }
        label={label}
        {...menu.trigger(dropBelowStart)}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={WORKSPACE_SWITCHER_WORDS.MENU}
          replayUnmasked
          menu={menu.drawn}
          groups={[...workspaceGroups, accountGroup, ...accountGroups]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
