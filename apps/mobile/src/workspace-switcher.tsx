// workspace-switcher.tsx -- the workspace the phone works in as a tab's root names it: its tile at the bar's leading edge, opening the list of every workspace, the account opening Settings, New workspace, and the chosen workspace's Settings… under its name, in a popover in a regular window and a sheet in a compact one.

import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceSharedWords } from "@repo/features/workspace-tile";
import type { Workspace } from "@repo/features/workspace-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  newWorkspaceAction,
  SWITCHER_PRESENTATION,
  type SwitcherWorkspace,
  type WorkspaceSwitcher,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { useWindowDimensions } from "react-native";
import { useChosenWorkspace } from "./chosen-workspace.js";
import { appStateQuery } from "./host/app-state-query.js";
import { SETTINGS_ROUTE, useOpenSettings, useSettingsAccount } from "./settings-button.js";
import { WINDOW_SIZE_CLASS, windowSizeClass } from "./window-size-class.js";

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
): SwitcherWorkspace {
  const held = photos?.[workspace.id]?.rows;

  const photo =
    workspace.photoVersion !== undefined && held?.version === workspace.photoVersion
      ? held.url
      : undefined;

  return {
    id: workspace.id,
    name: workspace.name,
    line: workspaceSharedWords(workspace.memberCount, first),
    photo,
    picture: workspace.photoVersion === undefined ? workspace.pictureUrl : undefined,
  };
}

/**
 * The switcher's workspaces, the chosen one, the account, and its acts: a
 * choice is kept as the phone's (`chosen-workspace.ts`), which the Inbox, its
 * count, Tasks, and New task follow at once; the account opens Settings on
 * its main list, as Notion's one workspace button does, so the bar holds no
 * photo of its own beside it; New workspace opens its sheet, and the
 * Settings… under the chosen workspace's name opens Settings on its page.
 * The list opens over its button in a window regular in both width and
 * height, an iPad's, and from the screen's foot in any other. None before the account's workspaces are read.
 */
export function useWorkspaceSwitcher(): SwitcherProps | undefined {
  const router = useRouter();
  const openSettings = useOpenSettings();
  const account = useSettingsAccount();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const { chosen, choose } = useChosenWorkspace(workspaces);
  const { width, height } = useWindowDimensions();

  if (chosen === undefined) return undefined;
  const first = workspaces[0]?.id;

  const drawn = workspaces.map((workspace) =>
    switcherWorkspace(workspace, workspace.id === first, photos),
  );

  return {
    workspaces: drawn,
    chosen: switcherWorkspace(chosen, chosen.id === first, photos),
    onChoose: choose,
    account:
      account === undefined
        ? undefined
        : { name: account.name, picture: account.picture, onPress: account.onPress },
    actions: [newWorkspaceAction(() => router.push("/new-workspace"))],
    onWorkspaceSettings: () => openSettings(SETTINGS_ROUTE.WORKSPACE),
    // Note that a phone turned on its side is wide enough for a regular window but too short for the popover's list, so the popover takes a window regular both ways, as an iPad's is.
    presentation:
      windowSizeClass(width) === WINDOW_SIZE_CLASS.REGULAR &&
      windowSizeClass(height) === WINDOW_SIZE_CLASS.REGULAR
        ? SWITCHER_PRESENTATION.POPOVER
        : SWITCHER_PRESENTATION.SHEET,
  };
}
