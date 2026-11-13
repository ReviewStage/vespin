// screen.tsx -- a screen's SwiftUI host, filling the screen on the brand's ground in the brand's ink, and the space a row's pieces stand apart by.

import { Host, Spacer } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useColors } from "./tokens/colors.js";

/** No ground at all: what a screen or a form stands on where the system's own glass is its ground, as a half-height sheet's is. */
export const NO_GROUND = "transparent";

/**
 * Every screen's root: one SwiftUI host the size of the screen, which every
 * other piece here stands in. It stands on the brand's ground rather than the
 * system's, and tints what it holds in the brand's ink, so a link or a
 * plain button is never the system's blue, and copper is left for what a
 * piece asks for by name: what wants the reader, a picked option, a switch
 * that is on, and a primary act. A clear screen paints no ground, so a
 * half-height sheet's own glass is its one layer, as Apple's half sheets
 * stand on theirs.
 */
export function Screen({
  clear = false,
  children,
}: {
  readonly clear?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const colors = useColors();

  return (
    <Host
      style={{ flex: 1, backgroundColor: clear ? NO_GROUND : colors.GROUND }}
      modifiers={[tint(colors.TEXT)]}
    >
      {children}
    </Host>
  );
}

/** SwiftUI's flexible space, which pushes a row's pieces to its ends. */
export { Spacer };
