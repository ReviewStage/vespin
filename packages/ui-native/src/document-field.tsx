// document-field.tsx -- a document's rich field, as Notion edits a page: each block drawn with no syntax in the app's native document field, and the document written back with only the blocks that changed printed again.

import { readerZone } from "@repo/features/date-mention";
import { descriptionHead } from "@repo/features/description-blocks";
import {
  BLOCK_KIND,
  type DocumentBlock,
  documentBlocks,
  INLINE_MARK,
  INLINE_RUN,
  type InlineMark,
  type InlineRun,
  LIST_MARKER,
  type ListMarker,
  LOCKED_KIND,
  type LockedKind,
  writtenDocument,
} from "@repo/features/document-blocks";
import { drawnPictureAddresses } from "@repo/features/drawn-pictures";
import { markdownTree, markdownTreeKept } from "@repo/features/markdown-tree";
import { PILL_RUN, type Pill, pillRuns } from "@repo/features/pill-words";
import {
  WRITING_BLOCK,
  WRITING_MARK,
  WRITING_SHORTCUTS,
  type WritingAction,
} from "@repo/settings/shortcuts";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  type NativeSyntheticEvent,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import {
  type CaretAtWord,
  type CaretLine,
  caretAtWord,
  drawnPill,
  sameAtWord,
  toldWord,
} from "./caret-at-word.js";
import { useChipMarkOf } from "./chip-mark.js";
import type { ChipMarkOf } from "./chip-mark-model.js";
import { type DiagramDrawing, DiagramRenderer, useDiagramPictures } from "./diagram.js";
import { editedBlocks, editedLines, type FieldLine, fieldLines } from "./document-field-model.js";
import {
  FORMAT_ACT,
  type FormatAct,
  MEDIA_KIND,
  type NativeCard,
  type NativeCommentMark,
  NativeDocumentField,
  type NativeDocumentFieldDoors,
  type NativeDocumentLine,
  type NativeDocumentRun,
  type NativeFormatAct,
  type NativeFormats,
  type NativeMedia,
  type NativeOpening,
  type NativeTable,
  type NativeToldLine,
  type NativeToldRun,
} from "./document-field-native.js";
import { fieldTable } from "./document-field-table.js";
import { GLYPH, WRITING_GLYPH } from "./glyph.js";
import { Markdown, type MarkdownFile, type MarkdownVideo } from "./markdown.js";
import type { MarkdownReading } from "./markdown-model.js";
import { pillLook } from "./pill-look.js";
import { askForWords, WORDS_KIND, type WordsAct } from "./system-asks.js";
import { useColors } from "./tokens/colors.js";

/** What a card says a locked block is, as the description page names it. */
const CARD_TITLE: Readonly<Record<LockedKind, string>> = {
  [LOCKED_KIND.TABLE]: "Table",
  [LOCKED_KIND.DIAGRAM]: "Diagram",
  [LOCKED_KIND.HTML]: "HTML",
  [LOCKED_KIND.OTHER]: "Block",
};

/** What a card adds under its title where its source opens on no words worth showing. */
const CARD_DETAIL = "Edit on the desktop";

/** The most of a card's first line it shows. */
const CARD_DETAIL_MOST = 80;

/** The words of the field's format menus and its link's alert, the desktop's where it has them (`@repo/ui`'s link field). */
const FORMAT_WORDS = {
  MENU: "Format",
  MENTION: "Mention",
  TURN_INTO: "Turn into",
  INDENT: "Indent",
  OUTDENT: "Outdent",
  LINK_MESSAGE: "Paste or type a link",
  REMOVE_LINK: "Remove link",
  DONE: "Done",
} as const;

/** A writing action as the field offers it: what it does, in the panel's words and glyph. */
function formatAct(action: WritingAction, act: FormatAct): NativeFormatAct {
  return { act, title: WRITING_SHORTCUTS[action].label, glyph: WRITING_GLYPH[action] };
}

/**
 * What the field offers on its selection, in its edit menu and the bar over
 * the keyboard: the desktop toolbar's marks and link, then the blocks its
 * Turn into offers that a line of words can be, each in the panel's words
 * and glyph (`@repo/settings`' `WRITING_SHORTCUTS`). While the caret is in
 * a list item, the bar stands Outdent and Indent, which move its items as
 * Shift-Tab and Tab do, in the last marks' place, and those marks lead its
 * Turn into. A code block and a divider are made on the desktop.
 */
