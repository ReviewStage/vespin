// settings-form.tsx -- the app's Settings as SwiftUI's own Form: its sections' rows on the brand's surface over the sidebar's ground, an account's face and address, a value, a switch, a row that goes to a page or out of the app, a choice among a few, and an act.

import {
  Form,
  HStack,
  Image,
  LabeledContent,
  Menu,
  Picker,
  Spacer,
  Button as SwiftUIButton,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  labelsHidden,
  listRowBackground,
  pickerStyle,
  scrollContentBackground,
  scrollDismissesKeyboard,
  shapes,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactElement, ReactNode } from "react";
import { Avatar } from "./marks.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** An account's face in its row, larger than a list's. */
const ACCOUNT_FACE_SIZE = 36;

/** Where a `PushRow` goes, and the mark at its end that says so, as iOS's own Settings marks them. */
export const PUSH_ROW_GOES = {
  /** A page of Settings, pushed over this one: the system's chevron. */
  PAGE: "chevron.right",
  /** Out of the app, to Safari or iOS's own Settings: the arrow out. */
  OUT: "arrow.up.right",
} as const satisfies Record<string, SfSymbol>;

export type PushRowGoes = (typeof PUSH_ROW_GOES)[keyof typeof PUSH_ROW_GOES];

/** The size of the mark at a `PushRow`'s end, as small as iOS draws its chevron. */
const GOES_MARK_SIZE = 13;

/** The mark at a row's end that says where a press goes, in the muted ink. */
function GoesMark({ goes }: { readonly goes: PushRowGoes }) {
  const colors = useColors();
  return <Image systemName={goes} size={GOES_MARK_SIZE} color={colors.TEXT_MUTED} />;
}

/** The row's other words, joined as VoiceOver reads a value after its label; none where there are none. */
function spokenValue(...parts: readonly (string | undefined)[]) {
  const said = parts.filter((part) => part !== undefined && part.length > 0).join(", ");
  return said.length === 0 ? [] : [accessibilityValue(said)];
}

/**
 * A row's content made one press, as a Form's navigation row is: the whole
 * row takes the press, its words keep their own ink rather than the tint a
 * button lends, and VoiceOver hears it by its name, then its other words as
 * its value, so a flow still finds it by the name alone. Note that the
 * whole row takes the press only because each row's own stack carries the
 * rectangle as its content shape: a plain button answers only where its label
 * draws, and a shape set on the button itself does not widen that, so the
 * blank run between a row's words and its chevron took no tap.
 */
function PressedRow({
  label,
  value,
  onPress,
  children,
  testId,
}: {
  readonly label: string;
  /** The row's other words, read after its name. */
  readonly value?: readonly (string | undefined)[] | undefined;
  readonly onPress: () => void;
  readonly children: ReactElement;
  readonly testId?: string | undefined;
}) {
  const colors = useColors();
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(label),
        ...spokenValue(...(value ?? [])),
        listRowBackground(colors.SURFACE),
        ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
      ]}
    >
      {children}
    </SwiftUIButton>
  );
}

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
        tint(colors.TEXT),
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
  /** Where a press goes, such as the Account page from Settings' head; a row with none takes no press. */
  readonly onPress?: (() => void) | undefined;
};

/**
 * Who is signed in: their photo or monogram, their name, their address, and
 * how they signed in. Pressed, it goes to its page, the chevron at its end,
 * as the account heads iOS's own Settings.
 */
export function AccountRow({ name, email, picture, detail, onPress }: AccountRowProps) {
  const colors = useColors();
  const face = (
    <HStack
      spacing={SPACE.ROW + 2}
      modifiers={[listRowBackground(colors.SURFACE), contentShape(shapes.rectangle())]}
    >
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
      {onPress === undefined ? null : (
        <>
          <Spacer />
          <GoesMark goes={PUSH_ROW_GOES.PAGE} />
        </>
      )}
    </HStack>
  );
  return onPress === undefined ? (
    face
  ) : (
    <PressedRow label={name} value={[email, detail]} onPress={onPress}>
      {face}
    </PressedRow>
  );
}

type PushRowProps = {
  readonly label: string;
  /** The glyph before the words, an SF Symbol in the muted ink. */
  readonly symbol?: SfSymbol | undefined;
  /** Where the row stands, at its end before the mark, such as a page's current choice. */
  readonly detail?: string | undefined;
  readonly goes: PushRowGoes;
  readonly onPress: () => void;
  /** The name a flow finds the row by, where its words are not its own, such as a workspace named for its owner. */
  readonly testId?: string | undefined;
};

