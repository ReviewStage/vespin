// pill-field-native.ts -- the app's native pill field (`apps/mobile/modules/pill-field`), UIKit's text view on TextKit 2 whose mentions and files' markers stand as pills, as JavaScript hands it its words and hears them back.

import { requireNativeView } from "expo";
import type { ComponentType, Ref } from "react";
import type { ColorValue, NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

/** A pill as the view draws it: the Markdown it is written back as, its words and glyph, what VoiceOver hears, and, for a held picture's, the file its thumbnail is drawn from in the glyph's place. */
export interface NativePill {
  readonly markdown: string;
  readonly words: string;
  readonly glyph: string;
  readonly heard: string;
  readonly thumbnail?: string | undefined;
}

/** A run of the words as the view takes it: plain words, or one pill. */
type NativeRun = { readonly text: string } | { readonly pill: NativePill };

/** The words handed to the view, and how many of its changes JavaScript had heard as it handed them, so words typed since are never set back. */
export interface NativeValue {
  readonly runs: readonly NativeRun[];
  readonly seen: number;
}

/** The colors the view draws in. */
export interface NativeLook {
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
  readonly testID?: string | undefined;
  readonly onWords: (event: NativeSyntheticEvent<NativeWords>) => void;
  readonly onHeight: (event: NativeSyntheticEvent<{ readonly height: number }>) => void;
  readonly onFocusChange: (event: NativeSyntheticEvent<{ readonly focused: boolean }>) => void;
  /** A press on a pill that wears a thumbnail, by the pill's Markdown. */
  readonly onPillPress?:
    | ((event: NativeSyntheticEvent<{ readonly markdown: string }>) => void)
    | undefined;
  /** Whether a list is offered over the field, whose rows a hardware keyboard's ↑ and ↓ move through rather than the caret. */
  readonly listKeys?: boolean | undefined;
  /** Whether an arrow has chosen one of the list's rows, which Return then picks rather than breaking the line. */
  readonly listPicks?: boolean | undefined;
  readonly onListKey?:
    | ((event: NativeSyntheticEvent<{ readonly key: string }>) => void)
    | undefined;
  /** What the `@` word the caret stands in offers, as the tree the field's native list draws (`OfferTree`, as JSON); none while nothing is offered. */
  readonly offer?: string | undefined;
  /** What a bare `@` offers, as the same kind of tree, which the field stands the moment an `@` is typed, before the words' own tree lands. */
  readonly offerBare?: string | undefined;
  /** A press in the native list: a row, by its group's place and its id, or the way back, with the words its tree answered. */
  readonly onOffer?:
    | ((
        event: NativeSyntheticEvent<{
          readonly kind: string;
          readonly query: string;
          readonly group?: number;
          readonly id?: string;
        }>,
      ) => void)
    | undefined;
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "PillField";

/** The native field, the app's own local module, autolinked into every build of the app. */
export const NativePillField: ComponentType<NativePillFieldProps> =
  requireNativeView<NativePillFieldProps>(MODULE);