const FORMATS: NativeFormats = {
  title: FORMAT_WORDS.MENU,
  marks: [
    formatAct(WRITING_MARK.BOLD, FORMAT_ACT.STRONG),
    formatAct(WRITING_MARK.ITALIC, FORMAT_ACT.EMPHASIS),
    formatAct(WRITING_MARK.STRIKE, FORMAT_ACT.STRIKE),
    formatAct(WRITING_MARK.CODE, FORMAT_ACT.CODE),
  ],
  link: formatAct(WRITING_MARK.LINK, FORMAT_ACT.LINK),
  mention: { act: FORMAT_ACT.MENTION, title: FORMAT_WORDS.MENTION, glyph: GLYPH.PERSON },
  blocksTitle: FORMAT_WORDS.TURN_INTO,
  blocksGlyph: WRITING_GLYPH[WRITING_BLOCK.TEXT],
  blocks: [
    formatAct(WRITING_BLOCK.TEXT, FORMAT_ACT.PARAGRAPH),
    formatAct(WRITING_BLOCK.HEADING_1, FORMAT_ACT.HEADING_1),
    formatAct(WRITING_BLOCK.HEADING_2, FORMAT_ACT.HEADING_2),
    formatAct(WRITING_BLOCK.HEADING_3, FORMAT_ACT.HEADING_3),
    formatAct(WRITING_BLOCK.BULLETED_LIST, FORMAT_ACT.BULLET_LIST),
    formatAct(WRITING_BLOCK.NUMBERED_LIST, FORMAT_ACT.ORDERED_LIST),
    formatAct(WRITING_BLOCK.TODO_LIST, FORMAT_ACT.TASK_LIST),
    formatAct(WRITING_BLOCK.QUOTE, FORMAT_ACT.QUOTE),
  ],
  indent: { act: FORMAT_ACT.INDENT, title: FORMAT_WORDS.INDENT, glyph: GLYPH.INDENT },
  outdent: { act: FORMAT_ACT.OUTDENT, title: FORMAT_WORDS.OUTDENT, glyph: GLYPH.OUTDENT },
};

/** What a picture or a line break kept as its source draws as in the words. */
const RAW_WORDS = { PICTURE: "Picture", BREAK: "Line break" } as const;

/** What a file a picture's address names is called where its words name it nothing, as the read rows' chip calls it. */
const UNNAMED_FILE = "Attachment";

/** What a Mermaid fence's diagram is called at its head, as the read rows' card heads it. */
const DIAGRAM_HEAD = "Diagram";

/** The locked blocks a field that draws media draws as they read, by their source: each Mermaid fence's code, and each table's rows. */
interface DrawnBlocks {
  readonly diagrams: ReadonlyMap<string, string>;
  readonly tables: ReadonlyMap<string, NativeTable>;
}

/** No diagram asked for. */
const NO_CODES: readonly string[] = [];

/** Comment, as the field's edit menu offers it on a block, in the panel's words and glyph. */
const COMMENT_ACT: NativeFormatAct = {
  act: FORMAT_ACT.COMMENT,
  title: "Comment",
  glyph: GLYPH.COMMENT,
};

/** Where a comment thread is started: the block's words in the Markdown, and the words it quotes. */
export interface CommentPlace {
  readonly from: number;
  readonly to: number;
  readonly quote: string;
}

/** A document's open comment threads, as the field stands their counts beside its blocks, as the read rows do, and starts one from its edit menu. */
export interface DocumentComments {
  /** Each open thread on the words, oldest first: where its quoted words start in the Markdown, and what opens it. */
  readonly threads: readonly { readonly at: number; readonly onOpen: () => void }[];
  /** How a block's count of threads is heard. */
  readonly heard: (count: number) => string;
  /** Starts a thread on a block's words. */
  readonly onComment: (place: CommentPlace) => void;
}

