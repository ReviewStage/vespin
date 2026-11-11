// workspace-switcher.tsx -- the workspace the phone works in as a tab's root names it: its tile and name as the bar's title, opening the menu of every workspace, New workspace, and Workspace settings.

import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceSharedWords } from "@repo/features/workspace-tile";
import type { Workspace } from "@repo/features/workspace-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  newWorkspaceAction,
  type SwitcherWorkspace,
  WorkspaceSwitcher,
  workspaceSettingsAction,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { useChosenWorkspace } from "./chosen-workspace.js";
import { appStateQuery } from "./host/app-state-query.js";

/** What the switcher is drawn from. */
type SwitcherProps = ComponentProps<typeof WorkspaceSwitcher>;

/** Each workspace's photo as the host holds it, by the workspace. */
function selectPhotos(
  state: AppStateSnapshot,
): AppStateSnapshot[typeof LIVE_READ.WORKSPACE_PHOTOS] {
  return state[LIVE_READ.WORKSPACE_PHOTOS];
}

/**
 * A workspace as its tile and its menu's row draw it, as the panel's are
 * (`workspace-tile.tsx`, `workspace-switcher.tsx`): its photo where the host
 * holds the one at the version the list names, else its owner's picture
 * where it has no photo, else its letter; and who shares it, the account's
 * first workspace said as its own while no one else is in it.
 */
function switcherWorkspace(
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
 * The switcher's workspaces, the chosen one, and its acts: a choice is kept
 * as the phone's (`chosen-workspace.ts`), which the Inbox, its count, Tasks,
 * and New task follow at once; New workspace opens its sheet, and Workspace
 * settings opens Settings, where the workspace is managed. None before the
 * account's workspaces are read.
 */
export function useWorkspaceSwitcher(): SwitcherProps | undefined {
  const router = useRouter();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const { chosen, choose } = useChosenWorkspace(workspaces);
  if (chosen === undefined) return undefined;
  const first = workspaces[0]?.id;
  const drawn = workspaces.map((workspace) =>
    switcherWorkspace(workspace, workspace.id === first, photos),
  );
  return {
    workspaces: drawn,
    chosen: switcherWorkspace(chosen, chosen.id === first, photos),
    onChoose: choose,
    actions: [
      newWorkspaceAction(() => router.push("/new-workspace")),
      workspaceSettingsAction(() => router.push("/settings")),
    ],
  };
}

/**
 * The bar's title where a tab's root names its workspace, as Notion's
 * iPhone app does: the switcher in the stack's header, in place of the
 * tab's own name, which still stands as the screen's title, the back
 * button's and the reader's; nothing changes the bar before the account's
 * workspaces are read.
 */
export function switcherTitle(switcher: SwitcherProps | undefined): {
  readonly headerTitle?: () => React.JSX.Element;
} {
  if (switcher === undefined) return {};
  return { headerTitle: () => <WorkspaceSwitcher {...switcher} /> };
}
