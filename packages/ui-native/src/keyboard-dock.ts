// keyboard-dock.ts -- the app's native dock (`apps/mobile/modules/keyboard-dock`), which lifts the bar at a screen's foot with the keyboard frame by frame and tells how far the keyboard stands over it; none where this build does not carry it.

import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType, ReactNode } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

/** What the native dock tells as the keyboard moves: how far it stands over the dock's foot, in points. */
interface KeyboardOverlap {
  readonly overlap: number;
}

/** The native dock's props: the screen's content, then its bar, which it lifts. */
interface KeyboardDockAreaProps {
  readonly style?: StyleProp<ViewStyle>;
  readonly onOverlap: (event: NativeSyntheticEvent<KeyboardOverlap>) => void;
  readonly children: ReactNode;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "KeyboardDock";

/**
 * The native dock, where this build carries it. Note that its view is asked
 * for only once its module stands, since a build without it would otherwise
 * draw an empty box where the screen should be.
 */
export const KeyboardDockArea: ComponentType<KeyboardDockAreaProps> | undefined =
  requireOptionalNativeModule(MODULE) === null
    ? undefined
    : requireNativeView<KeyboardDockAreaProps>(MODULE);
