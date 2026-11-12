// form-rows.tsx -- the rows a composing sheet's Form holds: the words to send, the pictures attached to them, and a choice among many in the system's menu picker.

import { Button, HStack, Image, Picker, Text, TextField, useNativeState } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  font,
  frame,
  lineLimit,
  listRowBackground,
  pickerStyle,
  shapes,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { type AttachedPicture, AttachedPictures } from "./composer-head.js";
import { dropPictures, HOVER_EFFECT, hoverEffect } from "./interactions.js";
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
  /** Whether the keyboard rises on it as the sheet opens. */
  readonly autoFocus?: boolean | undefined;
  /** The name a flow finds the field by. */
  readonly testId?: string | undefined;
};

/**
 * The words a sheet sends, as a row of the system's own multi-line field on
 * the surface: a few lines tall before anything is typed, growing with its
 * words. The field keeps its own words, as a composer's does, and hands
 * each change to its holder.
 */
export function WordsField({
  placeholder,
  onWords,
  initialWords = "",
  autoFocus = false,
  testId,
}: WordsFieldProps) {
  const colors = useColors();
  const text = useNativeState(initialWords);

  return (
    <TextField
      text={text}
      placeholder={placeholder}
      axis="vertical"
      autoFocus={autoFocus}
      onTextChange={onWords}
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE }),
        lineLimit(WORDS_LINES),
        listRowBackground(colors.SURFACE),
        ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
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
        listRowBackground(colors.SURFACE),
        ...(onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]),
      ]}
    >
      <Button
        onPress={onAdd}
        modifiers={[
          buttonStyle("plain"),
          hoverEffect(HOVER_EFFECT.HIGHLIGHT),
          accessibilityLabel("Add picture"),
          ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
        ]}
      >
        <Image
          systemName="plus"
          size={MARK_SIZE.LEAD + 2}
          color={colors.TEXT_MUTED}
          modifiers={
            pictures.length === 0
              ? [
                  frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
                  contentShape(shapes.rectangle()),
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
      modifiers={[pickerStyle("menu"), tint(colors.TEXT_MUTED), listRowBackground(colors.SURFACE)]}
    >
      {options.map((option) => (
        <Text key={option.id} modifiers={[tag(option.id)]}>
          {option.label}
        </Text>
      ))}
    </Picker>
  );
}
