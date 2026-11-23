// diff-view-native.ts -- the app's native view of a changed file's diff (`apps/mobile/modules/diff-view`'s `DiffView`), as JavaScript hands it the diff's columns and how to draw them.

import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { ColorValue, NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import type { DiffColumns } from "./diff-view-model.js";

/** How the view draws a diff: its type size, whether its words wrap, and the theme's inks. */
export interface NativeDiffLook {
  readonly fontSize: number;
  readonly wrap: boolean;
  readonly text: ColorValue;
  readonly muted: ColorValue;
  readonly ground: ColorValue;
  readonly added: ColorValue;
  readonly removed: ColorValue;
  readonly hunk: ColorValue;
  /** The color of each style the highlighter names, in `SYNTAX_COLORS`' order. */
  readonly syntax: readonly ColorValue[];
  /** A review thread's card and its edge. */
  readonly card: ColorValue;
  readonly cardEdge: ColorValue;
}

interface NativeDiffViewProps {
  readonly rows: DiffColumns;
  /** The file's path, whose extension names the language its code is colored in; none colors nothing. */
  readonly path: string;
  readonly look: NativeDiffLook;
  /** A press on a review thread's card, by the card's row. */
  readonly onThreadPress?:
    | ((event: NativeSyntheticEvent<{ readonly row: number }>) => void)
    | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string | undefined;
}

/** The module the view stands in, which its Swift type names. */
const MODULE = "DiffView";

/** The native view, the app's own local module, autolinked into every build of the app. */
export const NativeDiffView: ComponentType<NativeDiffViewProps> =
  requireNativeView<NativeDiffViewProps>(MODULE);
