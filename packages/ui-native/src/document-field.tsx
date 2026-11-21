// document-field.tsx -- a document's rich field, as Notion edits a page: each block drawn with no syntax in the app's native document field, and the document written back with only the blocks that changed printed again.

import { readerZone } from "@repo/features/date-mention";
import {
  BLOCK_KIND,
  documentBlocks,
  INLINE_MARK,
  INLINE_RUN,
  type InlineMark,
  type InlineRun,
  LOCKED_KIND,
  type LockedKind,
  writtenDocument,
} from "@repo/features/document-blocks";
import { PILL_RUN, pillRuns } from "@repo/features/pill-words";
import { type Ref, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import { editedBlocks, type FieldLine, fieldLines } from "./document-field-model.js";
import {
  type NativeCard,
  type NativeDocumentFieldDoors,
  type NativeDocumentLine,
  type NativeDocumentRun,
  NativeDocumentField,
  type NativeToldLine,
  type NativeToldRun,
} from "./document-field-native.js";
import { GLYPH } from "./glyph.js";
import type { MarkdownReading } from "./markdown-model.js";
import { pillLook } from "./pill-look.js";
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

/** What a picture or a line break kept as its source draws as in the words. */
const RAW_WORDS = { PICTURE: "Picture", BREAK: "Line break" } as const;

/** The looks the field tells back that a block's runs keep. */
const MARKS: ReadonlySet<string> = new Set(Object.values(INLINE_MARK));

/** What the field hands its owner through its ref. */
export interface DocumentFieldHandle {
  readonly focus: () => void;
  readonly blur: () => void;
}

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
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string | undefined;
}

/** No files held. */
const NO_FILES: ReadonlySet<string> = new Set();

/** A card's words for a locked block: what it is, and the first line of its source. */
function cardOf(locked: LockedKind, source: string): NativeCard {
  const first = source.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const detail = locked === LOCKED_KIND.DIAGRAM || first === "" ? CARD_DETAIL : first.slice(0, CARD_DETAIL_MOST);

  return { source, title: CARD_TITLE[locked], detail };
}

/** A run as the native field takes it: words, a pill drawn as the panel's chip, a picture or break kept as its source as a pill of its own, or a locked block's card. */
function nativeRun(run: InlineRun, line: FieldLine, reading: MarkdownReading): NativeDocumentRun {
  if (run.kind === INLINE_RUN.WORDS) return { text: run.text, marks: run.marks, link: run.link };

  if (run.kind === INLINE_RUN.PILL) return { pill: { markdown: run.pill.markdown, ...pillLook(run.pill, reading) } };

  if (line.kind === BLOCK_KIND.LOCKED) return { card: cardOf(line.locked ?? LOCKED_KIND.OTHER, run.source) };

  const picture = run.source.startsWith("![");
  const words = picture ? RAW_WORDS.PICTURE : RAW_WORDS.BREAK;

  return { pill: { markdown: run.source, words, glyph: picture ? GLYPH.IMAGE : GLYPH.LINK, heard: words } };
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

  if (only?.kind === PILL_RUN.PILL && rest.length === 0) return { kind: INLINE_RUN.PILL, pill: only.pill };

  return { kind: INLINE_RUN.RAW, source: run.pill.markdown };
}

/** A line the field tells back as the model's line. */
function toldLine(line: NativeToldLine, files: ReadonlySet<string>): FieldLine {
  return {
    ...line,
    kind: line.kind as FieldLine["kind"],
    locked: line.locked as LockedKind | undefined,
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
  style,
  testID,
}: DocumentFieldProps) {
  const colors = useColors();
  const native = useRef<NativeDocumentFieldDoors>(null);
  // How many changes the field has told, which the lines handed it say were heard, so it never sets back words typed since.
  const [seen, setSeen] = useState(0);

  const handed = useMemo(() => {
    const reading = { repository, now: Date.now(), zone: readerZone() };

    const lines = fieldLines(documentBlocks(value, files)).map(
      (line): NativeDocumentLine => ({
        ...line,
        runs: line.runs.map((run) => nativeRun(run, line, reading)),
      }),
    );

    return { markdown: value, value: { lines, seen } };
  }, [value, files, repository, seen]);

  const look = {
    text: colors.TEXT,
    placeholder: colors.TEXT_MUTED,
    tint: colors.TEXT,
    pillFill: colors.FILL_STRONG,
    pillWords: colors.TEXT,
    pillGlyph: colors.TEXT_MUTED,
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => void native.current?.focus(),
      blur: () => void native.current?.blur(),
    }),
    [],
  );

  const onLines = ({
    nativeEvent,
  }: NativeSyntheticEvent<{ readonly lines: readonly NativeToldLine[]; readonly changes: number }>) => {
    const edited = editedBlocks(nativeEvent.lines.map((line) => toldLine(line, files)));
    // Note that the document is written against the Markdown whose blocks were last handed, which the lines' sources name.
    const markdown = writtenDocument(handed.markdown, edited, files);
    setSeen(nativeEvent.changes);

    if (markdown !== handed.markdown) onChange(markdown);
  };

  return (
    <NativeDocumentField
      ref={native}
      style={style}
      value={handed.value}
      look={look}
      placeholder={placeholder}
      editable={editable}
      testID={testID}
      onLines={onLines}
      onFocusChange={() => undefined}
    />
  );
}
