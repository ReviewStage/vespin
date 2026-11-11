// settings-button.tsx -- the one way Settings opens, and the signed-in account's photo at the leading edge of each tab's root bar, the button that opens it.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { selectAccount } from "@repo/host/app-state-reads";
import { AccountButton, type BarAccount } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { appStateQuery } from "./host/app-state-query.js";

/** What the photo is heard as: where it goes, as the gear it replaced was. */
const SETTINGS = "Settings";

/** Settings' routes: its main list, a sheet over the tabs and a form sheet in a regular window, and the pages a place elsewhere opens it on. */
export const SETTINGS_ROUTE = {
  MAIN: "/settings",
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
  return (route = SETTINGS_ROUTE.MAIN) => router.push(route);
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
 * split view. A split view stands it in the app sidebar's bar instead
 * (`screens/app-sidebar.tsx`).
 */
export function SettingsBarButton() {
  const account = useSettingsAccount();
  if (account === undefined) return null;
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.View>
        <AccountButton {...account} />
      </Stack.Toolbar.View>
    </Stack.Toolbar>
  );
}
