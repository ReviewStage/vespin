// glass-bar.tsx -- the Liquid Glass bar a composer stands in at a screen's foot, and the dock that pins it there above the keyboard.

import { Host, HStack } from "@expo/ui/swift-ui";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { type ReactNode, useEffect, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/** The room a docked screen's content leaves at its foot so its last words scroll clear of the bar, in points. */
export const DOCK_ROOM = 72;

/** How round the bar stands: a rounded field, as a composer's is. */
export const BAR_RADIUS = 24;

const styles = StyleSheet.create({
  // The bar's own gap above the tab bar, or the keyboard.
  gap: { paddingBottom: SPACE.ROW },
  // The bar's SwiftUI takes the bar's width and its own height.
  content: { flexGrow: 1 },
  // A dock's content takes the screen, the bar floating over its foot.
  dock: { flex: 1 },
  docked: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    marginHorizontal: SPACE.ROW + 2,
    paddingLeft: SPACE.ROW + 4,
    paddingRight: SPACE.TIGHT * 2,
    paddingVertical: SPACE.TIGHT * 2,
    borderRadius: BAR_RADIUS,
  },
});

/** How tall the system's keyboard stands, in points, as it begins to rise and to fall; none while it is down. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const rising = Keyboard.addListener("keyboardWillShow", ({ endCoordinates }) =>
      setHeight(endCoordinates.height),
    );
    const falling = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      rising.remove();
      falling.remove();
    };
  }, []);
  return height;
}

/**
 * A bar of glass holding a composer's field and its buttons, floating over
 * the content it scrolls above, as the system's own bars do. Its children
 * are SwiftUI pieces, laid in a row on a host of its own. It stands inside
 * the screen's bottom safe area, which the tab bar's height is part of, so
 * the bar sits above the tab bar rather than under it. Note that where
 * Liquid Glass is unavailable, before iOS 26, the bar is drawn on the
 * surface's ground with its edge rather than a hand-drawn copy of glass.
 */
export function GlassBar({ children }: { readonly children: ReactNode }) {
  const colors = useColors();
  const keyboard = useKeyboardHeight() > 0;
  const content = (
    <Host matchContents={{ vertical: true }} style={styles.content}>
      <HStack spacing={SPACE.ROW}>{children}</HStack>
    </Host>
  );
  const bar = isLiquidGlassAvailable() ? (
    <GlassView glassEffectStyle="regular" isInteractive style={styles.bar}>
      {content}
    </GlassView>
  ) : (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.SURFACE,
          borderColor: colors.CHIP_EDGE,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      {content}
    </View>
  );
  // Note that the bottom safe area is let go while the keyboard stands, since the keyboard covers the tab bar it holds room for; the sides are kept, so the bar stops short of a tab rail beside it, as the folded iPhone Duo stands one.
  return (
    <SafeAreaView
      edges={keyboard ? ["left", "right"] : ["bottom", "left", "right"]}
      style={styles.gap}
    >
      {bar}
    </SafeAreaView>
  );
}

/**
 * A screen with a bar pinned at its foot, such as a thread's composer: the
 * screen's content fills it, the bar floating over its foot as the system's
 * bars do, and rising with the keyboard so the field stays above it. The
 * content leaves room at its own foot for the bar (`DOCK_ROOM`).
 */
export function GlassDock({
  children,
  bar,
}: {
  readonly children: ReactNode;
  readonly bar: ReactNode;
}) {
  // Note that the bar is lifted by the keyboard's own height, read from the system, rather than by a view that pads for it, since the field that raised it stands in SwiftUI.
  const keyboard = useKeyboardHeight();
  return (
    <View style={styles.dock}>
      {children}
      <View style={[styles.docked, { bottom: keyboard }]}>{bar}</View>
    </View>
  );
}
