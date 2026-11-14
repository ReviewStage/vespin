// sheet-stack.tsx -- the stack a sheet stands its one screen in, so the bar its screen asks for is the sheet's own navigation bar, in the window's light or dark, and whether a short sheet stands at half height, where its own glass is its ground.

import { NO_GROUND, useBarScheme, useReduceTransparency } from "@repo/ui-native";
import { type NativeStackNavigationProp, Stack, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** A short sheet's heights in a compact window, as fractions of the screen: UIKit's medium, then its large; it opens at the first. */
export const SHORT_SHEET_DETENTS = [0.5, 1];

/** Whether the detent a sheet stands at, by its index among `SHORT_SHEET_DETENTS`, is short of full height, where iOS floats a sheet as Liquid Glass. */
function shortOfFull(index: number): boolean {
  return index < SHORT_SHEET_DETENTS.length - 1;
}

/**
 * A sheet's own stack. Note that a sheet whose screen raised its bar from the
 * root stack (`headerShown` on the root's sheet route) drew that bar in the
 * light appearance in dark mode, its title near-black over the dark sheet,
 * while Settings, which has a stack of its own, drew its bar right. Its screen
 * still names the bar's title, tint and buttons itself, and the stack names
 * the window's light or dark, which a native stack otherwise fixes at light.
 */
export function SheetStack() {
  // Note that a screen paints no ground of its own until it says, so a screen that failed before drawing never shows a slab inside a half sheet's glass.
  return (
    <Stack
      screenOptions={{
        headerUserInterfaceStyle: useBarScheme(),
        contentStyle: { backgroundColor: NO_GROUND },
      }}
    />
  );
}

/**
 * Whether the short sheet this screen stands in is at half height, where iOS
 * floats it as Liquid Glass, so the screen paints no ground of its own and
 * the glass is its one layer; pulled up to full height, it stands on the
 * brand's ground again. Note that a regular window's form sheet has no half
 * height, so it always stands on its ground, and that with Reduce
 * Transparency iOS draws the glass as its own opaque gray, so the screen
 * keeps the brand's ground there too. A change of size class sets the sheet's
 * detents anew, which tells no event, so it is taken as opening again, at
 * half height.
 */
export function useSheetAtHalf(): boolean {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const reduceTransparency = useReduceTransparency();
  const navigation = useNavigation();
  const [half, setHalf] = useState(true);

  useEffect(() => {
    if (compact) setHalf(true);
  }, [compact]);

  useEffect(() => {
    // The detent's event lands on the sheet's own route in the root stack, the parent of this sheet's stack.
    const sheet = navigation.getParent<NativeStackNavigationProp<Record<string, undefined>>>();

    if (sheet === undefined) return undefined;

    return sheet.addListener("sheetDetentChange", (event) =>
      setHalf(shortOfFull(event.data.index)),
    );
  }, [navigation]);

  return compact && half && !reduceTransparency;
}
