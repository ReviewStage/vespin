// use-window-size-class.ts -- the size class of the window the app is drawn in, live across a fold, a rotation, or a resize.

import { useWindowDimensions } from "react-native";
import {
  standsThreeColumns,
  WINDOW_SIZE_CLASS,
  type WindowSizeClass,
  windowSizeClass,
} from "./window-size-class.js";

export function useWindowSizeClass(): WindowSizeClass {
  return windowSizeClass(useWindowDimensions().width);
}

/**
 * Whether a sheet stands as a form sheet over a window it leaves showing,
 * dimmed: a window regular both ways, as an iPad's is. Note that a phone on
 * its side is wide enough for a regular window, but too short for a form
 * sheet, which iOS stands across the whole screen there.
 */
export function useSheetsFloat(): boolean {
  const { width, height } = useWindowDimensions();

  return (
    windowSizeClass(width) === WINDOW_SIZE_CLASS.REGULAR &&
    windowSizeClass(height) === WINDOW_SIZE_CLASS.REGULAR
  );
}

/** Whether the window the app is drawn in stands three columns, live as it is. */
export function useThreeColumns(): boolean {
  return standsThreeColumns(useWindowDimensions().width);
}