/** Where each block of the document as read stands in the Markdown it was read from, its sources joined being the Markdown exactly (`documentBlocks`). */
function blockSpans(
  blocks: readonly DocumentBlock[],
): readonly { readonly from: number; readonly to: number }[] {
  let at = 0;

  return blocks.map((block) => {
    const from = at;
    at += block.source.length;

    return { from, to: at };
  });
}

/** The counts a field stands beside its blocks, and the opener of each block's oldest thread, by the block. */
interface BlockThreads {
  readonly marks: readonly NativeCommentMark[];
  readonly opens: ReadonlyMap<number, () => void>;
}

/** Each block's count of the threads on its words, and the oldest's opener, by the block. */
function blockThreads(
  spans: readonly { readonly from: number; readonly to: number }[],
  comments: DocumentComments,
): BlockThreads {
  const counts = new Map<number, number>();
  const opens = new Map<number, () => void>();

  for (const thread of comments.threads) {
    const block = spans.findIndex((span) => thread.at >= span.from && thread.at < span.to);

    if (block === -1) continue;
    counts.set(block, (counts.get(block) ?? 0) + 1);

    if (!opens.has(block)) opens.set(block, thread.onOpen);
  }

  const marks = [...counts].map(([block, count]) => ({
    block,
    count,
    heard: comments.heard(count),
  }));

  return { marks, opens };
}

/** A picture's words in its Markdown, `![words](address)`, its escapes read. */
const PICTURE_WORDS = /^!\[((?:\\.|[^\\\]])*)\]/u;

/** How a document's pictures are drawn, as its read rows draw them (`Markdown`'s `pictureSource`, `videoAt` and `fileAt`): each address's picture, video or sound clip, or file, read apart from the words. */
export interface DocumentMedia {
  /** The file a picture is drawn from; none while it is on its way, and `null` where it could not be read. */
  readonly pictureSource: (written: string) => string | null | undefined;
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
  readonly fileAt: (written: string) => MarkdownFile | undefined;
}

/** The looks the field tells back that a block's runs keep. */
const MARKS: ReadonlySet<string> = new Set(Object.values(INLINE_MARK));

/** What the field hands its owner through its ref: a pick in place of the `@` word the caret stands in, plain words there, the keyboard taken or let go, as the message box's handle offers them, and the keys typed since its last frame written at once, before a save or a close reads the words. */
export interface DocumentFieldHandle {
  readonly pick: (pill: Pill) => void;
  readonly rewrite: (words: string) => void;
  readonly focus: () => void;
  readonly blur: () => void;
  readonly flush: () => void;
}

/** Where a field opens its caret as it comes to stand: where a press on the words as read landed, in the block that starts at `at` in the Markdown, `x` and `y` points in from its start; or at the words' start. */
export type DocumentFieldOpening =
  | { readonly at: number; readonly x: number; readonly y: number }
  | typeof OPENS_AT_START;

/** A field that opens with its caret at the words' start. */
export const OPENS_AT_START = "start";

interface DocumentFieldProps {
  readonly ref?: Ref<DocumentFieldHandle> | undefined;
  /** The document, as the Markdown it is saved as. */
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  /** The names of the files the document may hold markers of, each drawn as its pill. */
  readonly files?: ReadonlySet<string> | undefined;
  /** The task's repository, `owner/name`, whose GitHub pages a mention names as its files. */
  readonly repository?: string | null | undefined;
  readonly placeholder?: string | undefined;
  readonly editable?: boolean | undefined;
  /** The `@` word the caret stands in as it changes, which a mention offer reads; none once the caret stands in none. */
  readonly onAtWord?: ((word: CaretAtWord | undefined) => void) | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string | undefined;
  /** Whether the field grows to its words inside the page that holds it, as a description edited in place stands in its task's list, rather than scrolling them itself. */
  readonly fitsWords?: boolean | undefined;
  /** How far over the keyboard the caret's line keeps clear while something stands over the field's foot, such as what an `@` offers docked over the keyboard (none in a column that ends over its offer, which the field keeps clear of on its own); none while nothing stands there. The caret's line is brought back into sight as it comes and goes. */
  readonly keepClear?: number | undefined;
  /** Where the field takes the keyboard with its caret once it stands, read as it mounts; none leaves the keyboard alone. */
  readonly opensAt?: DocumentFieldOpening | undefined;
  /** How the document's pictures are drawn, each as the media it names in its own line, as the read rows draw it; none draws each as a pill of its words. */
  readonly media?: DocumentMedia | undefined;
  /** The document's open comment threads, whose counts stand beside its blocks, and Comment in its edit menu; none stands none. */
  readonly comments?: DocumentComments | undefined;
}

