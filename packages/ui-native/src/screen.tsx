// screen.tsx -- a screen's SwiftUI host, filling the screen on the brand's ground in the brand's ink, and the space a row's pieces stand apart by.

import { Host, Spacer } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useColors } from "./tokens/colors.js";

/** The ground a screen stands on, by the role that paints it: a list's, or a grouped form's (Settings' pages). */
export const SCREEN_GROUND = { PLAIN: "GROUND", GROUPED: "GROUPED" } as const;

export type ScreenGround = (typeof SCREEN_GROUND)[keyof typeof SCREEN_GROUND];

/**
 * Every screen's root: one SwiftUI host the size of the screen, which every
 * other piece here stands in. It stands on the brand's ground rather than the
 * system's, and tints what it holds in the brand's ink, so a link or a
 * plain button is never the system's blue, and copper is left for what a
 * piece asks for by name: what wants the reader, a picked option, a switch
 * that is on, and a primary act.
 */
export function Screen({
  children,
  ground = SCREEN_GROUND.PLAIN,
}: {
  readonly children: ReactNode;
  /** The ground it stands on: a list's, or a grouped form's, so a form's page reads, fails, and lies empty on the ground its form stands on, never flashing a list's under it first. */
  readonly ground?: ScreenGround;
}) {
  const colors = useColors();

  return (
    <Host style={{ flex: 1, backgroundColor: colors[ground] }} modifiers={[tint(colors.TEXT)]}>
      {children}
    </Host>
  );
}

/** SwiftUI's flexible space, which pushes a row's pieces to its ends. */
export { Spacer };
