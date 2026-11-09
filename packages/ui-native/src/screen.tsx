// screen.tsx -- a screen's SwiftUI host, filling the screen on the brand's ground in the brand's tint, and the space a row's pieces stand apart by.

import { Host, Spacer } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useColors } from "./tokens/colors.js";

/**
 * Every screen's root: one SwiftUI host the size of the screen, which every
 * other piece here stands in. It stands on the brand's ground rather than the
 * system's, and tints what it holds in the brand's copper, so a link, a
 * toggle, or a selection is never the system's blue.
 */
export function Screen({ children }: { readonly children: ReactNode }) {
  const colors = useColors();
  return (
    <Host style={{ flex: 1, backgroundColor: colors.GROUND }} modifiers={[tint(colors.ACCENT)]}>
      {children}
    </Host>
  );
}

/** SwiftUI's flexible space, which pushes a row's pieces to its ends. */
export { Spacer };
