// split-view.tsx -- a regular window's list and detail side by side, as SwiftUI's own NavigationSplitView.

import { NavigationSplitView } from "@expo/ui/swift-ui";
import type { ReactNode } from "react";

type SplitViewProps = {
  /** The list, drawn as the sidebar column: a `RowList` in its sidebar look. */
  readonly sidebar: ReactNode;
  /** The selected row's page, or an `EmptyState` before one is picked. */
  readonly detail: ReactNode;
};

/**
 * The list beside its detail, for a regular-width window such as an iPad's
 * or the unfolded iPhone Duo's. The split view draws each column's
 * navigation bar itself, so the screen around it shows no header of its own.
 */
export function SplitView({ sidebar, detail }: SplitViewProps) {
  return (
    <NavigationSplitView>
      <NavigationSplitView.Sidebar>{sidebar}</NavigationSplitView.Sidebar>
      <NavigationSplitView.Detail>{detail}</NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}
