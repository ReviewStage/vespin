// glass-bar.tsx -- the Liquid Glass bar a composer stands in at a screen's foot.

import { Host, HStack } from "@expo/ui/swift-ui";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/** How round the bar stands: a rounded field, as a composer's is. */
const BAR_RADIUS = 24;

const styles = StyleSheet.create({
  // The bar's own gap above the tab bar.
  dock: { paddingBottom: SPACE.ROW },
  // The bar's SwiftUI takes the bar's width and its own height.
  content: { flexGrow: 1 },
  bar: {
    marginHorizontal: SPACE.ROW + 2,
    paddingLeft: SPACE.ROW + 4,
    paddingRight: SPACE.TIGHT * 2,
    paddingVertical: SPACE.TIGHT * 2,
    borderRadius: BAR_RADIUS,
  },
});

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
  return (
    <SafeAreaView edges={["bottom"]} style={styles.dock}>
      {bar}
    </SafeAreaView>
  );
}
