// skeleton.tsx -- the region a loading skeleton stands in: the screen's own components, with placeholder words, drawn in SwiftUI's own placeholder look while what they stand for is read.

import { Group } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  disabled,
  redacted,
} from "@expo/ui/swift-ui/modifiers";
import { createContext, type ReactNode, useContext } from "react";
import { StyleSheet, Text } from "react-native";
import { useColors } from "./tokens/colors.js";
import { PROSE_SIZE } from "./tokens/type.js";

/** What VoiceOver hears a skeleton as, in the system's word for a read under way. */
const LOADING_WORDS = "Loading";

/** Whether what draws stands inside a skeleton, which React Native's words read, since SwiftUI's placeholder look never reaches them. */
const InSkeletonContext = createContext(false);

/** Whether the words drawn here stand inside a skeleton (`SkeletonRegion`), where they must draw as placeholder bars rather than words. */
export function useInSkeleton(): boolean {
  return useContext(InSkeletonContext);
}

const styles = StyleSheet.create({
  bars: { color: "transparent" },
});

/**
 * React Native's words inside a skeleton, drawn as SwiftUI's placeholder
 * draws its own: a bar of the placeholder gray behind each line's run, the
 * words themselves left unseen, so no word is read. Note that it stands
 * wherever a component draws React Native's text in a SwiftUI row, such as
 * `Markdown` through `RNHostView`, because `redacted` reaches only SwiftUI's
 * views.
 */
export function SkeletonWords({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Text style={{ fontSize: PROSE_SIZE }} accessible={false}>
      <Text style={[styles.bars, { backgroundColor: colors.CHIP_EDGE }]}>{words}</Text>
    </Text>
  );
}

/**
 * Stands `children` in SwiftUI's placeholder look (`redacted(reason:
 * .placeholder)`), as Apple's apps stand a list before it reads: each word
 * a rounded bar of its own length, each glyph a block, with no press taken
 * and VoiceOver hearing the whole region as one element, "Loading". Note
 * that a skeleton draws the components its loaded state draws with, handed
 * placeholder words, inside this, never boxes of its own, so it stands in
 * the loaded screen's shape and moves with it; only a component named
 * `*Skeleton` draws it (`vespin/skeleton-through-components`).
 */
export function SkeletonRegion({ children }: { readonly children: ReactNode }) {
  // Note that SwiftUI's views take the placeholder look from the modifier, while React Native's words inside, which it never reaches, read the context and draw as bars (`SkeletonWords`).
  return (
    <InSkeletonContext value={true}>
      <Group
        modifiers={[
          redacted("placeholder"),
          disabled(),
          accessibilityElement("ignore"),
          accessibilityLabel(LOADING_WORDS),
        ]}
      >
        {children}
      </Group>
    </InSkeletonContext>
  );
}
