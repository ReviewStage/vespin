// option-rows.tsx -- the rows an agent's options sheet holds beside its pickers: a switch and a choice among a few with what each does under its name.

import { Picker, Text, Toggle, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  labelsHidden,
  listRowBackground,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

type SwitchRowProps = {
  readonly label: string;
  /** A muted line under the label, where the switch needs one, such as the account a server is. */
  readonly detail?: string | undefined;
  readonly on: boolean;
  readonly onSwitch: (on: boolean) => void;
  /** The name a flow finds the switch by. */
  readonly testId?: string | undefined;
};

/** A setting that is on or off, as the system's switch in a Form's row, tinted with the brand's copper. */
export function SwitchRow({ label, detail, on, onSwitch, testId }: SwitchRowProps) {
  const colors = useColors();

  return (
    <Toggle
      isOn={on}
      onIsOnChange={onSwitch}
      modifiers={[
        tint(colors.ACCENT),
        listRowBackground(colors.RAISED),
        ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
      ]}
    >
      <Text modifiers={[foregroundStyle(colors.TEXT)]}>{label}</Text>
      {detail === undefined ? null : (
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE })]}>{detail}</Text>
      )}
    </Toggle>
  );
}

/** One of the few things a `HintPickRows` picks among, with what it does. */
export type HintOption = { readonly id: string; readonly label: string; readonly hint: string };

type HintPickRowsProps = {
  /** What is picked, for VoiceOver; the section's title heads it on screen. */
  readonly label: string;
  readonly options: readonly HintOption[];
  readonly picked: string | undefined;
  readonly onPick: (id: string) => void;
};

/**
 * A choice among a few, each a row of its own with what it does in the muted
 * ink under its name and the picked one checked, as SwiftUI's inline picker
 * draws it: a running agent's permission modes, as the panel's menu offers
 * them with their hints.
 */
export function HintPickRows({ label, options, picked, onPick }: HintPickRowsProps) {
  const colors = useColors();

  return (
    <Picker<string | null>
      label={label}
      selection={picked ?? null}
      onSelectionChange={(id) => {
        if (id !== null) onPick(id);
      }}
      modifiers={[pickerStyle("inline"), labelsHidden(), listRowBackground(colors.RAISED)]}
    >
      {options.map((option) => (
        <VStack key={option.id} alignment="leading" spacing={2} modifiers={[tag(option.id)]}>
          <Text modifiers={[foregroundStyle(colors.TEXT)]}>{option.label}</Text>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {option.hint}
          </Text>
        </VStack>
      ))}
    </Picker>
  );
}
