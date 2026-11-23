// workspace-switcher.tsx -- the workspace the phone works in as a tab's root names it: its tile at the bar's leading edge, opening the system's menu of every workspace, New workspace, the chosen workspace's Manage under its name, then the account opening Settings.

import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceSharedWords } from "@repo/features/workspace-tile";
import type { Workspace } from "@repo/features/workspace-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  MARK_SIZE,
  newWorkspaceAction,
  type SwitcherWorkspace,
  type WorkspaceSwitcher,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ComponentProps, useMemo } from "react";
import { useChosenWorkspace } from "./chosen-workspace.js";
import { appStateQuery } from "./host/app-state-query.js";
import { type MenuPictures, menuAddress, useMenuPictures } from "./menu-photos.js";
import { SETTINGS_ROUTE, useOpenSettings, useSettingsAccount } from "./settings-button.js";

/** No workspaces read yet, one list for every render. */
const NO_WORKSPACES: readonly Workspace[] = [];

/** What the switcher is drawn from, which a tab's root bar draws it by. */
export type SwitcherProps = ComponentProps<typeof WorkspaceSwitcher>;

/** Each workspace's photo as the host holds it, by the workspace. */
export function selectPhotos(
  state: AppStateSnapshot,
): AppStateSnapshot[typeof LIVE_READ.WORKSPACE_PHOTOS] {
  return state[LIVE_READ.WORKSPACE_PHOTOS];
}

/**
 * A workspace as its tile and its row in the switcher's list draw it, as the panel's are
 * (`workspace-tile.tsx`, `workspace-switcher.tsx`): its photo where the host
 * holds the one at the version the list names, else its owner's picture
 * where it has no photo, else its letter; and who shares it, the account's
 * first workspace said as its own while no one else is in it.
 */
export function switcherWorkspace(
  workspace: Workspace,
  first: boolean,
  photos: AppStateSnapshot[typeof LIVE_READ.WORKSPACE_PHOTOS] | undefined,
  pictures?: MenuPictures,
): SwitcherWorkspace {
  const held = photos?.[workspace.id]?.rows;

  const photo =
    workspace.photoVersion !== undefined && held?.version === workspace.photoVersion
      ? held.url
      : undefined;

  const picture = workspace.photoVersion === undefined ? workspace.pictureUrl : undefined;
  const address = menuPictureAddress(photo, picture);

  return {
    id: workspace.id,
    name: workspace.name,
    line: workspaceSharedWords(workspace.memberCount, first),
    photo,
    picture,
    menuPhoto: address === undefined ? undefined : pictures?.fileOf(address),
    menuPhotoComing: address !== undefined && pictures?.coming(address) === true,
  };
}

/** What a workspace's picture is kept as a file from, which its menu row and its bar's tile draw: its photo as held, else its owner's picture at the bar tile's size; none for a workspace that draws its letter. */
function menuPictureAddress(photo: string | undefined, picture: string | undefined) {
  return photo ?? menuAddress(picture, MARK_SIZE.BAR_FACE);
}

/**
 * The switcher's workspaces, the chosen one, the account, and its acts: a
 * choice is kept as the phone's (`chosen-workspace.ts`), which the Inbox, its
 * count, Tasks, and New task follow at once; the account opens Settings on
 * its main list, as Notion's one workspace button does, so the bar holds no
 * photo of its own beside it; New workspace opens its sheet, and Workspace
 * settings opens Settings on the chosen workspace's page. A landscape iPad's
 * sidebar draws it without the account, which its foot holds instead. Each
 * workspace's photo and the account's are kept as files for the menu to
 * draw. None before the account's workspaces are read.
 */
export function useWorkspaceSwitcher(): SwitcherProps | undefined {
  const router = useRouter();
  const openSettings = useOpenSettings();
  const account = useSettingsAccount();

  const { data: workspaces = NO_WORKSPACES } = useQuery({
    ...appStateQuery,
    select: selectWorkspaces,
  });

  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const { chosen, choose } = useChosenWorkspace(workspaces);
  const signedIn = account !== undefined;
  const accountName = account?.name;
  const accountPicture = account?.picture;

  // Note that a system menu draws only an image file it reads as it opens, so each picture it leads a row with is kept as a file first.
  const addresses = useMemo(() => {
    const held = workspaces.flatMap((workspace) => {
      const { photo, picture } = switcherWorkspace(workspace, false, photos);
      const address = menuPictureAddress(photo, picture);

      return address === undefined ? [] : [address];
    });

    const own = menuAddress(accountPicture);

    return own === undefined ? held : [...held, own];
  }, [workspaces, photos, accountPicture]);

  const pictures = useMenuPictures(addresses);
  const ownAddress = menuAddress(accountPicture);
  const accountMenuPhoto = ownAddress === undefined ? undefined : pictures.fileOf(ownAddress);

  // Note that the switcher is drawn from the same props while nothing it shows moved, so every tab root's switcher and its SwiftUI host draw nothing anew when the screen around it does, as an Inbox screen does on each delivery.
  return useMemo(() => {
    if (chosen === undefined) return undefined;
    const first = workspaces[0]?.id;

    return {
      workspaces: workspaces.map((workspace) =>
        switcherWorkspace(workspace, workspace.id === first, photos, pictures),
      ),
      chosen: switcherWorkspace(chosen, chosen.id === first, photos, pictures),
      onChoose: choose,
      account: signedIn
        ? {
            name: accountName ?? "",
            picture: accountPicture,
            menuPhoto: accountMenuPhoto,
            onPress: () => openSettings(),
          }
        : undefined,
      actions: [newWorkspaceAction(() => router.push("/new-workspace"))],
      onWorkspaceSettings: () => openSettings(SETTINGS_ROUTE.WORKSPACE),
    };
  }, [
    workspaces,
    photos,
    chosen,
    choose,
    signedIn,
    accountName,
    accountPicture,
    openSettings,
    router,
    pictures,
    accountMenuPhoto,
  ]);
}
