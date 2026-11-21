// pill-field.tsx -- the app's one field of words that draws mentions and files' markers as pills inside them, as the panel's box draws its chips, while its value stays the Markdown the wire carries.

import { type AtWord, atWordAround } from "@repo/features/at-word";
import { readerZone } from "@repo/features/date-mention";
import { styledRuns } from "@repo/features/markdown-styles";
import { PILL_RUN, type Pill, pillRuns } from "@repo/features/pill-words";
import { type Ref, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { NativeSyntheticEvent } from "react-native";
import {
  type MarksShown,
  type NativePill,
  NativePillField,
  type NativePillFieldDoors,
  type NativeValue,
  type NativeWord,
  type NativeWords,
} from "./pill-field-native.js";
import { pillLook } from "./pill-look.js";
import { useColors } from "./tokens/colors.js";

/** No files held: every marker stays words. */
const NO_FILES: ReadonlySet<string> = new Set();

/** The `@` word the caret stands in, and the drawn words a pick replaces: where they start and end, and the words themselves, `@` and all. */
export interface CaretAtWord extends AtWord {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * What a screen does to the field: puts a pill in place of the `@` word the
 * caret stands in, or at the caret where it stands in none; writes plain
 * words in that word's place, such as `@people:` as a kind is picked to
 * narrow it; puts pills at the caret, such as files' markers as they are
 * attached; and takes or lets go of the keyboard. Note that the field finds
 * the word again by its words where it moved since it was told, so a pick
 * made while words are still being typed lands rather than being dropped.
 */
export interface PillFieldHandle {
  readonly pick: (pill: Pill) => void;
  readonly rewrite: (words: string) => void;
  readonly place: (pills: readonly Pill[]) => void;
  readonly focus: () => void;
  readonly blur: () => void;
}

interface PillFieldProps {
  readonly ref?: Ref<PillFieldHandle> | undefined;
  /** The words, as the Markdown the wire carries. */
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  /** The names of the files the words may hold markers of, each drawn as its pill; no other marker is one. */
  readonly files?: ReadonlySet<string> | undefined;
  /** The task's repository, `owner/name`, whose GitHub pages a mention names as its files. */
  readonly repository?: string | null | undefined;
  readonly placeholder?: string | undefined;
  /** The most lines it grows to before it scrolls. */
  readonly maxLines?: number | undefined;
  readonly editable?: boolean | undefined;
  /** Whether the field takes the keyboard as it first stands, as a page that starts work opens on its words. */
  readonly autoFocus?: boolean | undefined;
  /** Draws the words in the looks the page draws them in as they are written, as a document edited whole is, its syntax's marks shown as `marks` says; plain words, as a message's, where none is given. */
  readonly styled?: { readonly marks: MarksShown } | undefined;
  /** The `@` word the caret stands in as it changes, which a mention offer reads; none once the caret stands in none. */
  readonly onAtWord?: ((word: CaretAtWord | undefined) => void) | undefined;
  readonly onFocusChange?: ((focused: boolean) => void) | undefined;
  readonly testID?: string | undefined;
}

/** The `@` word the caret ends where nothing is selected, with the drawn words a pick replaces: the `@`, what is typed after it, and the rest of the word past the caret. */
function caretAtWord(words: NativeWords): CaretAtWord | undefined {
  if (words.selected) return undefined;
  const word = atWordAround(words.before, words.after);

  if (word === undefined) return undefined;
  const typed = `@${word.query}`;

  return {
    ...word,
    start: words.caret - typed.length,
    end: words.caret + word.rest,
    text: typed + words.after.slice(0, word.rest),
  };
}

/** The `@` word as the native field finds it again: where it stood and its words; none where the caret stands in none. */
function toldWord(word: CaretAtWord | undefined): NativeWord | undefined {
  return word === undefined ? undefined : { start: word.start, text: word.text };
}

/** A pill as the native field draws it: its Markdown, and its look as the chip it becomes once sent. */
function drawnPill(pill: Pill, repository: string | null): NativePill {
  const reading = { repository, now: Date.now(), zone: readerZone() };

  return { markdown: pill.markdown, ...pillLook(pill, reading) };
}

/** Whether two `@` words are the same word at the same place. */
function sameAtWord(one: CaretAtWord | undefined, other: CaretAtWord | undefined): boolean {
  return one?.query === other?.query && one?.start === other?.start && one?.end === other?.end;
}

/**
 * A field of words that grows from one line to `maxLines` and then
 * scrolls, drawing each mention and each marker of a held file as a pill
 * (`@repo/features/pill-words`), its look the chip it becomes once sent
 * (`pillLook`). A pill selects and deletes as one, and copies as its
 * Markdown, as the desktop's box copies. The value goes out exactly as the
 * desktop writes it. The field tells the `@` word the caret stands in, so a
 * mention offer opens on it, and `pick` puts the picked pill in its place.
 * It is UIKit's text view on TextKit 2 (`pill-field-native.ts`): the system's
 * edit menu, dictation, autocorrect, and Dynamic Type are its own.
 */
export function PillField({
  ref,
  value,
  onChange,
  files = NO_FILES,
  repository = null,
  placeholder,
  maxLines,
  editable,
  autoFocus,
  styled,
  onAtWord,
  onFocusChange,
  testID,
}: PillFieldProps) {
  const colors = useColors();
  const native = useRef<NativePillFieldDoors>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  // Whether the field has asked for the keyboard as it first stood, which `autoFocus` asks once.
  const focusedFirst = useRef(false);
  // How many changes the field has told, which the words handed it say were heard, so it never sets back words typed since.
  const [seen, setSeen] = useState(0);
  // What the field last told: its Markdown, and its `@` word.
  const told = useRef({ markdown: value });
  const atWord = useRef<CaretAtWord | undefined>(undefined);

  const marks = styled?.marks;

  const handed = useMemo((): NativeValue => {
    const reading = { repository, now: Date.now(), zone: readerZone() };

    const drawn = (pill: Pill) => ({
      pill: { markdown: pill.markdown, ...pillLook(pill, reading) },
    });

    // Note that the looks are read only for a field that draws them, so a message's box never parses its words on each key.
    const runs =
      marks === undefined
        ? pillRuns(value, files).map((run) =>
            run.kind === PILL_RUN.WORDS ? { text: run.text } : drawn(run.pill),
          )
        : styledRuns(value, files).map((run) =>
            run.kind === PILL_RUN.WORDS ? { text: run.text, styles: run.styles } : drawn(run.pill),
          );

    return { runs, seen };
  }, [value, files, repository, seen, marks]);

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
      pick: (pill) => {
        void native.current?.insertPills([drawnPill(pill, repository)], toldWord(atWord.current));
      },
      rewrite: (words) => void native.current?.rewriteWord(words, toldWord(atWord.current)),
      place: (pills) => {
        void native.current?.insertPills(
          pills.map((pill) => drawnPill(pill, repository)),
          undefined,
        );
      },
      focus: () => void native.current?.focus(),
      blur: () => void native.current?.blur(),
    }),
    [repository],
  );

  const onWords = ({ nativeEvent: words }: NativeSyntheticEvent<NativeWords>) => {
    const changed = words.markdown !== told.current.markdown;
    told.current = { markdown: words.markdown };
    setSeen(words.changes);

    if (changed) onChange(words.markdown);
    const word = caretAtWord(words);

    if (sameAtWord(word, atWord.current)) return;
    atWord.current = word;
    onAtWord?.(word);
  };

  return (
    <NativePillField
      ref={native}
      style={height === undefined ? undefined : { height }}
      value={handed}
      look={look}
      placeholder={placeholder}
      maxLines={maxLines}
      editable={editable}
      marks={marks}
      testID={testID}
      onWords={onWords}
      onHeight={({ nativeEvent }) => {
        setHeight(nativeEvent.height);

        // Note that the field asks for the keyboard once it has first laid out, because UIKit grants it only to a view standing in a window, which its first measure says it is.
        if (autoFocus !== true || focusedFirst.current) return;

        focusedFirst.current = true;
        void native.current?.focus();
      }}
      onFocusChange={({ nativeEvent }) => onFocusChange?.(nativeEvent.focused)}
    />
  );
}
