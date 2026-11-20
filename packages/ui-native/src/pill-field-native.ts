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

/** A run of the words as the view takes it: plain words, or one pill. */
type NativeRun = { readonly text: string } | { readonly pill: NativePill };

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

/** The doors the view opens to JavaScript through its ref. */
export interface NativePillFieldDoors {
  /** Puts the pill in place of the drawn words from `start` to `end`, with a space after it. */
  insertPill(start: number, end: number, pill: NativePill): Promise<void>;
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
}

/** The name the native module registers under, which its Swift names too. */
const MODULE = "PillField";

/** The native field, the app's own local module, autolinked into every build of the app. */
export const NativePillField: ComponentType<NativePillFieldProps> =
  requireNativeView<NativePillFieldProps>(MODULE);
