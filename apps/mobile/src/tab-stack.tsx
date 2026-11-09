// tab-stack.tsx -- a tab's native stack, its headers tinted in the brand's copper over the brand's ground.

import { useColors } from "@repo/ui-native";
import { Stack } from "expo-router";

/**
 * Every tab's stack: the system's own headers, their back button and items in
 * the brand's tint. Note that a title is set in the ink rather than the tint,
 * which colors it too, because a page's name is words, not something to press.
 */
export function TabStack() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ACCENT,
        headerTitleStyle: { color: colors.TEXT },
        headerLargeTitleStyle: { color: colors.TEXT },
        contentStyle: { backgroundColor: colors.GROUND },
      }}
    />
  );
}