/** What the field last told: the Markdown it wrote, the Markdown that was written against, and its lines as the blocks it wrote read them. */
interface Told {
  readonly markdown: string;
  readonly base: string;
  readonly lines: readonly FieldLine[];
}

/** What the field tells after a change: its lines, and how many changes it has made. */
interface NativeToldEvent {
  readonly lines: readonly NativeToldLine[];
  readonly changes: number;
}

/** What the field told last, and the Markdown its lines were laid from. */
interface PendingLines {
  readonly told: NativeToldEvent;
  readonly base: string;
}

/** No blocks, which the field holds while its words stand read only. */
const NO_BLOCKS: readonly DocumentBlock[] = [];

/** Which of the document's blocks as read holds the Markdown at `at`: the last that starts at or before it, each found in turn in the Markdown it was read from. */
function blockAt(blocks: readonly DocumentBlock[], markdown: string, at: number): number {
  let held = 0;
  let from = 0;

  blocks.forEach((block, index) => {
    const start = markdown.indexOf(block.source, from);

    if (start === -1) return;

    if (start <= at) held = index;
    from = start + block.source.length;
  });

  return held;
}

/** The least a field grown to its words stands before it first tells its height: one body line and its insets. */
const FIT_LEAST = 44;

/** No files held. */
const NO_FILES: ReadonlySet<string> = new Set();

/** A link pressed in the read-only head, which opens nothing: the field stands in its place a frame later. */
function openNoLink(): void {}

/** A card's words for a locked block: what it is, and the first line of its source. */
function cardOf(locked: LockedKind, source: string): NativeCard {
  const first =
    source
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "";

  const detail =
    locked === LOCKED_KIND.DIAGRAM || first === "" ? CARD_DETAIL : first.slice(0, CARD_DETAIL_MOST);

  return { source, title: CARD_TITLE[locked], detail };
}

/** A picture's words, as its Markdown writes them. */
function pictureWords(source: string): string {
  return (PICTURE_WORDS.exec(source)?.[1] ?? "").replaceAll(/\\(.)/gu, "$1");
}

/** What a picture's address holds as the field draws it, as the read rows' picture block reads it: a file, a video or a sound clip, then a picture, on its way, or unread. */
function heldMedia(address: string, alt: string, media: DocumentMedia): NativeMedia {
  const file = media.fileAt(address);

  if (file !== undefined) {
    const label = alt.trim() === "" ? UNNAMED_FILE : alt.trim();

    return { address, kind: MEDIA_KIND.FILE, file: file.source, label, detail: file.size };
  }

  const video = media.videoAt(address);

  if (video !== undefined) {
    const kind = video.audio === true ? MEDIA_KIND.AUDIO : MEDIA_KIND.VIDEO;

    // Note that a recording whose file is not there yet stands on its way, and one that could not be read stands unread, as the read rows' player says.
    if (video.source === undefined)
      return { address, kind: MEDIA_KIND.READING, label: video.label };

    if (video.source === null) return { address, kind: MEDIA_KIND.UNREAD, label: video.label };

    return { address, kind, file: video.source, label: video.label };
  }

  const source = media.pictureSource(address);

  if (source === undefined) return { address, kind: MEDIA_KIND.READING, label: "" };

  if (source === null) return { address, kind: MEDIA_KIND.UNREAD, label: "" };

  return { address, kind: MEDIA_KIND.PICTURE, file: source, label: "" };
}

/** What a Mermaid fence's diagram stands as, by its code: its picture at its own size, its code where Mermaid could not draw it, or its well while it is drawn. */
function heldDiagram(code: string, drawing: DiagramDrawing): NativeMedia {
  const label = DIAGRAM_HEAD;

  if (drawing === undefined)
    return { address: code, kind: MEDIA_KIND.READING, label, detail: code };

  if (drawing === null) return { address: code, kind: MEDIA_KIND.DIAGRAM, label, detail: code };
  const { width, height } = drawing.size;

  return {
    address: code,
    kind: MEDIA_KIND.DIAGRAM,
    file: drawing.source,
    label,
    detail: code,
    width,
    height,
  };
}

