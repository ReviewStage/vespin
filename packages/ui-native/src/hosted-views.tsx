// hosted-views.tsx -- React Native views hosted back inside SwiftUI, the one way `@repo/ui-native` stands them there, with their presses canceled by a scroll around them.

import { Group, RNHostView, type RNHostViewProps } from "@expo/ui/swift-ui";

import { scrollCancelsPresses } from "./interactions.js";

const CANCELED_BY_SCROLL = [scrollCancelsPresses()];

/**
 * React Native views standing inside SwiftUI, such as a description's words
 * in a task page's list, a message under its long press menu, or a page of
 * Markdown in SwiftUI's scroller. Note that their presses are canceled as a
 * scroll view they stand in starts to scroll (`scrollCancelsPresses`), as
 * UIKit cancels a control's, because React Native's touch handler never
 * cancels them for a SwiftUI list inside its own surface, so a swipe begun
 * on a press fired it as the finger lifted. Every press inside keeps its own
 * handling, its place, its hold and its dim, and only loses to the scroll.
 */
export function HostedViews(props: RNHostViewProps) {
  return (
    <Group modifiers={CANCELED_BY_SCROLL}>
      <RNHostView {...props} />
    </Group>
  );
}
