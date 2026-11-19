// skeleton.tsx -- the region a loading skeleton stands in: the screen's own components, with placeholder words, drawn in SwiftUI's own placeholder look while what they stand for is read.

import { Group } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  disabled,
  redacted,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";

/** What VoiceOver hears a skeleton as, in the system's word for a read under way. */
const LOADING_WORDS = "Loading";

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
  return (
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
  );
}
