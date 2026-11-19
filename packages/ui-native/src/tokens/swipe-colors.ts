// swipe-colors.ts -- iOS's own system colors a row's swipe acts stand on, in each theme and under Increase Contrast.

import { useColorScheme } from "react-native";
import { useIncreaseContrast } from "../accessibility.js";

/** The system colors a swipe is filled with, by Apple's names, less their `system` prefix. */
export const SYSTEM_COLOR = {
  GRAY: "gray",
  RED: "red",
  BLUE: "blue",
  PURPLE: "purple",
  GREEN: "green",
  ORANGE: "orange",
} as const;

export type SystemColor = (typeof SYSTEM_COLOR)[keyof typeof SYSTEM_COLOR];

/**
 * Each system color's values from Apple's Human Interface Guidelines color
 * table: light and dark, and their accessible forms, which the system draws
 * in their place under Increase Contrast. Note that they are written out
 * rather than read from UIKit, because a SwiftUI modifier from React takes
 * a color's value, and these are the values UIKit's would resolve to.
 */
const SYSTEM_COLOR_VALUE = {
  LIGHT: {
    [SYSTEM_COLOR.GRAY]: "#8E8E93",
    [SYSTEM_COLOR.RED]: "#FF3B30",
    [SYSTEM_COLOR.BLUE]: "#007AFF",
    [SYSTEM_COLOR.PURPLE]: "#AF52DE",
    [SYSTEM_COLOR.GREEN]: "#34C759",
    [SYSTEM_COLOR.ORANGE]: "#FF9500",
  },
  DARK: {
    [SYSTEM_COLOR.GRAY]: "#8E8E93",
    [SYSTEM_COLOR.RED]: "#FF453A",
    [SYSTEM_COLOR.BLUE]: "#0A84FF",
    [SYSTEM_COLOR.PURPLE]: "#BF5AF2",
    [SYSTEM_COLOR.GREEN]: "#30D158",
    [SYSTEM_COLOR.ORANGE]: "#FF9F0A",
  },
  LIGHT_CONTRAST: {
    [SYSTEM_COLOR.GRAY]: "#6C6C70",
    [SYSTEM_COLOR.RED]: "#D70015",
    [SYSTEM_COLOR.BLUE]: "#0040DD",
    [SYSTEM_COLOR.PURPLE]: "#8944AB",
    [SYSTEM_COLOR.GREEN]: "#248A3D",
    [SYSTEM_COLOR.ORANGE]: "#C93400",
  },
  DARK_CONTRAST: {
    [SYSTEM_COLOR.GRAY]: "#AEAEB2",
    [SYSTEM_COLOR.RED]: "#FF6961",
    [SYSTEM_COLOR.BLUE]: "#409CFF",
    [SYSTEM_COLOR.PURPLE]: "#DA8FFF",
    [SYSTEM_COLOR.GREEN]: "#30DB5B",
    [SYSTEM_COLOR.ORANGE]: "#FFB340",
  },
} as const satisfies Record<string, Record<SystemColor, string>>;

/** Each system color's value in the window's theme, in its accessible form under Increase Contrast. */
export function useSystemColors(): Readonly<Record<SystemColor, string>> {
  const dark = useColorScheme() === "dark";

  if (useIncreaseContrast()) {
    return dark ? SYSTEM_COLOR_VALUE.DARK_CONTRAST : SYSTEM_COLOR_VALUE.LIGHT_CONTRAST;
  }

  return dark ? SYSTEM_COLOR_VALUE.DARK : SYSTEM_COLOR_VALUE.LIGHT;
}
