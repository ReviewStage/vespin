// option-rows.tsx -- the rows an agent's options sheet holds beside its pickers: a switch.

import { Text, Toggle } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  listRowBackground,
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
