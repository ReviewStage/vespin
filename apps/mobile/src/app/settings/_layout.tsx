// _layout.tsx -- Settings' own stack inside its sheet: the main list, and the pages it pushes, under the system's inline headers in the brand's tint on the sidebar's ground.

import { BAR_TITLE, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/**
 * Settings' stack, as iOS's own Settings stands: a grouped list whose rows
 * push its pages, each titled small and inline, the back button the
 * system's round glass chevron alone, and every page on the sidebar's
 * ground, as the panel's settings stand on theirs.
 */
export default function SettingsLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ACCENT,
        headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.SIDEBAR },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="account" options={{ title: "Account" }} />
    </Stack>
  );
}
