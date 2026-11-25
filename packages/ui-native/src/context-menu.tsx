// context-menu.tsx -- React Native views a long press opens UIKit's own context menu on, for what stands laid inline in a line of words, such as a mention's chip, where no SwiftUI menu can wrap it, lifting a preview of what it opens where it has one.

import { requireNativeView } from "expo";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { type NativeSyntheticEvent, PixelRatio, useColorScheme } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { filledGroups, type LongPressGroup, menuPressAt, menuTree } from "./row-menu-model.js";
import { previewTree, type RowPreview } from "./row-preview-model.js";
import { toneColor, useColors } from "./tokens/colors.js";

/** What a press in the menu sends: the item's place, its group's first, then its place in each menu within. */
interface PressedPlace {
  readonly path: readonly number[];
}

/** The native view's props: the menu's tree as JSON, its preview within it, and the views it holds. */
interface NativeContextMenuProps {
  readonly menu: string;
  readonly onPressPlace: (event: NativeSyntheticEvent<PressedPlace>) => void;
  /** A press on the lifted preview, which opens what it shows, as Safari's preview of a held link opens the page. */
  readonly onPressPreview: () => void;
  readonly children: ReactNode;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "NativeInteractions";

/** The native view, the app's own local module, autolinked into every build of the app (`ContextMenuView.swift`). */
const NativeContextMenu: ComponentType<NativeContextMenuProps> =
  requireNativeView<NativeContextMenuProps>(MODULE);

/**
 * React Native views a long press opens the system's menu on, built
 * natively from the groups' tree as `LongPressMenu`'s is (`menuTree`), only
 * as a long press opens it, each group set apart by a divider, headed by
 * `title` where it has one; a press comes back as the item's place. Where
 * given a `preview`, the menu lifts it over its items, drawn natively from
 * the same tree a row's preview is (`previewTree`), as Safari lifts a held
 * link's page, and a press on the preview opens what it shows
 * (`onOpenPreview`), as Safari's opens the page. Note that it is UIKit's own
 * context menu on the views' own native view rather than SwiftUI's, since
 * what stands inline in a line of words, as a mention's chip does, can't
 * stand inside a SwiftUI view; and UIKit gives a long press to the innermost
 * menu under the finger, so a chip held in a message opens its own menu and
 * never the message's too, as a link held in a Messages bubble does. The
 * views alone where it offers nothing.
 */
export function ContextMenu({
  groups,
  title,
  preview,
  onOpenPreview,
  children,
}: {
  readonly groups: readonly LongPressGroup[];
  /** What heads the menu, such as a chip's name; none where it says nothing over its acts. */
  readonly title?: string | undefined;
  /** What it lifts over its menu, such as a pull request's card; none lifts the views themselves, as UIKit does. */
  readonly preview?: RowPreview | undefined;
  /** What a press on the lifted preview opens; none closes the menu alone. */
  readonly onOpenPreview?: (() => void) | undefined;
  readonly children: ReactElement;
}) {
  const colors = useColors();
  const scale = useScaledSize(1);
  const dark = useColorScheme() === "dark";

  if (filledGroups(groups).length === 0) return children;

  const tone = (each: Parameters<typeof toneColor>[1]) => toneColor(colors, each);

  // Note that the menu and its preview reach the native view as one string, read only as a long press opens it, so the chip builds no view of either as it draws.
  const tree = JSON.stringify({
    title,
    groups: menuTree(groups, { act: colors.TEXT_MUTED, tone }),
    preview:
      preview === undefined
        ? undefined
        : previewTree(preview, {
            colors,
            tone,
            scale,
            dark,
            pixelRatio: PixelRatio.get(),
            now: Date.now(),
          }),
  });

  return (
    <NativeContextMenu
      menu={tree}
      onPressPlace={(event) => menuPressAt(groups, event.nativeEvent.path)?.()}
      onPressPreview={() => onOpenPreview?.()}
    >
      {children}
    </NativeContextMenu>
  );
}