/**
 * What each picture and diagram the document's blocks draw as media holds,
 * each address once, in the order first drawn. Note that it is read from
 * the blocks the field's lines stand on, which change only with the
 * Markdown they were read from, never on a key, so typing hands the view
 * none of it; a picture a key took out stands on, unread by any line.
 */
function blocksMedia(
  blocks: readonly DocumentBlock[],
  media: DocumentMedia,
  drawn: DrawnBlocks,
  diagramOf: (code: string) => DiagramDrawing,
): readonly NativeMedia[] {
  const held = new Map<string, NativeMedia>();

  for (const block of blocks) {
    for (const line of block.lines) {
      for (const run of line.runs) {
        if (run.kind !== INLINE_RUN.RAW) continue;
        const code = drawn.diagrams.get(run.source);

        if (code !== undefined) {
          if (!held.has(code)) held.set(code, heldDiagram(code, diagramOf(code)));
          continue;
        }

        const address = run.source.startsWith("![")
          ? drawnPictureAddresses(run.source)[0]
          : undefined;

        if (address === undefined || held.has(address)) continue;
        held.set(address, heldMedia(address, pictureWords(run.source), media));
      }
    }
  }

  return [...held.values()];
}

/** The fence's code a Mermaid block's source writes; none where it writes no fence. */
function fenceCode(source: string): string | undefined {
  const fence = markdownTree(source).children.find((node) => node.type === "code");

  return fence?.type === "code" ? fence.value : undefined;
}

/** The locked blocks of `blocks` drawn as they read: each diagram's code and each table's rows, by the source the field's run keeps. */
function drawnBlocks(blocks: readonly DocumentBlock[], reading: MarkdownReading): DrawnBlocks {
  const diagrams = new Map<string, string>();
  const tables = new Map<string, NativeTable>();

  for (const block of blocks) {
    if (block.kind !== BLOCK_KIND.LOCKED) continue;
    const run = block.lines[0]?.runs[0];

    if (run?.kind !== INLINE_RUN.RAW) continue;

    if (block.locked === LOCKED_KIND.DIAGRAM) {
      const code = fenceCode(run.source);

      if (code !== undefined) diagrams.set(run.source, code);
    }

    if (block.locked === LOCKED_KIND.TABLE) {
      const table = fieldTable(run.source, reading);

      if (table !== undefined) tables.set(run.source, table);
    }
  }

  return { diagrams, tables };
}

/** A run as the native field takes it: words, a pill drawn as the panel's chip, a picture, a diagram or a table drawn as it reads where the field draws media (`drawn`), a picture or break kept as its source as a pill of its own, or a locked block's card. */
function nativeRun(
  run: InlineRun,
  line: FieldLine,
  reading: MarkdownReading,
  markOf: ChipMarkOf,
  drawn: DrawnBlocks | undefined,
): NativeDocumentRun {
  if (run.kind === INLINE_RUN.WORDS) return { text: run.text, marks: run.marks, link: run.link };

  if (run.kind === INLINE_RUN.PILL)
    return { pill: { markdown: run.pill.markdown, ...pillLook(run.pill, reading, markOf) } };

  if (line.kind === BLOCK_KIND.LOCKED) {
    const code = drawn?.diagrams.get(run.source);

    if (code !== undefined)
      return { media: { source: run.source, address: code, alt: DIAGRAM_HEAD } };
    const table = drawn?.tables.get(run.source);

    if (table !== undefined) return { table };

    return { card: cardOf(line.locked ?? LOCKED_KIND.OTHER, run.source) };
  }

  const picture = run.source.startsWith("![");
  const address = picture && drawn !== undefined ? drawnPictureAddresses(run.source)[0] : undefined;

  if (address !== undefined)
    return { media: { source: run.source, address, alt: pictureWords(run.source) } };

  const words = picture ? RAW_WORDS.PICTURE : RAW_WORDS.BREAK;

  return {
    pill: { markdown: run.source, words, glyph: picture ? GLYPH.IMAGE : GLYPH.LINK, heard: words },
  };
}

