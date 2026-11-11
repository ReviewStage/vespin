// settings-button.tsx -- the signed-in account's photo at the leading edge of each tab's root bar, the button that opens Settings.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { selectAccount } from "@repo/host/app-state-reads";
import { AccountButton, type BarAccount } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { appStateQuery } from "./host/app-state-query.js";

/** What the photo is heard as: where it goes, as the gear it replaced was. */
const SETTINGS = "Settings";

/** The signed-in account as its photo button, opening Settings as a sheet over the tabs; none while nobody is signed in. */
export function useSettingsAccount(): BarAccount | undefined {
  const router = useRouter();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return {
    name: account.name ?? account.email,
    picture: account.pictureUrl,
    label: SETTINGS,
    onPress: () => router.push("/settings"),
  };
}

/**
 * The photo at the leading edge of a tab's root bar, in a stack's own
 * header: a compact window's, and a regular one's where the tab stands no
 * split view. A split view stands it in its sidebar's bar instead
 * (`SplitView`'s `sidebarAccount`).
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
