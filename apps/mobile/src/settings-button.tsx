// settings-button.tsx -- the one way Settings opens, and what leads each tab's root bar: the workspace switcher, whose list opens it, where the tab names its workspace, else the signed-in account's photo, the button that opens it.

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
  INTEGRATIONS: "/settings/integrations",
  MACHINES: "/settings/machines",
  /** A machine's pairing, approved or denied by the `code` its link named. */
  MACHINE_CONNECT: "/settings/machine-connect",
  MEMORY: "/settings/memory",
  /** A memory's words, written anew or edited (`?memory=` its id), as Settings › Memory opens it. */
  MEMORY_EDIT: "/settings/memory-edit",
  /** Send feedback, as Settings' About and the iPad's Help menu open it. */
  FEEDBACK: "/settings/feedback",
  SKILLS: "/settings/skills",
  /** One skill's file, by the `skill` and `name` it is pushed with. */
  SKILL: "/settings/skill",
  /** Add skill's paste. */
  SKILL_ADD: "/settings/skill-add",
  /** The workspace the app works in, as the Settings… under the workspace switcher's workspace opens it. */
  WORKSPACE: "/settings/workspace",
} as const;

export type SettingsRoute = (typeof SETTINGS_ROUTE)[keyof typeof SETTINGS_ROUTE];

/**
 * The one way to open Settings, from the workspace switcher's account, the
 * account's photo, the iPad's menu bar's ⌘, (`modules/menu-commands/`), the
 * sidebar's foot, or anywhere else that offers it: on its main list, or on one of its pages.
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
 * The one item at the leading edge of a tab's root bar, in a stack's own
 * header: a compact window's, and a regular one's where the tab stands no
 * split view: the workspace switcher, whose list holds the account and
 * opens Settings, as Notion's one workspace button does, on every tab, since
 * each acts on the chosen workspace; the account's photo, opening Settings,
 * only before the account's workspaces are read. A split view
 * stands the switcher in its own bar or the app sidebar's list instead
 * (`screens/app-sidebar.tsx`).
 */
export function SettingsBarButton({ switcher }: { readonly switcher?: SwitcherProps | undefined }) {
  const account = useSettingsAccount();

  const lead =
    switcher !== undefined ? (
      <WorkspaceSwitcher {...switcher} />
    ) : account !== undefined ? (
      <AccountButton {...account} />
    ) : undefined;

  if (lead === undefined) return null;

  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.View>{lead}</Stack.Toolbar.View>
    </Stack.Toolbar>
  );
}
