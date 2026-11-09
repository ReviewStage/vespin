// split-view.tsx -- a regular window's list and detail side by side, as SwiftUI's own NavigationSplitView.

import {
  NavigationSplitView,
  type NavigationSplitViewVisibility,
  Button as SwiftUIButton,
  Toolbar,
  ToolbarItem,
} from "@expo/ui/swift-ui";
import { navigationSplitViewStyle } from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useState } from "react";
import type { SfSymbol } from "./sf-symbol.js";

type SplitViewProps = {
  /** The list, drawn as the sidebar column: a `RowList` in its sidebar look. */
  readonly sidebar: ReactNode;
  /** The selected row's page, or an `EmptyState` before one is picked. */
  readonly detail: ReactNode;
  /** An act in the sidebar's bar, by its symbol alone, such as Settings: what a compact window's header holds. */
  readonly sidebarAction?:
    | { readonly label: string; readonly symbol: SfSymbol; readonly onPress: () => void }
    | undefined;
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
export function SplitView({ sidebar, detail, sidebarAction }: SplitViewProps) {
  const [columns, setColumns] = useState<NavigationSplitViewVisibility>("all");
  return (
    <NavigationSplitView
      columnVisibility={columns}
      onColumnVisibilityChange={setColumns}
      modifiers={[navigationSplitViewStyle("balanced")]}
    >
      <NavigationSplitView.Sidebar>
        {sidebarAction === undefined ? (
          sidebar
        ) : (
          <Toolbar>
            {sidebar}
            <Toolbar.Content>
              <ToolbarItem placement="topBarTrailing">
                <SwiftUIButton
                  label={sidebarAction.label}
                  systemImage={sidebarAction.symbol}
                  onPress={sidebarAction.onPress}
                />
              </ToolbarItem>
            </Toolbar.Content>
          </Toolbar>
        )}
      </NavigationSplitView.Sidebar>
      <NavigationSplitView.Detail>{detail}</NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}