/**
 * A row a press takes somewhere: a page of Settings, with the chevron at its
 * end, or out of the app, with the arrow out, its words in the ink and what
 * stands at its end in the muted ink.
 */
export function PushRow({ label, symbol, detail, goes, onPress, testId }: PushRowProps) {
  const colors = useColors();
  return (
    <PressedRow label={label} value={[detail]} onPress={onPress} testId={testId}>
      <HStack spacing={SPACE.ROW} modifiers={[contentShape(shapes.rectangle())]}>
        {symbol === undefined ? null : (
          <Image systemName={symbol} size={GOES_MARK_SIZE + 4} color={colors.TEXT_MUTED} />
        )}
        <Text modifiers={[foregroundStyle(colors.TEXT)]}>{label}</Text>
        <Spacer />
        {detail === undefined ? null : (
          <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{detail}</Text>
        )}
        <GoesMark goes={goes} />
      </HStack>
    </PressedRow>
  );
}

type ToggleRowProps = {
  readonly label: string;
  /** A quiet line under the label, saying what the switch does. */
  readonly detail?: string | undefined;
  readonly on: boolean;
  /** Whether it cannot be turned now, such as while the setting is unread. */
  readonly disabled?: boolean | undefined;
  readonly onChange: (on: boolean) => void;
};

/** A setting turned on or off, as the system's switch, in the brand's copper, with what it does under its name. */
export function ToggleRow({ label, detail, on, disabled: off = false, onChange }: ToggleRowProps) {
  const colors = useColors();
  return (
    <Toggle
      isOn={on}
      onIsOnChange={onChange}
      modifiers={[tint(colors.ACCENT), disabled(off), listRowBackground(colors.SURFACE)]}
    >
      <Text modifiers={[foregroundStyle(colors.TEXT)]}>{label}</Text>
      {detail === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {detail}
        </Text>
      )}
    </Toggle>
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
      modifiers={[
        pickerStyle("inline"),
        labelsHidden(),
        tint(colors.ACCENT),
        listRowBackground(colors.SURFACE),
      ]}
    >
      {options.map((option) => (
        <Text key={option.id} modifiers={[tag(option.id), foregroundStyle(colors.TEXT)]}>
          {option.label}
        </Text>
      ))}
    </Picker>
  );
}

/** One thing a member's menu does to them. */
export interface MemberRowAct {
  readonly label: string;
  /** Whether it takes them out of something, such as Remove from workspace, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
}

type MemberRowProps = {
  readonly name: string;
  readonly email: string;
  readonly picture?: string | undefined;
  /** Their role, in the words the panel says it: Owner, Admin, Member; none for an address invited, whose line says it. */
  readonly role?: string | undefined;
  /** The badge beside the reader's own name, such as "You"; none on anyone else's row. */
  readonly badge?: string | undefined;
  /** What the reader may do to them; a row with none takes no press. */
  readonly acts: readonly MemberRowAct[];
};

/**
 * A member of a workspace: their photo or letters, their name with the
 * reader's own badge, their address, and their role at the end in the muted
 * ink. Where the reader may act on them, a press opens the system's menu of
 * those acts, as a contact's row opens one.
 */
export function MemberRow({ name, email, picture, role, badge, acts }: MemberRowProps) {
  const colors = useColors();
  const face = (
    <HStack spacing={SPACE.ROW}>
      <Avatar name={name} picture={picture} size={ACCOUNT_FACE_SIZE - 8} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[foregroundStyle(colors.TEXT)]}>
          {badge === undefined ? name : `${name} · ${badge}`}
        </Text>
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {email}
        </Text>
      </VStack>
      <Spacer />
      {role === undefined ? null : (
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{role}</Text>
      )}
    </HStack>
  );
  if (acts.length === 0) {
    return <VStack modifiers={[listRowBackground(colors.SURFACE)]}>{face}</VStack>;
  }
  return (
    <Menu
      label={face}
      modifiers={[
        listRowBackground(colors.SURFACE),
        accessibilityLabel(badge === undefined ? name : `${name}, ${badge}`),
        ...spokenValue(email, role),
      ]}
    >
      {acts.map((act) => (
        <SwiftUIButton
          key={act.label}
          label={act.label}
          role={act.destructive === true ? "destructive" : "default"}
          onPress={act.onPress}
        />
      ))}
    </Menu>
  );
}