/** A run the field tells back as the document's run: words with the looks the Markdown keeps, a pill read from its Markdown, or anything else kept as its source. */
function toldRun(run: NativeToldRun, files: ReadonlySet<string>): InlineRun {
  if ("text" in run) {
    const marks = run.marks.filter((mark): mark is InlineMark => MARKS.has(mark));

    return run.link === undefined
      ? { kind: INLINE_RUN.WORDS, text: run.text, marks }
      : { kind: INLINE_RUN.WORDS, text: run.text, marks, link: run.link };
  }

  if ("card" in run) return { kind: INLINE_RUN.RAW, source: run.card.source };

  if ("media" in run) return { kind: INLINE_RUN.RAW, source: run.media.source };

  if ("table" in run) return { kind: INLINE_RUN.RAW, source: run.table.source };
  const [only, ...rest] = pillRuns(run.pill.markdown, files);

  if (only?.kind === PILL_RUN.PILL && rest.length === 0)
    return { kind: INLINE_RUN.PILL, pill: only.pill };

  return { kind: INLINE_RUN.RAW, source: run.pill.markdown };
}

/** The block kinds and card kinds a line may tell, by their words. */
const BLOCK_KINDS: ReadonlyMap<string, FieldLine["kind"]> = new Map(
  Object.values(BLOCK_KIND).map((kind) => [kind, kind]),
);

const LOCKED_KINDS: ReadonlyMap<string, LockedKind> = new Map(
  Object.values(LOCKED_KIND).map((kind) => [kind, kind]),
);

const LIST_MARKERS: ReadonlyMap<string, ListMarker> = new Map(
  Object.values(LIST_MARKER).map((marker) => [marker, marker]),
);

/** A line the field tells back as the model's line, a kind it does not know read as a paragraph. */
function toldLine(line: NativeToldLine, files: ReadonlySet<string>): FieldLine {
  return {
    ...line,
    kind: BLOCK_KINDS.get(line.kind) ?? BLOCK_KIND.PARAGRAPH,
    locked: line.locked === undefined ? undefined : LOCKED_KINDS.get(line.locked),
    marker: line.marker === undefined ? undefined : LIST_MARKERS.get(line.marker),
    runs: line.runs.map((run) => toldRun(run, files)),
  };
}

