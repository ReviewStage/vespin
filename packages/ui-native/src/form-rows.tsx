// form-rows.tsx -- the rows a sheet's Form holds: the words to send, the pictures attached to them, and a choice among many in the system's menu picker; and the words on a page written whole, such as a description's.

import {
  Button,
  HStack,
  Image,
  Picker,
  SecureField,
  TextField,
  type TextFieldRef,
  useNativeState,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  autocorrectionDisabled,
  buttonStyle,
  font,
  frame,
  lineLimit,
  listRowBackground,
  pickerStyle,
  textInputAutocapitalization,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { longPasteIn } from "@repo/features/long-paste";
import { useEffect, useRef } from "react";
import { type AttachedPicture, AttachedPictures } from "./composer-head.js";
import { forgetField, noteFieldFocus } from "./field-focus.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { PickOption as PickedOption } from "./glyph-label.js";
import { dropPictures } from "./interactions.js";
import type { PickOption } from "./settings-form.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How many lines the words take before anything is typed, and the most they grow to before they scroll. */
const WORDS_LINES = { min: 4, max: 12 } as const;

/** Where a sheet's words stand: a row of a Form on the surface, a row holding one line such as a name, or a row holding one line kept from sight such as a key or a token, as a password field keeps it. */
export const WORDS_LOOK = {
  ROW: "row",
  LINE: "line",
  SECRET: "secret",
} as const;

type WordsLook = (typeof WORDS_LOOK)[keyof typeof WORDS_LOOK];

type WordsFieldProps = {
  /** What the field says before anything is typed: "Describe the task". */
  readonly placeholder: string;
  /** Called with the words as they are typed. */
  readonly onWords: (words: string) => void;
  /** The words it opens on, such as a draft kept elsewhere; none where it opens empty. */
  readonly initialWords?: string | undefined;
  /** The words its holder keeps, written into the field where they move apart from what was typed, as a skill picked writes its `/name`; the field keeps its own where none are given. */
  readonly words?: string | undefined;
  /** Whether the keyboard rises on it as the sheet opens. */
  readonly autoFocus?: boolean | undefined;
  /** The name a flow finds the field by. */
  readonly testId?: string | undefined;
  /** What VoiceOver hears the field as, where its placeholder alone would not say what it holds once words are typed. */
  readonly label?: string | undefined;
  /** Holds the words as they stand, such as while they are being sent. */
  readonly disabled?: boolean | undefined;
  /** Whether the words are taken as typed, such as a command or a name, with no correction, capital, or smart dash or quote. */
  readonly verbatim?: boolean | undefined;
  /** Where the words stand: a Form's row, a row of one line, or the sheet's own page. */
  readonly look?: WordsLook | undefined;
  /** Takes words pasted long enough to come as a file (`@repo/features/long-paste`), answering whether it did, so the field takes them back out of its words; they paste as words where none is given. */
  readonly onLongPaste?: ((words: string) => boolean) | undefined;
  /** The most characters it holds, such as the words beside a survey's Other; no bound where none is given. */
  readonly maxLength?: number | undefined;
};

/**
 * The words a sheet sends, as a row of the system's own multi-line field on
 * the surface: a few lines tall before anything is typed, growing with its
 * words; or, on a page of its own, the field alone on the page's ground,
 * growing with no bound while the page scrolls. The field keeps its
 * own words, as a composer's does, and hands each change to its holder,
 * taking the holder's back only where they moved apart from what was typed.
 */
export function WordsField({
  placeholder,
  onWords,
  initialWords = "",
  words,
  autoFocus = false,
  testId,
  label,
  disabled = false,
  verbatim = false,
  look = WORDS_LOOK.ROW,
  onLongPaste,
  maxLength,
}: WordsFieldProps) {
  const colors = useColors();
  const text = useNativeState(words ?? initialWords);
  const shown = useRef(words ?? initialWords);
  const field = useRef<TextFieldRef>(null);

  // Note that a field that leaves the screen is forgotten, so a later close never lowers a handle no longer drawn.
  useEffect(() => {
    const drawn = field.current;

    return () => {
      if (drawn !== null) forgetField(drawn);
    };
  }, []);

  // Note that the field is handed the holder's words only where they moved apart from what was typed, so typing never fights its own echo.
  useEffect(() => {
    if (words === undefined || words === shown.current) return;
    shown.current = words;
    text.set(words);
  }, [words, text]);

  // Note that a long paste its holder took as a file is taken back out of the words at once, since the field hears no paste of its own, only its words as they change.
  const type = (next: string) => {
    const pasted = onLongPaste === undefined ? undefined : longPasteIn(shown.current, next);
    const taken = pasted !== undefined && onLongPaste?.(pasted.words) === true;
    const kept = taken ? pasted.kept : next;
    // Note that words past the most the field holds are cut back as they are typed or pasted, so the field stands still at its bound.
    const words = maxLength === undefined ? kept : kept.slice(0, maxLength);
    shown.current = words;

    if (words !== next) text.set(words);
    onWords(words);
  };

  const marks = [
    font({ textStyle: TYPE_ROLE.ROW_TITLE }),
    SwiftModifiers.disabled(disabled),
    ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
    ...(label === undefined ? [] : [accessibilityLabel(label)]),
  ];

  // Note that a secret stands in the system's secure field, which keeps its words from sight and from the screen's recording, as a password field does; it takes no long paste and no correction.
  if (look === WORDS_LOOK.SECRET) {
    return (
      <SecureField
        text={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onTextChange={type}
        modifiers={[...marks, listRowBackground(colors.RAISED)]}
      />
    );
  }

  // Note that a row of one line, such as a name, stands as one line, as Settings' name fields do, rather than in a box a few lines tall.
  const bounds = {
    [WORDS_LOOK.ROW]: [lineLimit(WORDS_LINES), listRowBackground(colors.RAISED)],
    [WORDS_LOOK.LINE]: [listRowBackground(colors.RAISED)],
  }[look];

  return (
    <TextField
      ref={field}
      text={text}
      onFocusChange={(holds) => {
        if (field.current !== null) noteFieldFocus(field.current, holds);
      }}
      placeholder={placeholder}
      axis={look === WORDS_LOOK.LINE ? "horizontal" : "vertical"}
      autoFocus={autoFocus}
      onTextChange={type}
      modifiers={[
        ...marks,
        ...bounds,
        // Note that turning correction off turns iOS's smart dashes and quotes off with it, so `--skill` stays two hyphens.
        ...(verbatim ? [autocorrectionDisabled(), textInputAutocapitalization("never")] : []),
      ]}
    />
  );
}

type AttachRowProps = {
  readonly pictures: readonly AttachedPicture[];
  /** Opens what the + adds: the system's photo picker. */
  readonly onAdd: () => void;
  readonly onDetach: (id: string) => void;
  /** The name a flow finds the + by. */
  readonly testId?: string | undefined;
  /** Called with the file addresses of pictures dropped on the row from Photos, Files, or another app, on an iPad; it takes no drop where none is given. */
  readonly onDropPictures?: ((uris: readonly string[], unreadable: number) => void) | undefined;
};

/**
 * The pictures a sheet sends with its words, as a row under them: the +, as
 * a composer's field leads with it, then each picture attached as the
 * composer's head draws it, a capsule taken off on a press. While nothing
 * is attached, the + takes a tap across the whole row, since the row is
 * heard as Add picture from edge to edge. Pictures dropped on the row, on
 * an iPad, are attached as the + attaches them.
 */
export function AttachRow({ pictures, onAdd, onDetach, testId, onDropPictures }: AttachRowProps) {
  const colors = useColors();

  return (
    <HStack
      spacing={SPACE.TIGHT * 2}
      modifiers={[
        listRowBackground(colors.RAISED),
        ...(onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]),
      ]}
    >
      <Button
        onPress={onAdd}
        modifiers={[
          buttonStyle("borderless"),
          accessibilityLabel("Add picture"),
          ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
        ]}
      >
        <Image
          {...glyphImage(GLYPH.ADD)}
          size={MARK_SIZE.LEAD + 2}
          color={colors.TEXT_MUTED}
          modifiers={
            pictures.length === 0
              ? [
                  frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
                  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
                ]
              : []
          }
        />
      </Button>
      <AttachedPictures pictures={pictures} onDetach={onDetach} />
    </HStack>
  );
}

type PickRowProps = {
  /** The row's name, beside what is picked. */
  readonly label: string;
  readonly options: readonly PickOption[];
  readonly picked: string | undefined;
  readonly onPick: (id: string) => void;
};

/**
 * A choice among many, such as a repository or a model, as the system's menu
 * picker draws it in a Form's row: its name, and what is picked at its end in
 * the muted ink, opening the menu of every option on a press, each led by
 * its glyph where it has one, as the panel's picker leads a permission mode.
 */
export function MenuPickRow({ label, options, picked, onPick }: PickRowProps) {
  const colors = useColors();

  return (
    <Picker<string | null>
      label={label}
      selection={picked ?? null}
      onSelectionChange={(id) => {
        if (id !== null) onPick(id);
      }}
      modifiers={[pickerStyle("menu"), tint(colors.TEXT_MUTED), listRowBackground(colors.RAISED)]}
    >
      {options.map((option) => (
        <PickedOption
          key={option.id}
          label={option.label}
          value={option.id}
          glyph={option.symbol}
        />
      ))}
    </Picker>
  );
}
