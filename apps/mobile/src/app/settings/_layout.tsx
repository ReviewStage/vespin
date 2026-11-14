// _layout.tsx -- Settings' own stack inside its sheet: the main list, and the pages it pushes, under the system's inline headers in the brand's tint on the sidebar's ground.

import { FEEDBACK_WORDS } from "@repo/features/feedback";
import { HOST_CONNECT_WORDS } from "@repo/features/host-connect-words";
import { MCP_CLIENTS_WORDS } from "@repo/features/mcp-clients-words";
import { PUSH_NOTIFICATIONS_TITLE } from "@repo/features/push-device-model";
import { SETTINGS_PAGE_TITLE, SETTINGS_VIEW } from "@repo/settings/settings-views";
import { BAR_TITLE, useBarScheme, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** Settings opened on one of its pages, such as Workspace from the switcher, stands its main list under it, so Back goes there. */
export const unstable_settings = { anchor: "index" };

/**
 * Settings' stack, as iOS's own Settings stands: a grouped list whose rows
 * push its pages, each titled small and inline, the back button the
 * system's round glass chevron alone, and every page on the sidebar's
 * ground, as the panel's settings stand on theirs.
 */
export default function SettingsLayout() {
  const colors = useColors();
  const scheme = useBarScheme();

  return (
    <Stack
      screenOptions={{
        headerUserInterfaceStyle: scheme,
        headerTintColor: colors.TEXT,
        headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.GROUPED },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen
        name="account"
        options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.ACCOUNT] }}
      />
      <Stack.Screen
        name="workspace"
        options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.WORKSPACE] }}
      />
      <Stack.Screen name="notifications" options={{ title: PUSH_NOTIFICATIONS_TITLE }} />
      <Stack.Screen name="agents" options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.AGENTS] }} />
      <Stack.Screen
        name="integrations"
        options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.INTEGRATIONS] }}
      />
      <Stack.Screen name="machines" options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.HOSTS] }} />
      <Stack.Screen name="machine-connect" options={{ title: HOST_CONNECT_WORDS.TITLE }} />
      <Stack.Screen name="skills" options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.SKILLS] }} />
      <Stack.Screen name="skill" />
      <Stack.Screen name="skill-add" />
      <Stack.Screen name="mcp" options={{ title: MCP_CLIENTS_WORDS.TITLE }} />
      <Stack.Screen name="memory" options={{ title: SETTINGS_PAGE_TITLE[SETTINGS_VIEW.MEMORY] }} />
      <Stack.Screen name="memory-edit" />
      <Stack.Screen name="feedback" options={{ title: FEEDBACK_WORDS.TITLE }} />
    </Stack>
  );
}
