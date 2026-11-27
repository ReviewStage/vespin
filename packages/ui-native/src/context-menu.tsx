// context-menu.tsx -- React Native views a long press opens UIKit's own context menu on, for what stands laid inline in a line of words, such as a mention's chip, where no SwiftUI menu can wrap it.

import { requireNativeView } from "expo";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { type NativeSyntheticEvent, useColorScheme } from "react-native";
import { longPressTree } from "./list-row.js";
import { filledGroups, type LongPressGroup, menuPressAt } from "./row-menu-model.js";
import { useColors } from "./tokens/colors.js";

/** What a press in the menu sends: the item's place, its group's first, then its place in each menu within. */
interface PressedPlace {
  readonly path: readonly number[];
}

/** The native view's props: the menu's tree as JSON, and the views it holds. */
interface NativeContextMenuProps {
  readonly menu: string;
  readonly onPressPlace: (event: NativeSyntheticEvent<PressedPlace>) => void;
  readonly children: ReactNode;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "NativeInteractions";

/** The native view, the app's own local module, autolinked into every build of the app (`ContextMenuView.swift`). */
const NativeContextMenu: ComponentType<NativeContextMenuProps> =
  requireNativeView<NativeContextMenuProps>(MODULE);

/**
 * React Native views a long press opens the system's menu on, built
 * natively from the groups' tree as `LongPressMenu`'s is (`longPressTree`),
 * only as a long press opens it, each group set apart by a divider, headed
 * by `title` where it has one; a press comes back as the item's place. Note
 * that it is UIKit's own context menu on the views' own native view rather
 * than SwiftUI's, since what stands inline in a line of words, as a
 * mention's chip does, can't stand inside a SwiftUI view; and UIKit gives a
 * long press to the innermost menu under the finger, so a chip held in a
 * message opens its own menu and never the message's too, as a link held in
 * a Messages bubble does. The views alone where it offers nothing.
 */
export function ContextMenu({
  groups,
  title,
  children,
}: {
  readonly groups: readonly LongPressGroup[];
  /** What heads the menu, such as a chip's name; none where it says nothing over its acts. */
  readonly title?: string | undefined;
  readonly children: ReactElement;
}) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";

  if (filledGroups(groups).length === 0) return children;

  return (
    <NativeContextMenu
      menu={longPressTree(groups, title, colors, dark)}
      onPressPlace={(event) => menuPressAt(groups, event.nativeEvent.path)?.()}
    >
      {children}
    </NativeContextMenu>
  );
}
