// press.tsx -- React Native's Pressable with the system's pressed dim, the one press the React Native views that SwiftUI has no piece for (the transcript, markdown, file chips) draw with.

import type { ReactNode } from "react";
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** How far a press dims what it holds while a finger is down, as a plain system button's label does. */
const PRESSED_OPACITY = 0.35;

const PRESSED = { opacity: PRESSED_OPACITY } as const;

/**
 * A press over React Native's views, dimmed while it is held as a system
 * button is, so a finger on a transcript row, a chip or a picture sees it
 * answer before it lifts. Note that the dim is set over the caller's own
 * style, so a press keeps its layout and only its ink fades.
 */
export function Press({
  style,
  ...props
}: Omit<PressableProps, "style"> & {
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}) {
  const pressedStyle = ({ pressed }: PressableStateCallbackType) => [
    style,
    pressed ? PRESSED : undefined,
  ];

  return <Pressable {...props} style={pressedStyle} />;
}
