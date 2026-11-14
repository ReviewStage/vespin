// option-rows.tsx -- the rows an agent's options sheet holds beside its pickers: a switch, and the system's alert a rename is typed in.

import {
  Alert,
  Host,
  Button as SwiftUIButton,
  Text,
  TextField,
  Toggle,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect } from "react";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What every alert's way out says, and its role, as the system's own alerts draw it. */
const CANCEL = { LABEL: "Cancel", ROLE: "cancel" } as const;

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

type RenameAskProps = {
  /** The alert's title: "Rename agent". */
  readonly title: string;
  /** The act that takes the name: "Rename". */
  readonly act: string;
  /** The name as it stands, which the field opens holding. */
  readonly name: string;
  /** What the field says while it is empty. */
  readonly placeholder: string;
  readonly presented: boolean;
  /** Called with the name typed once the act is pressed. */
  readonly onRename: (name: string) => void;
  readonly onDismiss: () => void;
};

/**
 * A rename, as the system's alert asks for a name: the field holding the
 * name as it stands, Cancel, and the act, as Files and Notes rename a folder.
 * It stands in a host of its own, the size of nothing, so a screen draws it
 * beside whatever it shows and presents it from a press anywhere, as
 * `ConfirmAsk` does.
 */
export function RenameAsk({
  title,
  act,
  name,
  placeholder,
  presented,
  onRename,
  onDismiss,
}: RenameAskProps) {
  const text = useNativeState(name);
  // Each time it is presented, the field holds the name as it then stands.
  useEffect(() => {
    if (presented) text.set(name);
  }, [presented, name, text]);

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <Alert
        title={title}
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <Alert.Trigger>
          <Text modifiers={[frame({ width: 0, height: 0 })]}>{""}</Text>
        </Alert.Trigger>
        <Alert.Actions>
          <TextField
            text={text}
            placeholder={placeholder}
            modifiers={[accessibilityIdentifier("rename-field")]}
          />
          <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={onDismiss} />
          <SwiftUIButton label={act} onPress={() => onRename(text.get().trim())} />
        </Alert.Actions>
      </Alert>
    </Host>
  );
}
