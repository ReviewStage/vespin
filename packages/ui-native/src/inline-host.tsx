// inline-host.tsx -- a SwiftUI host standing inside React Native content that scrolls, such as a transcript's row, drawn where its row lays it.

import { Host, type HostProps } from "@expo/ui/swift-ui";

/**
 * SwiftUI drawn inside a React Native row: a transcript's message under its
 * long press menu, a call's glyph, a pull request card, or a glyph in a line
 * of Markdown. Note that it ignores the window's safe area, because a host
 * takes the inset of whatever it scrolls under, the bar at the top, the home
 * indicator, or the keyboard at the foot, and draws its content that far into
 * itself, so a row passing under the bar spilled its words over the row below.
 * A row's room is the list's, which keeps its rows clear of the bars already.
 */
export function InlineHost(props: Omit<HostProps, "ignoreSafeArea">) {
  return <Host {...props} ignoreSafeArea="all" />;
}
