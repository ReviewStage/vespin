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
import { markdownTreeKept } from "@repo/features/markdown-tree";
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
import { editedBlocks, editedLines, type FieldLine, fieldLines } from "./document-field-model.js";
import {
  FORMAT_ACT,
  type FormatAct,
  type NativeCard,
  NativeDocumentField,
  type NativeDocumentFieldDoors,
  type NativeDocumentLine,
  type NativeDocumentRun,
  type NativeFormatAct,
  type NativeFormats,
  type NativeOpening,
  type NativeToldLine,
  type NativeToldRun,
} from "./document-field-native.js";
import { GLYPH, WRITING_GLYPH } from "./glyph.js";
import { Markdown } from "./markdown.js";
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

/** A run as the native field takes it: words, a pill drawn as the panel's chip, a picture or break kept as its source as a pill of its own, or a locked block's card. */
function nativeRun(run: InlineRun, line: FieldLine, reading: MarkdownReading): NativeDocumentRun {
  if (run.kind === INLINE_RUN.WORDS) return { text: run.text, marks: run.marks, link: run.link };

  if (run.kind === INLINE_RUN.PILL)
    return { pill: { markdown: run.pill.markdown, ...pillLook(run.pill, reading) } };

  if (line.kind === BLOCK_KIND.LOCKED)
    return { card: cardOf(line.locked ?? LOCKED_KIND.OTHER, run.source) };

  const picture = run.source.startsWith("![");
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

/**
 * A document edited as rich text, as Notion edits a page: the app's native
 * document field (`document-field-native.ts`) draws each block of the
 * Markdown with no syntax (`@repo/features/document-blocks`), a block the
 * phone cannot edit (a table, a diagram, HTML) as a card, and tells its
 * lines back after each change; the document is written from them
 * (`writtenDocument`), each untouched block as its exact source, so an
 * agent's tables and diagrams survive a phone's edit. The field fills the
 * room it is given and scrolls, its words clear of the keyboard.
 */
export function DocumentField({
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

  const handed = useMemo(() => {
    const reading = { repository, now: Date.now(), zone: readerZone() };
    const laid = own ? told.lines : fieldLines(read);

    const lines = laid.map(
      (line): NativeDocumentLine => ({
        ...line,
        runs: line.runs.map((run) => nativeRun(run, line, reading)),
      }),
    );

    return { markdown: base, value: { lines, seen } };
  }, [own, told, read, base, repository, seen]);

  const look = {
    text: colors.TEXT,
    placeholder: colors.TEXT_MUTED,
    tint: colors.TEXT,
    pillFill: colors.FILL_STRONG,
    pillWords: colors.TEXT,
    pillGlyph: colors.TEXT_MUTED,
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
        void native.current?.insertPills([drawnPill(pill, repository)], toldWord(atWord.current));
      },
      rewrite: (words) => void native.current?.rewriteWord(words, toldWord(atWord.current)),
      focus: () => void native.current?.focus(),
      blur: () => void native.current?.blur(),
      flush: () => {
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        latest.current();
      },
    }),
    [repository],
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