/** The field itself, inside the renderer its diagrams are drawn through. */
function FieldWords({
  ref,
  value,
  onChange,
  files = NO_FILES,
  repository = null,
  placeholder,
  editable,
  onAtWord,
  style,
  testID,
  fitsWords = false,
  keepClear,
  opensAt,
  media,
  comments,
}: DocumentFieldProps) {
  const colors = useColors();
  const native = useRef<NativeDocumentFieldDoors>(null);
  // The height the words ask for while the field grows to them, none until the field first tells it.
  const [height, setHeight] = useState<number | undefined>(undefined);

  // How many changes the field has told, which the lines handed it say were heard, so it never sets back words typed since.
  const [seen, setSeen] = useState(0);
  const [told, setTold] = useState<Told | undefined>(undefined);
  // The `@` word the caret last stood in, which a pick replaces.
  const atWord = useRef<CaretAtWord | undefined>(undefined);

  // Note that the document the field itself wrote is handed back as the lines it told, written against the same Markdown, rather than read again, which would drop a paragraph's edge spaces and its empty paragraphs.
  const own = told !== undefined && told.markdown === value;
  const base = own ? told.base : value;
  // Whether the field reads its blocks yet: at once where the page drew these words, whose parse is kept (`markdownTree`), and otherwise after its read-only head has drawn, so the sheet never stands empty while a long description parses.
  const [ready, setReady] = useState(() => markdownTreeKept(value));

  useEffect(() => {
    if (ready) return;
    const frame = requestAnimationFrame(() => setReady(true));

    return () => cancelAnimationFrame(frame);
  }, [ready]);

  // The blocks the Markdown the lines stand on reads as, read once for each Markdown: the field's lines are laid from them, and each key's write is laid against them.
  const read = useMemo(
    () => (ready ? documentBlocks(base, files) : NO_BLOCKS),
    [ready, base, files],
  );

  // Note that a pill leads with a Manager's face where the app holds one, so the words are handed again as the marks move, as they are on each key.
  const markOf = useChipMarkOf();

  // The diagrams and tables the field draws as they read, read once for each Markdown the lines stand on rather than on each key, and the diagrams' pictures, asked of the renderer around the field.
  const drawn = useMemo(
    () =>
      media === undefined
        ? undefined
        : drawnBlocks(read, { repository, now: Date.now(), zone: readerZone() }),
    [media, read, repository],
  );

  const codes = useMemo(
    () => (drawn === undefined ? NO_CODES : [...drawn.diagrams.values()]),
    [drawn],
  );

  const diagramOf = useDiagramPictures(codes);

  const handed = useMemo(() => {
    const reading = { repository, now: Date.now(), zone: readerZone() };
    const laid = own ? told.lines : fieldLines(read);

    const lines = laid.map(
      (line): NativeDocumentLine => ({
        ...line,
        runs: line.runs.map((run) => nativeRun(run, line, reading, markOf, drawn)),
      }),
    );

    return { markdown: base, value: { lines, seen } };
  }, [own, told, read, base, repository, seen, markOf, drawn]);

  // What each picture and diagram the document draws holds, handed apart from the words, so one landing draws only it again.
  const held = useMemo(
    () =>
      media === undefined || drawn === undefined
        ? undefined
        : blocksMedia(read, media, drawn, diagramOf),
    [media, drawn, read, diagramOf],
  );

  // Where each block stands in the Markdown the lines stand on, and the counts of the threads on each.
  const spans = useMemo(() => blockSpans(read), [read]);

  const threaded = useMemo(
    () => (comments === undefined ? undefined : blockThreads(spans, comments)),
    [spans, comments],
  );

  const look = {
    text: colors.TEXT,
    placeholder: colors.TEXT_MUTED,
    tint: colors.TEXT,
    pillFill: colors.FILL_STRONG,
    pillWords: colors.TEXT,
    pillGlyph: colors.TEXT_MUTED,
    well: colors.WELL,
    edge: colors.CHIP_EDGE,
  };

  const onCaret = ({ nativeEvent }: NativeSyntheticEvent<CaretLine>) => {
    const word = caretAtWord(nativeEvent);

    if (sameAtWord(word, atWord.current)) return;
    atWord.current = word;
    onAtWord?.(word);
  };

  // Note that the alert asks for the address in UIKit's own alert, as the desktop's link field asks in its popover, offering Remove link where the words hold one.
  const onLinkAsk = ({ nativeEvent }: NativeSyntheticEvent<{ readonly address: string }>) => {
    // Note that both acts take a cleared address, which takes the words' link off, as the desktop's field does.
    const done: WordsAct = {
      label: FORMAT_WORDS.DONE,
      onWords: (address) => void native.current?.setLink(address),
      takesBlank: true,
    };

    const remove: WordsAct = {
      label: FORMAT_WORDS.REMOVE_LINK,
      onWords: () => void native.current?.setLink(""),
      takesBlank: true,
    };

    askForWords({
      title: WRITING_SHORTCUTS[WRITING_MARK.LINK].label,
      message: FORMAT_WORDS.LINK_MESSAGE,
      initial: nativeEvent.address,
      kind: WORDS_KIND.URL,
      acts: nativeEvent.address === "" ? [done] : [remove, done],
    });
  };

  // The lines the field told last, written once a frame, so fast typing writes the document once for every frame rather than once for every key.
  const pending = useRef<PendingLines | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  const write = () => {
    frame.current = undefined;
    const held = pending.current;

    if (held === undefined) return;
    pending.current = undefined;
    const { told } = held;

    // Note that words handed from outside since the key, such as Use theirs, win over the lines told against the words before them: the keys are heard, so the field takes the words handed.
    if (held.base !== handed.markdown) {
      setSeen(told.changes);

      return;
    }

    const edited = editedBlocks(told.lines.map((line) => toldLine(line, files)));
    // Note that the document is written against the Markdown whose blocks were last handed, which the lines' sources name.
    const markdown = writtenDocument(handed.markdown, edited, files, read);
    setSeen(told.changes);
    setTold({ markdown, base: handed.markdown, lines: editedLines(edited) });

    if (markdown !== value) onChange(markdown);
  };

  // Note that the frame's write reads the newest render's Markdown and blocks, which a render between the key and the frame may have handed.
  const latest = useRef(write);

  useEffect(() => {
    latest.current = write;
  });

  // Where the field takes the keyboard as it comes to stand, on the first line the pressed block of the document as read became, handed to the view, which lays it once it stands in a window, as a list builds a row only in sight.
  const opening = useMemo((): NativeOpening | undefined => {
    if (opensAt === undefined) return undefined;

    if (opensAt === OPENS_AT_START) return { nonce: 1, start: true, line: 0, x: 0, y: 0 };

    const block = blockAt(read, base, opensAt.at);
    const found = handed.value.lines.findIndex((each) => each.from === block);
    const line = Math.max(0, found);

    return { nonce: 1, start: false, line, x: opensAt.x, y: opensAt.y };
  }, [opensAt, read, base, handed]);

  const onLines = ({ nativeEvent }: NativeSyntheticEvent<NativeToldEvent>) => {
    pending.current = { told: nativeEvent, base: handed.markdown };
    frame.current ??= requestAnimationFrame(() => latest.current());
  };

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      pick: (pill) => {
        void native.current?.insertPills(
          [drawnPill(pill, repository, markOf)],
          toldWord(atWord.current),
        );
      },
      rewrite: (words) => void native.current?.rewriteWord(words, toldWord(atWord.current)),
      focus: () => void native.current?.focus(),
      blur: () => void native.current?.blur(),
      flush: () => {
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        latest.current();
      },
    }),
    [repository, markOf],
  );

  // Note that the read-only head is no field, so nothing waits on it as the field it stands in for; it stands clear of the bar as the field's text view does, and in a page's list it stands at its own height, as the words read there.
  if (!ready && fitsWords)
    return (
      <View style={style}>
        <Markdown
          words={descriptionHead(value)}
          repository={repository}
          onOpenLink={openNoLink}
          headings
        />
      </View>
    );

  if (!ready)
    return (
      <ScrollView style={style} contentInsetAdjustmentBehavior="automatic" scrollEnabled={false}>
        <Markdown
          words={descriptionHead(value)}
          repository={repository}
          onOpenLink={openNoLink}
          headings
        />
      </ScrollView>
    );

  return (
    <NativeDocumentField
      ref={native}
      style={fitsWords ? [style, { height: height ?? FIT_LEAST }] : style}
      fitsWords={fitsWords}
      keepClear={keepClear}
      opening={opening}
      onHeight={fitsWords ? ({ nativeEvent }) => setHeight(nativeEvent.height) : undefined}
      value={handed.value}
      media={held}
      comments={threaded?.marks}
      commentAct={comments === undefined ? undefined : COMMENT_ACT}
      onCommentOpen={({ nativeEvent }) => threaded?.opens.get(nativeEvent.block)?.()}
      onCommentAsk={({ nativeEvent }) => {
        const span = spans[nativeEvent.block];

        if (span !== undefined) comments?.onComment({ ...span, quote: nativeEvent.quote });
      }}
      look={look}
      placeholder={placeholder}
      editable={editable}
      formats={FORMATS}
      testID={testID}
      onLinkAsk={onLinkAsk}
      onCaret={onCaret}
      onLines={onLines}
      onFocusChange={() => undefined}
    />
  );
}

/**
 * A document edited as rich text, as Notion edits a page: the app's native
 * document field (`document-field-native.ts`) draws each block of the
 * Markdown with no syntax (`@repo/features/document-blocks`), its pictures,
 * diagrams and tables as the read rows draw them where it is handed
 * `media`, any other block the phone cannot edit (HTML, a footnote) as a
 * card, and tells its lines back after each change; the document is written
 * from them (`writtenDocument`), each untouched block as its exact source,
 * so an agent's tables and diagrams survive a phone's edit. The field fills
 * the room it is given and scrolls, its words clear of the keyboard. Note
 * that its diagrams are drawn through one renderer around it, which holds
 * no web view until a diagram not drawn before asks for one.
 */
export function DocumentField(props: DocumentFieldProps) {
  return (
    <DiagramRenderer>
      <FieldWords {...props} />
    </DiagramRenderer>
  );
}
