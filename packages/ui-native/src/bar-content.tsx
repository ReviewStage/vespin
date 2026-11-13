// bar-content.tsx -- a SwiftUI toolbar's items, drawn in the order they are written, each placement's items left to right as a screen lists them.

import { Toolbar } from "@expo/ui/swift-ui";
import { Children, type ReactNode } from "react";

/**
 * A toolbar's items, in the order written. Note that `@expo/ui` 58.0.27's
 * `ToolbarContentView` (`ios/ToolbarView.swift`) folds its children into one
 * nested `.toolbar` layer per item, and SwiftUI stands an outer layer's item
 * before an inner one's, so items sharing a placement drew last written
 * first: a split view's foot read Resolve, Remind me, Mark as read. They are
 * handed over reversed so they draw as written; items of different
 * placements stand apart whatever their order. Drop the reversal once
 * `@expo/ui` lays a toolbar's items out in one layer.
 */
export function BarContent({ children }: { readonly children: ReactNode }) {
  const items = [...Children.toArray(children)].reverse();

  return <Toolbar.Content>{items}</Toolbar.Content>;
}
