// screen.tsx -- a screen's SwiftUI host, filling the screen so SwiftUI lays out in the whole window, and the space a row's pieces stand apart by.

import { Host, Spacer } from "@expo/ui/swift-ui";
import type { ReactNode } from "react";

const FILL = { flex: 1 } as const;

/** Every screen's root: one SwiftUI host the size of the screen, which every other piece here stands in. */
export function Screen({ children }: { readonly children: ReactNode }) {
  return <Host style={FILL}>{children}</Host>;
}

/** SwiftUI's flexible space, which pushes a row's pieces to its ends. */
export { Spacer };
