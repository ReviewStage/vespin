// pill-field.tsx -- the app's one field of words that draws mentions and files' markers as pills inside them, as the panel's box draws its chips, while its value stays the Markdown the wire carries.

import { readerZone } from "@repo/features/date-mention";
import { PILL_RUN, type Pill, pillRuns } from "@repo/features/pill-words";
import { type Ref, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { NativeSyntheticEvent } from "react-native";
import { type CaretAtWord, caretAtWord, drawnPill, sameAtWord, toldWord } from "./caret-at-word.js";
import { useChipMarkOf } from "./chip-mark.js";
import {
  NativePillField,
  type NativePillFieldDoors,
  type NativeValue,
  type NativeWords,
} from "./pill-field-native.js";
import { pillLook } from "./pill-look.js";
import { type ListKeysField, listKeyOf } from "./suggestion-keys.js";
import { useColors } from "./tokens/colors.js";

/** No files held: every marker stays words. */
const NO_FILES: ReadonlySet<string> = new Set();

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
  /** The `@` word the caret stands in as it changes, which a mention offer reads; none once the caret stands in none. */
  readonly onAtWord?: ((word: CaretAtWord | undefined) => void) | undefined;
  readonly onFocusChange?: ((focused: boolean) => void) | undefined;
  /** The list offered over the field, whose rows a hardware keyboard's keys move through and pick (`useSuggestionKeysHost`); none while none floats. */
  readonly listKeys?: ListKeysField | undefined;
  readonly testID?: string | undefined;
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
  onAtWord,
  onFocusChange,
  listKeys,
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

  // Note that a pill leads with a Manager's face where the app holds one, so the words are handed again as the marks move, as they are on each key.
  const markOf = useChipMarkOf();

  const handed = useMemo((): NativeValue => {
    const reading = { repository, now: Date.now(), zone: readerZone() };

    const drawn = (pill: Pill) => ({
      pill: { markdown: pill.markdown, ...pillLook(pill, reading, markOf) },
    });

    const runs = pillRuns(value, files).map((run) =>
      run.kind === PILL_RUN.WORDS ? { text: run.text } : drawn(run.pill),
    );

    return { runs, seen };
  }, [value, files, repository, seen, markOf]);

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
        void native.current?.insertPills(
          [drawnPill(pill, repository, markOf)],
          toldWord(atWord.current),
        );
      },
      rewrite: (words) => void native.current?.rewriteWord(words, toldWord(atWord.current)),
      place: (pills) => {
        void native.current?.insertPills(
          pills.map((pill) => drawnPill(pill, repository, markOf)),
          undefined,
        );
      },
      focus: () => void native.current?.focus(),
      blur: () => void native.current?.blur(),
    }),
    [repository, markOf],
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
      listKeys={listKeys !== undefined}
      listPicks={listKeys?.picks === true}
      onListKey={({ nativeEvent }) => {
        const key = listKeyOf(nativeEvent.key);

        if (key !== undefined) listKeys?.onKey(key);
      }}
    />
  );
}
