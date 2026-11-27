// _layout.tsx -- setup's own stack, standing alone in the app after sign-in while the account owes it: a step per screen, under the system's inline headers on the grouped ground, as Settings' pages stand.

import { BAR_TITLE, useBarScheme, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";
import { SetupPlaceProvider } from "../../../setup/setup-place.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/**
 * Setup's stack: Continue pushes the next step and the stack's Back, the
 * system's round glass chevron alone, or its swipe, goes back a step. Its
 * steps share the place last written (`SetupPlaceProvider`), so two moves
 * close together each keep the other's.
 */
export default function SetupLayout() {
  const colors = useColors();
  const scheme = useBarScheme();

  return (
    <SetupPlaceProvider>
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
        <Stack.Screen name="index" options={{ title: "" }} />
        <Stack.Screen name="[step]" />
      </Stack>
    </SetupPlaceProvider>
  );
}
