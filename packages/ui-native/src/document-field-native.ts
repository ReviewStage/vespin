// document-field-native.ts -- the app's native rich field for a document edited whole (`apps/mobile/modules/pill-field`'s `DocumentFieldView`), as JavaScript hands it a document's lines and hears them back.

import { requireNativeView } from "expo";
import type { ComponentType, Ref } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import type { CaretLine } from "./caret-at-word.js";
import type { NativeLook, NativePill, NativeWord } from "./pill-field-native.js";

/** A block the phone does not edit, drawn as a card: the source it keeps, and what its card says. */
export interface NativeCard {
  readonly source: string;
  readonly title: string;
  readonly detail: string;
}

/** A picture's Markdown standing in a line, drawn as the media it names: the source it is written back as, the address it names, and its words. */
export interface NativeMediaRun {
  readonly source: string;
  readonly address: string;
  readonly alt: string;
}

/** What a picture's address holds, as the view draws it: on its way, a picture, a video, a sound clip, a file, one that could not be read, or a Mermaid fence's diagram, whose code stands where it could not be drawn. */
export const MEDIA_KIND = {
  READING: "reading",
  PICTURE: "picture",
  VIDEO: "video",
  AUDIO: "audio",
  FILE: "file",
  UNREAD: "unread",
  DIAGRAM: "diagram",
} as const;

export type MediaKind = (typeof MEDIA_KIND)[keyof typeof MEDIA_KIND];

