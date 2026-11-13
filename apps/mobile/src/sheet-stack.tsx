// sheet-stack.tsx -- the stack a sheet stands its one screen in, so the bar its screen asks for is the sheet's own navigation bar, in the window's light or dark, and whether a short sheet stands at half height, where its own glass is its ground.

import { useBarScheme } from "@repo/ui-native";
import { type NativeStackNavigationProp, Stack, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** The detent a short sheet opens at, its first: half the screen's height (`SHORT_SHEET_DETENTS`). */
const HALF_DETENT = 0;

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

/**
 * Whether the short sheet this screen stands in is at half height, where iOS
 * floats it as Liquid Glass, so the screen paints no ground of its own and
 * the glass is its one layer; pulled up to full height, it stands on the
 * brand's ground again. Note that a regular window's form sheet has no half
 * height, so it always stands on its ground.
 */
export function useSheetAtHalf(): boolean {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const navigation = useNavigation();
  const [half, setHalf] = useState(true);

  useEffect(() => {
    // The detent's event lands on the sheet's own route in the root stack, the parent of this sheet's stack.
    const sheet = navigation.getParent<NativeStackNavigationProp<Record<string, undefined>>>();

    if (sheet === undefined) return undefined;

    return sheet.addListener("sheetDetentChange", (event) =>
      setHalf(event.data.index === HALF_DETENT),
    );
  }, [navigation]);

  return compact && half;
}
