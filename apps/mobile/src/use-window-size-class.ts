// use-window-size-class.ts -- the size class of the window the app is drawn in, live across a fold, a rotation, or a resize.

import { useWindowDimensions } from "react-native";
import { type WindowSizeClass, windowSizeClass } from "./window-size-class.js";

export function useWindowSizeClass(): WindowSizeClass {
  return windowSizeClass(useWindowDimensions().width);
}
