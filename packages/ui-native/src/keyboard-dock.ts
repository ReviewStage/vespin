// keyboard-dock.ts -- the app's native dock (`apps/mobile/modules/keyboard-dock`), which lifts the bar at a screen's foot with the keyboard frame by frame and tells how far the keyboard stands over it, and its bare scroll edge for a list no dock stands over; none where this build does not carry them.

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

/** The native scroll edge's props: the content whose list's top edge it softens. */
interface ScrollEdgeAreaProps {
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "KeyboardDock";

/** The name the module's second view registers under: its Swift type's. */
const SCROLL_EDGE_VIEW = "ScrollEdgeView";

/** Whether this build carries the native module. */
const CARRIED = requireOptionalNativeModule(MODULE) !== null;

/**
 * The native dock, where this build carries it. Note that its view is asked
 * for only once its module stands, since a build without it would otherwise
 * draw an empty box where the screen should be.
 */
export const KeyboardDockArea: ComponentType<KeyboardDockAreaProps> | undefined = CARRIED
  ? requireNativeView<KeyboardDockAreaProps>(MODULE)
  : undefined;

/**
 * A view that softens the top scroll edge of the list it holds, as iOS 26
 * fades a list under its own bars, where no dock stands over it, such as a
 * page in a split view's detail column; none where this build does not
 * carry it.
 */
export const ScrollEdgeArea: ComponentType<ScrollEdgeAreaProps> | undefined = CARRIED
  ? requireNativeView<ScrollEdgeAreaProps>(MODULE, SCROLL_EDGE_VIEW)
  : undefined;
