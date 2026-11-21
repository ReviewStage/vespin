// document-field-native.ts -- the app's native rich field for a document edited whole (`apps/mobile/modules/pill-field`'s `DocumentFieldView`), as JavaScript hands it a document's lines and hears them back.

import { requireNativeView } from "expo";
import type { ComponentType, Ref } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import type { NativeLook, NativePill } from "./pill-field-native.js";

/** A block the phone does not edit, drawn as a card: the source it keeps, and what its card says. */
export interface NativeCard {
  readonly source: string;
  readonly title: string;
  readonly detail: string;
}

/** A run of a line as the view takes it: words with their looks and address, a pill, or a card. */
export type NativeDocumentRun =
  | { readonly text: string; readonly marks: readonly string[]; readonly link?: string | undefined }
  | { readonly pill: NativePill }
  | { readonly card: NativeCard };

/** What a line carries of its block (`document-field-model.ts`'s `FieldLine`). */
interface NativeLineFacts {
  readonly block: number;
  readonly kind: string;
  readonly level?: number | undefined;
  readonly start?: number | undefined;
  readonly language?: string | undefined;
  readonly locked?: string | undefined;
  readonly checked?: boolean | undefined;
  readonly from?: number | undefined;
}

/** A line handed to the view. */
export interface NativeDocumentLine extends NativeLineFacts {
  readonly runs: readonly NativeDocumentRun[];
}

/** A run of a line as the view tells it: words, a pill by its Markdown, or a card by its source. */
export type NativeToldRun =
  | { readonly text: string; readonly marks: readonly string[]; readonly link?: string | undefined }
  | { readonly pill: { readonly markdown: string } }
  | { readonly card: { readonly source: string } };

/** A line as the view tells it. */
export interface NativeToldLine extends NativeLineFacts {
  readonly runs: readonly NativeToldRun[];
}

/** The lines handed to the view, and how many of its changes JavaScript had heard as it handed them. */
export interface NativeDocumentValue {
  readonly lines: readonly NativeDocumentLine[];
  readonly seen: number;
}

/** The doors the view opens to JavaScript through its ref. */
export interface NativeDocumentFieldDoors {
  focus(): Promise<void>;
  blur(): Promise<void>;
}

interface NativeDocumentFieldProps {
  readonly ref?: Ref<NativeDocumentFieldDoors> | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly value: NativeDocumentValue;
  readonly look: NativeLook;
  readonly placeholder?: string | undefined;
  readonly editable?: boolean | undefined;
  readonly testID?: string | undefined;
  readonly onLines: (
    event: NativeSyntheticEvent<{ readonly lines: readonly NativeToldLine[]; readonly changes: number }>,
  ) => void;
  readonly onFocusChange: (event: NativeSyntheticEvent<{ readonly focused: boolean }>) => void;
}

/** The module the view stands in, and the view's own name, which its Swift type names. */
const MODULE = "PillField";
const VIEW = "DocumentFieldView";

/** The native field, the app's own local module, autolinked into every build of the app. */
export const NativeDocumentField: ComponentType<NativeDocumentFieldProps> =
  requireNativeView<NativeDocumentFieldProps>(MODULE, VIEW);
