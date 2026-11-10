// form-rows.tsx -- the rows a composing sheet's Form holds: the words to send, and a choice among many in the system's menu picker.

import { Picker, Text, TextField, useNativeState } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  font,
  lineLimit,
  listRowBackground,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { PickOption } from "./settings-form.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How many lines the words take before anything is typed, and the most they grow to before they scroll. */
const WORDS_LINES = { min: 4, max: 12 } as const;

type WordsFieldProps = {
  /** What the field says before anything is typed: "Describe the task". */
  readonly placeholder: string;
  /** Called with the words as they are typed. */
  readonly onWords: (words: string) => void;
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
export function WordsField({ placeholder, onWords, autoFocus = false, testId }: WordsFieldProps) {
  const colors = useColors();
  const text = useNativeState("");
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
