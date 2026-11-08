// split-view.tsx -- a regular window's list and detail side by side, as SwiftUI's own NavigationSplitView.

import { NavigationSplitView, type NavigationSplitViewVisibility } from "@expo/ui/swift-ui";
import { navigationSplitViewStyle } from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useState } from "react";

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
 * Note that the columns start out all shown and balanced, because SwiftUI's
 * automatic style hides the sidebar of a portrait iPad until it is asked
 * for, and the list is what the window is wide enough to keep beside the
 * detail; a person may still hide it, which the split view reports back.
 */
export function SplitView({ sidebar, detail }: SplitViewProps) {
  const [columns, setColumns] = useState<NavigationSplitViewVisibility>("all");
  return (
    <NavigationSplitView
      columnVisibility={columns}
      onColumnVisibilityChange={setColumns}
      modifiers={[navigationSplitViewStyle("balanced")]}
    >
      <NavigationSplitView.Sidebar>{sidebar}</NavigationSplitView.Sidebar>
      <NavigationSplitView.Detail>{detail}</NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}
