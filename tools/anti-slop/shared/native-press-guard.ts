import { repositoryPathOf } from "./repository-path.ts";

/**
 * native-press-guard.ts -- what the `no-raw-press-outside-ui-native` rule
 * reads: the iOS app's design system's guard, as the press guard is the
 * DOM's. Outside `@repo/ui-native`, nothing builds a control from React
 * Native's own pieces or reaches past the package to the SwiftUI and glass it
 * wraps. Root AGENTS.md's "Layout" states the rule in prose; this holds it as
 * data, read by the rule and by the suppression check beside it.
 */
export const NATIVE_PRESS_GUARD_RULE = "anti-slop/no-raw-press-outside-ui-native";

/** The one workspace that may build a control from React Native's pieces. */
const UI_NATIVE_PACKAGE = "packages/ui-native/";

/** React Native's own module. */
export const REACT_NATIVE_MODULE = "react-native";

/** React Native's exports that are controls whatever they are handed. */
export const RAW_NATIVE_CONTROLS: ReadonlySet<string> = new Set([
  "Button",
  "Pressable",
  "Switch",
  "TextInput",
  "TouchableHighlight",
  "TouchableNativeFeedback",
  "TouchableOpacity",
  "TouchableWithoutFeedback",
]);

/** The props that hear a press, so a React Native primitive that takes one is a control. */
export const NATIVE_PRESS_EVENTS: ReadonlySet<string> = new Set([
  "onLongPress",
  "onPress",
  "onPressIn",
  "onPressOut",
]);

/**
 * The libraries `@repo/ui-native` wraps, which no other workspace imports:
 * `@expo/ui`'s SwiftUI at any subpath, and Liquid Glass.
 */
export function isWrappedModule(source: string): boolean {
  return (
    source === "@expo/ui" ||
    source.startsWith("@expo/ui/") ||
    source === "expo-glass-effect" ||
    source.startsWith("expo-glass-effect/")
  );
}

export function isOutsideUiNative(filename: string): boolean {
  return !repositoryPathOf(filename).startsWith(UI_NATIVE_PACKAGE);
}
