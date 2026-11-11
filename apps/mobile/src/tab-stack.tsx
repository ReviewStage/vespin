// tab-stack.tsx -- a tab's native stack: inline titles in the ink and round glass back buttons, its items in the brand's copper, its bar clear over the brand's ground.

import { BAR_TITLE, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";

/**
 * Every tab's stack: the system's own headers with no ground of their own
 * and no rule under them, never a large title, each screen's name small and
 * inline in the bar, and the back button the system's round glass chevron
 * alone, its items in the brand's tint. Note that the bar is left without a
 * ground, the screen's showing through it, because a bar painted opaque has
 * the system draw its buttons as flat discs rather than glass in the dark.
 * Note that a title is set in the ink rather than the tint, which colors it
 * too, because a page's name is words, not something to press.
 */
export function TabStack() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ACCENT,
        headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.GROUND },
      }}
    />
  );
}
