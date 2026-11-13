// form-rows.tsx -- the rows a composing sheet's Form holds: the words to send, the skills a `/` in them offers, the pictures attached to them, and a choice among many in the system's menu picker.

import { Button, HStack, Image, Picker, Text, TextField, useNativeState } from "@expo/ui/swift-ui";
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
  tag,
  textInputAutocapitalization,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useRef } from "react";
import {
  type AttachedPicture,
  AttachedPictures,
  type SkillSuggestion,
  SkillSuggestions,
} from "./composer-head.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { dropPictures } from "./interactions.js";
import type { PickOption } from "./settings-form.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How many lines the words take before anything is typed, and the most they grow to before they scroll. */
const WORDS_LINES = { min: 4, max: 12 } as const;

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
};

/**
 * The words a sheet sends, as a row of the system's own multi-line field on
 * the surface: a few lines tall before anything is typed, growing with its
 * words. The field keeps its own words, as a composer's does, and hands
 * each change to its holder, taking the holder's back only where they moved
 * apart from what was typed.
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
}: WordsFieldProps) {
  const colors = useColors();
  const text = useNativeState(words ?? initialWords);
  const shown = useRef(words ?? initialWords);

  // Note that the field is handed the holder's words only where they moved apart from what was typed, so typing never fights its own echo.
  useEffect(() => {
    if (words === undefined || words === shown.current) return;
    shown.current = words;
    text.set(words);
  }, [words, text]);

  const type = (next: string) => {
    shown.current = next;
    onWords(next);
  };

  return (
    <TextField
      text={text}
      placeholder={placeholder}
      axis="vertical"
      autoFocus={autoFocus}
      onTextChange={type}
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE }),
        lineLimit(WORDS_LINES),
        listRowBackground(colors.RAISED),
        SwiftModifiers.disabled(disabled),
        ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
        ...(label === undefined ? [] : [accessibilityLabel(label)]),
        // Note that turning correction off turns iOS's smart dashes and quotes off with it, so `--skill` stays two hyphens.
        ...(verbatim ? [autocorrectionDisabled(), textInputAutocapitalization("never")] : []),
      ]}
    />
  );
}

/**
 * The skills a `/` typed in a sheet's words offers, as a row under them on
 * the surface, each written into the words on a press, as an agent's
 * composer offers them over its field (`SkillSuggestions`), with what
 * stands in their place where none is offered.
 */
export function SkillRow({
  skills,
  empty,
  onPick,
}: {
  readonly skills: readonly SkillSuggestion[];
  /** What stands where no skill is offered: still reading, none matching, or why none were read. */
  readonly empty: string | undefined;
  readonly onPick: (name: string) => void;
}) {
  const colors = useColors();

  return (
    <HStack modifiers={[listRowBackground(colors.RAISED)]}>
      <SkillSuggestions skills={skills} empty={empty} onPick={onPick} />
    </HStack>
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
 * the muted ink, opening the menu of every option on a press.
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
        <Text key={option.id} modifiers={[tag(option.id)]}>
          {option.label}
        </Text>
      ))}
    </Picker>
  );
}
