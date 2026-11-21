// pill-field-native.ts -- the app's native pill field (`apps/mobile/modules/pill-field`), UIKit's text view on TextKit 2 whose mentions and files' markers stand as pills, as JavaScript hands it its words and hears them back.

import { requireNativeView } from "expo";
import type { ComponentType, Ref } from "react";
import type { ColorValue, NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

/** A pill as the view draws it: the Markdown it is written back as, its words and glyph, and what VoiceOver hears. */
export interface NativePill {
  readonly markdown: string;
  readonly words: string;
  readonly glyph: string;
  readonly heard: string;
}

/** A run of the words as the view takes it: plain words, with the looks they are drawn in where the field draws them (`@repo/features/markdown-styles`' `MARK_STYLE`), or one pill. */
type NativeRun =
  | { readonly text: string; readonly styles?: readonly string[] }
  | { readonly pill: NativePill };

/** How a field drawing its words' looks draws the marks that only spell one (`**`, a heading's `#`): faded, or hidden but on the line the caret stands on, as a live preview stands them. */
export const MARKS_SHOWN = {
  FADED: "faded",
  CARET: "caret",
} as const;

export type MarksShown = (typeof MARKS_SHOWN)[keyof typeof MARKS_SHOWN];

/** The words handed to the view, and how many of its changes JavaScript had heard as it handed them, so words typed since are never set back. */
export interface NativeValue {
  readonly runs: readonly NativeRun[];
  readonly seen: number;
}

/** The colors the view draws in. */
interface NativeLook {
  readonly text: ColorValue;
  readonly placeholder: ColorValue;
  readonly tint: ColorValue;
  readonly pillFill: ColorValue;
  readonly pillWords: ColorValue;
  readonly pillGlyph: ColorValue;
}

/** What the view tells as its words or its caret move: the Markdown, the caret's line before and after it, each pill as the object character, where the caret stands in the drawn words, whether words are selected, and how many changes have been typed. */
export interface NativeWords {
  readonly markdown: string;
  readonly before: string;
  readonly after: string;
  readonly caret: number;
  readonly selected: boolean;
  readonly changes: number;
}

/** The `@` word a pick replaces, as JavaScript was told it: where it started in the drawn words, and its words. */
export interface NativeWord {
  readonly start: number;
  readonly text: string;
}

/** The doors the view opens to JavaScript through its ref. */
export interface NativePillFieldDoors {
  /** Puts the pills in place of the `@` word a pick names, found again by its words where it moved, or at the caret where none is named or found, each with a space after it. */
  insertPills(pills: readonly NativePill[], word: NativeWord | undefined): Promise<void>;
  /** Writes plain words in place of the `@` word a pick names, found as `insertPills` finds it. */
  rewriteWord(words: string, word: NativeWord | undefined): Promise<void>;
  focus(): Promise<void>;
  blur(): Promise<void>;
}

interface NativePillFieldProps {
  readonly ref?: Ref<NativePillFieldDoors> | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly value: NativeValue;
  readonly look: NativeLook;
  readonly placeholder?: string | undefined;
  readonly maxLines?: number | undefined;
  readonly editable?: boolean | undefined;
  readonly marks?: MarksShown | undefined;
  readonly testID?: string | undefined;
  readonly onWords: (event: NativeSyntheticEvent<NativeWords>) => void;
  readonly onHeight: (event: NativeSyntheticEvent<{ readonly height: number }>) => void;
  readonly onFocusChange: (event: NativeSyntheticEvent<{ readonly focused: boolean }>) => void;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "PillField";

/** The native field, the app's own local module, autolinked into every build of the app. */
export const NativePillField: ComponentType<NativePillFieldProps> =
  requireNativeView<NativePillFieldProps>(MODULE);
