// settings-form.tsx -- the app's Settings as SwiftUI's own Form: its sections' rows on the brand's surface over the sidebar's ground, an account's face and address, a value, a choice among a few, and an act.

import {
  Form,
  HStack,
  LabeledContent,
  Picker,
  Button as SwiftUIButton,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  font,
  foregroundStyle,
  labelsHidden,
  listRowBackground,
  pickerStyle,
  scrollContentBackground,
  scrollDismissesKeyboard,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { Avatar } from "./marks.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** An account's face in its row, larger than a list's. */
const ACCOUNT_FACE_SIZE = 36;

/**
 * The form a settings screen is: its sections (`ListSection`) of the rows
 * below, under their small muted headers, every row's words in the denser
 * scale's 15 pt. Note that it stands on the sidebar's ground with each row
 * on the surface, as the panel's settings cards stand on its page, rather
 * than on the system's grouped grays. A drag on it lowers the keyboard at
 * once, as a composing sheet's words otherwise keep it standing over the
 * rows below them, with no key of the keyboard's own that lowers it.
 */
export function SettingsForm({ children }: { readonly children: ReactNode }) {
  const colors = useColors();
  return (
    <Form
      modifiers={[
        scrollContentBackground("hidden"),
        scrollDismissesKeyboard("immediately"),
        background(colors.SIDEBAR),
        tint(colors.ACCENT),
        font({ textStyle: TYPE_ROLE.ROW_TITLE }),
      ]}
    >
      {children}
    </Form>
  );
}

type AccountRowProps = {
  readonly name: string;
  readonly email: string;
  /** The account's sign-in picture, drawn in place of its letters where it has one. */
  readonly picture?: string | undefined;
  /** A quiet line under the address, such as how the account signed in. */
  readonly detail?: string | undefined;
};

/** Who is signed in: their photo or monogram, their name, their address, and how they signed in. */
export function AccountRow({ name, email, picture, detail }: AccountRowProps) {
  const colors = useColors();
  return (
    <HStack spacing={SPACE.ROW + 2} modifiers={[listRowBackground(colors.SURFACE)]}>
      <Avatar name={name} picture={picture} size={ACCOUNT_FACE_SIZE} />
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
            foregroundStyle(colors.TEXT),
          ]}
        >
          {name}
        </Text>
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {email}
        </Text>
        {detail === undefined ? null : (
          <Text
            modifiers={[font({ textStyle: TYPE_ROLE.TIME }), foregroundStyle(colors.TEXT_MUTED)]}
          >
            {detail}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/** A setting's name and where it stands, as the system lays a value out beside its label. */
export function ValueRow({ label, value }: { readonly label: string; readonly value: string }) {
  const colors = useColors();
  return (
    <LabeledContent label={label} modifiers={[listRowBackground(colors.SURFACE)]}>
      <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{value}</Text>
    </LabeledContent>
  );
}

type ActionRowProps = {
  readonly label: string;
  readonly symbol?: SfSymbol | undefined;
  /** Whether the act ends something, such as Sign out, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
};

/** A row a person presses to act, in the accent, or the system's red where it ends something. */
export function ActionRow({ label, symbol, destructive = false, onPress }: ActionRowProps) {
  const colors = useColors();
  return (
    <SwiftUIButton
      label={label}
      {...(symbol === undefined ? {} : { systemImage: symbol })}
      role={destructive ? "destructive" : "default"}
      onPress={onPress}
      modifiers={[listRowBackground(colors.SURFACE)]}
    />
  );
}

/** One of the few things a `PickRows` picks among. */
export type PickOption = { readonly id: string; readonly label: string };

type PickRowsProps = {
  /** What is picked, for VoiceOver; the section's title heads it on screen. */
  readonly label: string;
  readonly options: readonly PickOption[];
  readonly picked: string | undefined;
  readonly onPick: (id: string) => void;
};

/** A choice among a few, each a row of its own with the picked one checked, as SwiftUI's inline picker draws it. */
export function PickRows({ label, options, picked, onPick }: PickRowsProps) {
  const colors = useColors();
  return (
    <Picker<string | null>
      label={label}
      selection={picked ?? null}
      onSelectionChange={(id) => {
        if (id !== null) onPick(id);
      }}
      modifiers={[pickerStyle("inline"), labelsHidden(), listRowBackground(colors.SURFACE)]}
    >
      {options.map((option) => (
        <Text key={option.id} modifiers={[tag(option.id), foregroundStyle(colors.TEXT)]}>
          {option.label}
        </Text>
      ))}
    </Picker>
  );
}
