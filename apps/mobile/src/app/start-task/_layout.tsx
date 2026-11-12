// _layout.tsx -- New task's own stack inside its sheet, so the sheet's bar is a navigation bar of the sheet's own, which takes the system's light or dark from the sheet, as Settings' does.

import { BAR_TITLE, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function StartTaskLayout() {
  const colors = useColors();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.TEXT,
        headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.SIDEBAR },
      }}
    />
  );
}
