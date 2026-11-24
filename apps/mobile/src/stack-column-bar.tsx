// stack-column-bar.tsx -- a page column's bar on an iPad as its screen's own native-stack header: its path or title, the acts leading it, its main acts and its ⋯, as every pushed page's bar stands.

import {
  BAR_TITLE,
  type BarAction,
  type BarFootItem,
  type ColumnBar,
  glyphSymbol,
  isBarMenu,
  PATH_PART,
  StackBarMenu,
  useColors,
} from "@repo/ui-native";
import { Stack } from "expo-router";
import type { ReactElement } from "react";

/**
 * A bar's act as the header's own button element: its glyph, heard by its
 * words, or its words where it has none. Note that it is built as the
 * toolbar's own child rather than drawn by a component of ours, because
 * expo-router reads a header toolbar's items from its children's types and
 * drops any other element, which left a page's ✉, ⏱ and ✓ out of its bar
 * (vjsplit4).
 */
function stackAct(act: BarAction, tint: string): ReactElement {
  return act.symbol === undefined ? (
    <Stack.Toolbar.Button
      key={act.label}
      tintColor={tint}
      disabled={act.disabled === true}
      onPress={act.onPress}
    >
      {act.label}
    </Stack.Toolbar.Button>
  ) : (
    <Stack.Toolbar.Button
      key={act.label}
      icon={glyphSymbol(act.symbol)}
      tintColor={tint}
      accessibilityLabel={act.label}
      disabled={act.disabled === true}
      onPress={act.onPress}
    />
  );
}

/** One of a page's main acts as the toolbar's own child: a button, or a menu opening from its glyph, such as Remind me's times. */
function stackItem(item: BarFootItem, tint: string): ReactElement {
  return isBarMenu(item) ? (
    <Stack.Toolbar.View key={item.label}>
      <StackBarMenu menu={item} />
    </Stack.Toolbar.View>
  ) : (
    stackAct(item, tint)
  );
}

/**
 * A page column's bar on an iPad, standing in its screen's native-stack
 * header rather than a SwiftUI column's: its path, or its title, inline;
 * the acts leading it, such as New task's compose; and its main acts, its
 * act, and its ⋯ at the trailing edge, ⋯ at the edge, as a pushed page's
 * bar stands them. Note that the page under it then stands bare in its
 * screen's host, as an iPhone's pushed thread does, because the React
 * Native views a SwiftUI page hosts (a message's words, the composer's
 * field) were never drawn in a column wrapped around the page in the system
 * split view's last column (vjsplit3, vjsplitdiag).
 */
export function StackColumnBar({ bar }: { readonly bar: ColumnBar }) {
  const colors = useColors();
  const title = bar.path?.path.join(PATH_PART) ?? bar.title ?? "";
  const trailing = [...(bar.acts ?? [])].reverse();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerLargeTitleEnabled: false,
          title,
          // Note that a path stands small and muted in the bar, as a pushed page's path does, and a title in the ink.
          headerTitleStyle:
            bar.path === undefined
              ? { ...BAR_TITLE.SCREEN, color: colors.TEXT }
              : { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {(bar.lead ?? []).length === 0 ? null : (
        <Stack.Toolbar placement="left">
          {(bar.lead ?? []).map((act) => stackAct(act, colors.TEXT))}
        </Stack.Toolbar>
      )}
      {/* Note that a right bar's first item stands at its edge, so ⋯ is written first and the main acts after it in reverse, standing in their order before it. */}
      <Stack.Toolbar placement="right">
        {bar.menu === undefined ? null : (
          <Stack.Toolbar.View>
            <StackBarMenu menu={bar.menu} />
          </Stack.Toolbar.View>
        )}
        {bar.action === undefined ? null : stackAct(bar.action, colors.TEXT)}
        {trailing.map((item) => stackItem(item, colors.TEXT))}
      </Stack.Toolbar>
    </>
  );
}
