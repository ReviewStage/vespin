// sheet-stack.tsx -- the stack a sheet stands its one screen in, so the bar its screen asks for is the sheet's own navigation bar, which takes the system's light or dark from the sheet, as Settings' does.

import { useBarScheme } from "@repo/ui-native";
import { Stack } from "expo-router";

/**
 * A sheet's own stack. Note that a sheet whose screen raised its bar from the
 * root stack (`headerShown` on the root's sheet route) drew that bar in the
 * light appearance in dark mode, its title near-black over the dark sheet,
 * while Settings, which has a stack of its own, drew its bar right. Its screen
 * still names the bar's title, tint and buttons itself, and the stack names
 * the window's light or dark, which a native stack otherwise fixes at light.
 */
export function SheetStack() {
  return <Stack screenOptions={{ headerUserInterfaceStyle: useBarScheme() }} />;
}
