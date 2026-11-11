// settings-button.tsx -- the one way Settings opens, and the signed-in account's photo at the leading edge of each tab's root bar, the button that opens it, with the workspace switcher beside it where the tab names its workspace.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { selectAccount } from "@repo/host/app-state-reads";
import { AccountButton, type BarAccount, WorkspaceSwitcher } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { appStateQuery } from "./host/app-state-query.js";
import type { SwitcherProps } from "./workspace-switcher.js";

/** What the photo is heard as: where it goes, as the gear it replaced was. */
const SETTINGS = "Settings";

/** Settings' routes: its main list, a sheet over the tabs and a form sheet in a regular window, and the pages a place elsewhere opens it on. */
export const SETTINGS_ROUTE = {
  MAIN: "/settings",
  ACCOUNT: "/settings/account",
  AGENTS: "/settings/agents",
  /** The workspace the app works in, as the workspace switcher's Workspace settings opens it. */
  WORKSPACE: "/settings/workspace",
} as const;

export type SettingsRoute = (typeof SETTINGS_ROUTE)[keyof typeof SETTINGS_ROUTE];

/**
 * The one way to open Settings, from the account's photo, the iPad's menu
 * bar's ⌘, (`modules/menu-commands/`), the workspace switcher, or anywhere
 * else that offers it: on its main list, or on one of its pages.
 */
export function useOpenSettings(): (route?: SettingsRoute) => void {
  const router = useRouter();
  // Note that a page is pushed with its stack's anchor, so Settings opened on Workspace stands its main list under it and Back goes there.
  return (route = SETTINGS_ROUTE.MAIN) => router.push(route, { withAnchor: true });
}

/** The signed-in account as its photo button, opening Settings as a sheet over the tabs; none while nobody is signed in. */
export function useSettingsAccount(): BarAccount | undefined {
  const open = useOpenSettings();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return {
    name: account.name ?? account.email,
    picture: account.pictureUrl,
    label: SETTINGS,
    onPress: () => open(),
  };
}

/**
 * The photo at the leading edge of a tab's root bar, in a stack's own
 * header: a compact window's, and a regular one's where the tab stands no
 * split view, and after it the workspace switcher where the tab names its
 * workspace (the Inbox and Tasks). A split view stands both in the app
 * sidebar's bar instead (`screens/app-sidebar.tsx`). Note that the two stand
 * in one toolbar, because each `Stack.Toolbar` of a placement takes the
 * whole side of the bar.
 */
export function SettingsBarButton({ switcher }: { readonly switcher?: SwitcherProps | undefined }) {
  const account = useSettingsAccount();
  if (account === undefined && switcher === undefined) return null;
  return (
    <Stack.Toolbar placement="left">
      {account === undefined ? null : (
        <Stack.Toolbar.View>
          <AccountButton {...account} />
        </Stack.Toolbar.View>
      )}
      {switcher === undefined ? null : (
        <Stack.Toolbar.View>
          <WorkspaceSwitcher {...switcher} />
        </Stack.Toolbar.View>
      )}
    </Stack.Toolbar>
  );
}
