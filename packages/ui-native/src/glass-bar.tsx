// glass-bar.tsx -- the Liquid Glass bar a composer stands in at a screen's foot.

import { Host, HStack } from "@expo/ui/swift-ui";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

const BAR_RADIUS = 26;

const styles = StyleSheet.create({
  // The bar's SwiftUI takes the bar's width and its own height.
  content: { flexGrow: 1 },
  bar: {
    marginHorizontal: SPACE.ROW,
    paddingHorizontal: SPACE.ROW + 2,
    paddingVertical: SPACE.ROW - 2,
    borderRadius: BAR_RADIUS,
  },
});

/**
 * A bar of glass holding a composer's field and its buttons, floating over
 * the content it scrolls above, as the system's own bars do. Its children
 * are SwiftUI pieces, laid in a row on a host of its own. Note that
 * where Liquid Glass is unavailable, before iOS 26, the bar is drawn on the surface's ground with its edge rather than a
 * hand-drawn copy of glass.
 */
export function GlassBar({ children }: { readonly children: ReactNode }) {
  const colors = useColors();
  const content = (
    <Host matchContents={{ vertical: true }} style={styles.content}>
      <HStack spacing={SPACE.ROW}>{children}</HStack>
    </Host>
  );
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive style={styles.bar}>
        {content}
      </GlassView>
    );
  }
  return (
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
}
