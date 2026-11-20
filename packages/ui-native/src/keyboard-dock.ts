// keyboard-dock.ts -- the app's native dock (`apps/mobile/modules/keyboard-dock`), which lifts the bar at a screen's foot with the keyboard frame by frame and tells how far the keyboard stands over it.

import { requireNativeView } from "expo";
import type { ComponentType, ReactNode } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

/** What the native dock tells as the keyboard moves: how far it stands over the dock's foot, and the bottom safe area its lift is less by, in points. */
interface KeyboardOverlap {
  readonly overlap: number;
  readonly inset: number;
}

/** The native dock's props: the screen's content, then its bar, which it lifts. */
interface KeyboardDockAreaProps {
  readonly style?: StyleProp<ViewStyle>;
  readonly onOverlap: (event: NativeSyntheticEvent<KeyboardOverlap>) => void;
  readonly children: ReactNode;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "KeyboardDock";

/** The native dock, the app's own local module, autolinked into every build of the app. */
export const KeyboardDockArea: ComponentType<KeyboardDockAreaProps> =
  requireNativeView<KeyboardDockAreaProps>(MODULE);