/** What an address holds once read: its kind, the file of the app's caches it is drawn from, the words its strip or card says, a diagram's code as its detail, and its own size in points where it is known before it is read. */
export interface NativeMedia {
  readonly address: string;
  readonly kind: MediaKind;
  readonly file?: string | undefined;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/** The count of a block's open comment threads: the block of the document as read, how many, and how VoiceOver hears the count. */
export interface NativeCommentMark {
  readonly block: number;
  readonly count: number;
  readonly heard: string;
}

/** A run of a table's cell: words with their looks and the address they link to. */
export interface NativeTableRun {
  readonly text: string;
  readonly marks: readonly string[];
  readonly link?: string | undefined;
}

/** A table the phone does not edit, drawn as the read rows draw it: the source it is written back as, each column's alignment, and its rows, the header first, each cell its runs. */
export interface NativeTable {
  readonly source: string;
  readonly align: readonly string[];
  readonly rows: readonly {
    readonly cells: readonly { readonly runs: readonly NativeTableRun[] }[];
  }[];
}

/** A run of a line as the view takes it: words with their looks and address, a pill, a card, or a picture drawn as its media. */
export type NativeDocumentRun =
  | { readonly text: string; readonly marks: readonly string[]; readonly link?: string | undefined }
  | { readonly pill: NativePill }
  | { readonly card: NativeCard }
  | { readonly media: NativeMediaRun }
  | { readonly table: NativeTable };

/** What a line carries of its block (`document-field-model.ts`'s `FieldLine`). */
interface NativeLineFacts {
  readonly block: number;
  readonly kind: string;
  readonly level?: number | undefined;
  readonly start?: number | undefined;
  readonly language?: string | undefined;
  readonly locked?: string | undefined;
  readonly checked?: boolean | undefined;
  readonly depth?: number | undefined;
  readonly marker?: string | undefined;
  readonly from?: number | undefined;
}

/** A line handed to the view. */
export interface NativeDocumentLine extends NativeLineFacts {
  readonly runs: readonly NativeDocumentRun[];
}

/** A run of a line as the view tells it: words, a pill by its Markdown, or a card or a picture by its source. */
export type NativeToldRun =
  | { readonly text: string; readonly marks: readonly string[]; readonly link?: string | undefined }
  | { readonly pill: { readonly markdown: string } }
  | { readonly card: { readonly source: string } }
  | { readonly media: { readonly source: string } }
  | { readonly table: { readonly source: string } };

/** A line as the view tells it. */
export interface NativeToldLine extends NativeLineFacts {
  readonly runs: readonly NativeToldRun[];
}

/** The lines handed to the view, and how many of its changes JavaScript had heard as it handed them. */
interface NativeDocumentValue {
  readonly lines: readonly NativeDocumentLine[];
  readonly seen: number;
}

/** What a format act does, as the view reads it: a mark by its look, the link, or the block a line is turned into, a heading by its level. */
export const FORMAT_ACT = {
  STRONG: "strong",
  EMPHASIS: "emphasis",
  STRIKE: "strike",
  CODE: "code",
  LINK: "link",
  MENTION: "mention",
  INDENT: "indent",
  OUTDENT: "outdent",
  PARAGRAPH: "paragraph",
  HEADING_1: "heading-1",
  HEADING_2: "heading-2",
  HEADING_3: "heading-3",
  BULLET_LIST: "bullet-list",
  ORDERED_LIST: "ordered-list",
  TASK_LIST: "task-list",
  QUOTE: "quote",
  /** A new comment thread on the selection's block, which the edit menu offers apart from the format acts. */
  COMMENT: "comment",
} as const;

export type FormatAct = (typeof FORMAT_ACT)[keyof typeof FORMAT_ACT];

/** One act the view's edit menu and keyboard bar offer: what it does, its words, and its glyph's name in the asset catalog. */
export interface NativeFormatAct {
  readonly act: FormatAct;
  readonly title: string;
  readonly glyph: string;
}

/** The acts the view offers on its selection: its marks, a link, and the blocks a line is turned into, under the menus' words. */
export interface NativeFormats {
  readonly title: string;
  readonly marks: readonly NativeFormatAct[];
  readonly link?: NativeFormatAct | undefined;
  /** The bar's `@`, which types one, so a mention offer opens on it. */
  readonly mention?: NativeFormatAct | undefined;
  readonly blocksTitle: string;
  readonly blocksGlyph: string;
  readonly blocks: readonly NativeFormatAct[];
  /** The moves of a list's items a step back out and deeper, which Shift-Tab and Tab make too: on the bar while the caret is in a list item, in the place of as many of the last marks, which step into Turn into's menu. */
  readonly indent?: NativeFormatAct | undefined;
  readonly outdent?: NativeFormatAct | undefined;
}

/** The doors the view opens to JavaScript through its ref. */
export interface NativeDocumentFieldDoors {
  focus(): Promise<void>;
  blur(): Promise<void>;
  /** Lays the address on the words a link was asked for, or takes their link off where it is empty. */
  setLink(address: string): Promise<void>;
  /** Puts the pills in place of the `@` word a pick names, found again by its words, or at the caret. */
  insertPills(pills: readonly NativePill[], word: NativeWord | undefined): Promise<void>;
  /** Writes plain words in place of the `@` word a pick names. */
  rewriteWord(text: string, word: NativeWord | undefined): Promise<void>;
}

/** Where a field takes the keyboard as it comes to stand: at its words' start, or on the line at `line`, `x` and `y` points in from its first line's start. */
export interface NativeOpening {
  readonly nonce: number;
  readonly start: boolean;
  readonly line: number;
  readonly x: number;
  readonly y: number;
}

interface NativeDocumentFieldProps {
  readonly ref?: Ref<NativeDocumentFieldDoors> | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly value: NativeDocumentValue;
  readonly look: NativeLook;
  /** What each picture the lines name holds, handed apart from the words, since a picture lands after them. */
  readonly media?: readonly NativeMedia[] | undefined;
  /** The count of each block's open comment threads, by the block of the document as read its lines came from. */
  readonly comments?: readonly NativeCommentMark[] | undefined;
  /** Comment, as the edit menu offers it on the selection's block; none offers none. */
  readonly commentAct?: NativeFormatAct | undefined;
  /** A block's count pressed, by the block of the document as read. */
  readonly onCommentOpen?:
    | ((event: NativeSyntheticEvent<{ readonly block: number }>) => void)
    | undefined;
  /** Comment pressed in the edit menu, on the selection's block, with the words it quotes. */
  readonly onCommentAsk?:
    | ((event: NativeSyntheticEvent<{ readonly block: number; readonly quote: string }>) => void)
    | undefined;
  readonly placeholder?: string | undefined;
  readonly editable?: boolean | undefined;
  readonly formats?: NativeFormats | undefined;
  /** Whether the field stands read-only until a press on its words, which takes the keyboard there, as a description stands on its page; a press on a link, a mention or a picture opens it. */
  readonly tapsToEdit?: boolean | undefined;
  /** A drawn picture pressed while the field stands at rest, by the address its Markdown names and its words. */
  readonly onOpenPicture?:
    | ((event: NativeSyntheticEvent<{ readonly address: string; readonly alt: string }>) => void)
    | undefined;
  /** A link's or a mention's address pressed while the field stands at rest. */
  readonly onOpenLink?:
    | ((event: NativeSyntheticEvent<{ readonly address: string }>) => void)
    | undefined;
  /** Whether the field grows to its words inside the page that holds it, rather than scrolling them itself, telling the height they ask for. */
  readonly fitsWords?: boolean | undefined;
  /** How far over the keyboard the caret's line keeps clear while something stands over the field's foot; none while nothing does. */
  readonly keepClear?: number | undefined;
  /** Where the field takes the keyboard as it comes to stand, laid once for each `nonce` once it stands in a window; none leaves the keyboard alone. */
  readonly opening?: NativeOpening | undefined;
  readonly testID?: string | undefined;
  /** The height the words ask for, while the field grows to them. */
  readonly onHeight?:
    | ((event: NativeSyntheticEvent<{ readonly height: number }>) => void)
    | undefined;
  /** A link asked for on the selected words, with the address they hold, empty where none. */
  readonly onLinkAsk: (event: NativeSyntheticEvent<{ readonly address: string }>) => void;
  /** The caret's line around it, after each edit and each move of the caret. */
  readonly onCaret: (event: NativeSyntheticEvent<CaretLine>) => void;
  readonly onLines: (
    event: NativeSyntheticEvent<{
      readonly lines: readonly NativeToldLine[];
      readonly changes: number;
    }>,
  ) => void;
  readonly onFocusChange: (event: NativeSyntheticEvent<{ readonly focused: boolean }>) => void;
}

/** The module the view stands in, and the view's own name, which its Swift type names. */
const MODULE = "PillField";
const VIEW = "DocumentFieldView";

/** The native field, the app's own local module, autolinked into every build of the app. */
export const NativeDocumentField: ComponentType<NativeDocumentFieldProps> =
  requireNativeView<NativeDocumentFieldProps>(MODULE, VIEW);
