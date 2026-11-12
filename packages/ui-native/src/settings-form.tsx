// settings-form.tsx -- the app's Settings as SwiftUI's own Form: its sections' rows on the brand's surface over the sidebar's ground, an account's face and address, a value, a switch, a row that goes to a page or out of the app, a choice among a few, an act, a note such as a memory, a row whose press opens a menu of acts, and a connection such as an integration.

import {
  ContextMenu,
  Form,
  HStack,
  Image,
  LabeledContent,
  Menu,
  Spacer,
  Button as SwiftUIButton,
  SwipeActions,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityIdentifier,
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  listRowBackground,
  scrollContentBackground,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactElement, ReactNode } from "react";
import { useScaledSize } from "./accessibility.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { Avatar } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { type SwitcherWorkspace, WorkspaceTile } from "./workspace-switcher.js";

/** An account's face in its row, larger than a list's. */
const ACCOUNT_FACE_SIZE = 36;

/** Where a `PushRow` goes, and the mark at its end that says so, where iOS's own Settings marks them, in the panel's glyphs. */
export const PUSH_ROW_GOES = {
  /** A page of Settings, pushed over this one: the panel's chevron. */
  PAGE: GLYPH.FOLDED,
  /** Out of the app, to Safari or iOS's own Settings: the panel's arrow out. */
  OUT: GLYPH.OPEN_EXTERNALLY,
} as const satisfies Record<string, Glyph>;

export type PushRowGoes = (typeof PUSH_ROW_GOES)[keyof typeof PUSH_ROW_GOES];

/** The size of the glyph leading a `MenuRow`, as a list's leading mark stands. */
const GLYPH_SIZE = 15;

/** The size of the mark at a `PushRow`'s end, as small as iOS draws its chevron. */
const GOES_MARK_SIZE = 13;

/** The mark at a row's end that says where a press goes, in the muted ink. */
function GoesMark({ goes }: { readonly goes: PushRowGoes }) {
  const colors = useColors();

  return <Image {...glyphImage(goes)} size={GOES_MARK_SIZE} color={colors.TEXT_MUTED} />;
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

type HeadRowProps = {
  /** What leads the row: a person's face or a workspace's tile, at the head's size. */
  readonly face: ReactNode;
  readonly name: string;
  /** The line under the name, such as an account's address or a workspace's role. */
  readonly line: string;
  /** A quiet line under that, such as how the account signed in. */
  readonly detail?: string | undefined;
  /** Where a press goes; a row with none takes no press. */
  readonly onPress?: (() => void) | undefined;
};

/** A page's head: its face, its name, its lines, and the chevron where a press goes on, as the account heads iOS's own Settings. */
function HeadRow({ face, name, line, detail, onPress }: HeadRowProps) {
  const colors = useColors();

  const drawn = (
    <HStack
      spacing={SPACE.ROW + 2}
      modifiers={[
        listRowBackground(colors.SURFACE),
        SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
      ]}
    >
      {face}
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
          {line}
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
    drawn
  ) : (
    <PressedRow label={name} value={[line, detail]} onPress={onPress}>
      {drawn}
    </PressedRow>
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
  return (
    <HeadRow
      face={<Avatar name={name} picture={picture} size={ACCOUNT_FACE_SIZE} />}
      name={name}
      line={email}
      detail={detail}
      onPress={onPress}
    />
  );
}

/**
 * A workspace heading its own page: its tile, as the switcher draws it (its
 * photo, its owner's picture, or its letter on its hue, on a softened square,
 * since a square says a team as a circle says a person), its name, and what
 * the reader is in it.
 */
export function WorkspaceRow({
  workspace,
  role,
}: {
  readonly workspace: SwitcherWorkspace;
  /** The reader's role in it, in the panel's words. */
  readonly role: string;
}) {
  return (
    <HeadRow
      face={<WorkspaceTile workspace={workspace} size={ACCOUNT_FACE_SIZE} />}
      name={workspace.name}
      line={role}
    />
  );
}

type PushRowProps = {
  readonly label: string;
  /** The glyph before the words, in the muted ink. */
  readonly symbol?: Glyph | undefined;
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
      <HStack
        spacing={SPACE.ROW}
        modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}
      >
        {symbol === undefined ? null : (
          <Image {...glyphImage(symbol)} size={GOES_MARK_SIZE + 4} color={colors.TEXT_MUTED} />
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

/**
 * A code to hold against another screen, such as the one a machine shows
 * while it pairs: in the monospaced face at a heading's size, VoiceOver
 * hearing it letter by letter so each can be checked.
 */
export function CodeRow({ code, testId }: { readonly code: string; readonly testId?: string }) {
  const colors = useColors();
  const spelled = [...code].filter((letter) => letter !== "-").join(" ");

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.PAGE_HEADING, design: "monospaced", weight: "semibold" }),
        foregroundStyle(colors.TEXT),
        listRowBackground(colors.SURFACE),
        accessibilityLabel(spelled),
        ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
      ]}
    >
      {code}
    </Text>
  );
}

type ActionRowProps = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  /** Whether the act ends something, such as Sign out, which the system draws red. */
  readonly destructive?: boolean | undefined;
  /** Whether it takes no press, such as while another act on the page is out. */
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/** A row a person presses to act, in the accent, or the system's red where it ends something. */
export function ActionRow({
  label,
  symbol,
  destructive = false,
  disabled: off = false,
  onPress,
}: ActionRowProps) {
  const colors = useColors();

  return (
    <SwiftUIButton
      {...actContent(label, symbol)}
      role={destructive ? "destructive" : "default"}
      onPress={onPress}
      modifiers={[listRowBackground(colors.SURFACE), disabled(off)]}
    />
  );
}

/** One of the few things a `PickRows` picks among. */
export type PickOption = { readonly id: string; readonly label: string };

type PickRowsProps = {
  readonly options: readonly PickOption[];
  readonly picked: string | undefined;
  readonly onPick: (id: string) => void;
};

/** The picked row's check, as iOS's own Settings draws it at a row's end. */
const PICKED_MARK = GLYPH.CHECK;

/** The check's size, as small and heavy as the system's own. */
const PICKED_MARK_SIZE = 15;

/**
 * A choice among a few, each a row of its own with the picked one checked
 * in copper, as iOS's own Settings checks a choice. Note that the rows are
 * drawn here rather than by SwiftUI's inline picker, because its check takes
 * the form's tint, which stands in the ink, and neither a tint on the picker
 * nor one on a group around it reached the check. VoiceOver hears each row
 * as a button by its words, the picked one selected, under the section's
 * title.
 */
export function PickRows({ options, picked, onPick }: PickRowsProps) {
  const colors = useColors();
  const markSize = useScaledSize(PICKED_MARK_SIZE);

  // Note that the rows stand in a fragment, each its own row of the form, because a group around them made one element of them all, which neither VoiceOver nor a flow could pick from.
  return (
    <>
      {options.map((option) => (
        <SwiftUIButton
          key={option.id}
          onPress={() => onPick(option.id)}
          modifiers={[
            buttonStyle("plain"),
            accessibilityLabel(option.label),
            ...(option.id === picked ? [accessibilityAddTraits(["isSelected"])] : []),
            listRowBackground(colors.SURFACE),
          ]}
        >
          <HStack modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}>
            <Text modifiers={[foregroundStyle(colors.TEXT)]}>{option.label}</Text>
            <Spacer />
            {option.id === picked ? (
              <Image
                {...glyphImage(PICKED_MARK)}
                size={markSize}
                color={colors.ACCENT}
                modifiers={[font({ size: markSize, weight: "semibold" })]}
              />
            ) : null}
          </HStack>
        </SwiftUIButton>
      ))}
    </>
  );
}

/** One thing a row's menu does, such as a member's Remove from workspace or a port's Share. */
export interface MenuRowAct {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  /** Whether it takes something away, such as Remove from workspace, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
}

/** One thing a member's menu does to them. */
export type MemberRowAct = MenuRowAct;

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
      <RowActs acts={acts} />
    </Menu>
  );
}

/** A row menu's acts, each the system's button, red where it takes something away. */
function RowActs({ acts }: { readonly acts: readonly MenuRowAct[] }) {
  return acts.map((act) => (
    <SwiftUIButton
      key={act.label}
      {...actContent(act.label, act.symbol)}
      role={act.destructive === true ? "destructive" : "default"}
      onPress={act.onPress}
    />
  ));
}

type MenuRowProps = {
  readonly label: string;
  /** The glyph leading it, in the muted ink. */
  readonly symbol: Glyph;
  /** The line under its name in the muted ink, such as what serves a port; none for none. */
  readonly detail?: string | undefined;
  /** What stands at its end in the muted ink, such as Sharing; none for none. */
  readonly value?: string | undefined;
  /** What a press offers; a row with none takes no press. */
  readonly acts: readonly MenuRowAct[];
};

/**
 * A thing a sheet lists, such as one of an agent's ports: its glyph, its
 * name with a line under it, and a value at its end, each but the name in
 * the muted ink. Where it offers anything, a press opens the system's menu
 * of what it offers, as `MemberRow`'s does; VoiceOver hears it by its name,
 * then its line and its value.
 */
export function MenuRow({ label, symbol, detail, value, acts }: MenuRowProps) {
  const colors = useColors();
  const glyphSize = useScaledSize(GLYPH_SIZE);

  const face = (
    <HStack spacing={SPACE.ROW}>
      <Image {...glyphImage(symbol)} size={glyphSize} color={colors.TEXT_MUTED} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[foregroundStyle(colors.TEXT)]}>{label}</Text>
        {detail === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {detail}
          </Text>
        )}
      </VStack>
      <Spacer />
      {value === undefined ? null : (
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{value}</Text>
      )}
    </HStack>
  );

  const heard = [accessibilityLabel(label), ...spokenValue(detail, value)];

  if (acts.length === 0) {
    return <VStack modifiers={[listRowBackground(colors.SURFACE), ...heard]}>{face}</VStack>;
  }

  return (
    <Menu label={face} modifiers={[listRowBackground(colors.SURFACE), ...heard]}>
      <RowActs acts={acts} />
    </Menu>
  );
}

/** The act that takes a note away, as the system draws one: its glyph, and its role, in red. */
const NOTE_REMOVE = { SYMBOL: GLYPH.DELETE, ROLE: "destructive" } as const;

/** The glyph of the act that opens a note's words to be changed, as Notes' Edit draws it. */
const NOTE_EDIT_SYMBOL = GLYPH.RENAME;

/** One act of a note's: its words and what a press does. */
type NoteAct = { readonly label: string; readonly onPress: () => void };

type NoteRowProps = {
  /** The glyph before the words, in the muted ink, such as a machine's kind. */
  readonly symbol?: Glyph | undefined;
  /** The note's own words, such as a memory's, drawn whole however many lines they take. */
  readonly words: string;
  /** What it is, under its words in the body's ink, such as a skill's description. */
  readonly detail?: string | undefined;
  /** A quiet line under them, such as who kept it and when. */
  readonly line: string;
  /** Where a press goes, such as a skill's file, the chevron at its end; a row with none takes no press. */
  readonly onPress?: (() => void) | undefined;
  /** The act that opens its words to be changed, such as Edit, on a press of the row where it goes nowhere else, and first in the menu a long press opens; none where the reader may not. */
  readonly edit?: NoteAct | undefined;
  /** The act that takes it away, such as Delete, behind a swipe from the trailing edge and in the menu a long press opens; none where the reader may not. */
  readonly remove?: NoteAct | undefined;
};

/**
 * A note of Settings, such as a memory, a machine, or a skill: its glyph
 * where it has one, its words whole in the ink, what it is under them where
 * it says, and the chevron where a press opens it, then a
 * quiet line of whose they are. Where the reader may, a press that goes
 * nowhere else opens its words to be changed, as a note in Notes opens, and
 * the act that takes it away stands behind a swipe from the trailing edge,
 * as Notes' rows carry Delete; a long press opens a menu of both, Edit
 * first. Note that a full swipe never runs Delete, since it asks first.
 * VoiceOver hears the row as one element, its words then its line, and
 * offers its acts among its actions.
 */
export function NoteRow({ symbol, words, detail, line, onPress, edit, remove }: NoteRowProps) {
  const colors = useColors();

  const lines = (
    <VStack alignment="leading" spacing={SPACE.TIGHT}>
      <Text modifiers={[foregroundStyle(colors.TEXT)]}>{words}</Text>
      {detail === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {detail}
        </Text>
      )}
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
      >
        {line}
      </Text>
    </VStack>
  );

  const content = (
    <HStack
      spacing={SPACE.ROW}
      modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}
    >
      {symbol === undefined ? null : (
        <Image {...glyphImage(symbol)} size={GOES_MARK_SIZE + 4} color={colors.TEXT_MUTED} />
      )}
      {lines}
      <Spacer />
      {onPress === undefined ? null : <GoesMark goes={PUSH_ROW_GOES.PAGE} />}
    </HStack>
  );

  // Note that a row a press takes somewhere, or opens to be changed, is the system's plain button, its words keeping their own ink, as `PressedRow` draws one.
  const pressed = onPress ?? edit?.onPress;

  const drawn =
    pressed === undefined ? (
      content
    ) : (
      <SwiftUIButton onPress={pressed} modifiers={[buttonStyle("plain")]}>
        {content}
      </SwiftUIButton>
    );

  const placed = [
    listRowBackground(colors.SURFACE),
    accessibilityElement("combine"),
    accessibilityLabel(words),
    accessibilityValue(detail === undefined ? line : `${detail}, ${line}`),
  ];

  if (edit === undefined && remove === undefined) {
    return <HStack modifiers={placed}>{drawn}</HStack>;
  }

  const removeAct =
    remove === undefined ? undefined : (
      <SwiftUIButton
        {...actContent(remove.label, NOTE_REMOVE.SYMBOL)}
        role={NOTE_REMOVE.ROLE}
        onPress={remove.onPress}
      />
    );

  const menu = (
    <ContextMenu>
      <ContextMenu.Items>
        {edit === undefined ? null : (
          <SwiftUIButton {...actContent(edit.label, NOTE_EDIT_SYMBOL)} onPress={edit.onPress} />
        )}
        {removeAct}
      </ContextMenu.Items>
      <ContextMenu.Trigger>{drawn}</ContextMenu.Trigger>
    </ContextMenu>
  );

  if (removeAct === undefined) return <HStack modifiers={placed}>{menu}</HStack>;

  return (
    <SwipeActions modifiers={placed}>
      {menu}
      <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
        {removeAct}
      </SwipeActions.Actions>
    </SwipeActions>
  );
}

/** A line under a connection's name: its words, and whether they say something went wrong, drawn in danger's ink. */
export interface ConnectionLine {
  readonly text: string;
  readonly problem?: boolean | undefined;
}

type ConnectionRowProps = {
  /** The connection's name, such as "Notion · Acme". */
  readonly name: string;
  /** Its lines under the name: where it stands, what it is for, or why it did not go. */
  readonly lines: readonly ConnectionLine[];
  /** The one act it offers at its end, such as Connect or Cancel, as a bordered button; none where it offers none there. */
  readonly act?:
    | {
        readonly label: string;
        /** Whether it takes no press now, such as while the last one is out. */
        readonly disabled?: boolean | undefined;
        readonly onPress: () => void;
      }
    | undefined;
  /** The rest of what it offers, in the menu a long press opens, a destructive one also behind a swipe from the trailing edge. */
  readonly menu?: readonly MemberRowAct[] | undefined;
};

/**
 * A connection of the account's, such as an integration or an app given
 * access: its name in the ink, its lines in the muted ink or a problem's in
 * danger's, and its one act at its end as the system's bordered button, in
 * the ink as a quiet act stands; the rest in the menu a long press opens, and
 * a destructive one, such as Disconnect, behind a swipe too, which a full
 * swipe never runs, since it asks first.
 */
export function ConnectionRow({ name, lines, act, menu = [] }: ConnectionRowProps) {
  const colors = useColors();
  const said = lines.map((line) => line.text).join(", ");

  const drawn = (
    <HStack
      spacing={SPACE.ROW}
      modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}
    >
      <VStack alignment="leading" spacing={SPACE.TIGHT}>
        <Text modifiers={[foregroundStyle(colors.TEXT)]}>{name}</Text>
        {lines.map((line) => (
          <Text
            key={line.text}
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(line.problem === true ? colors.DANGER_TEXT : colors.TEXT_MUTED),
            ]}
          >
            {line.text}
          </Text>
        ))}
      </VStack>
      <Spacer />
      {act === undefined ? null : (
        <Button
          label={act.label}
          look={BUTTON_LOOK.BORDERED}
          disabled={act.disabled}
          onPress={act.onPress}
        />
      )}
    </HStack>
  );

  const placed = [listRowBackground(colors.SURFACE), ...spokenValue(said)];

  if (menu.length === 0) return <HStack modifiers={placed}>{drawn}</HStack>;

  const items = menu.map((each) => (
    <SwiftUIButton
      key={each.label}
      label={each.label}
      role={each.destructive === true ? "destructive" : "default"}
      onPress={each.onPress}
    />
  ));

  const swiped = menu.filter((each) => each.destructive === true);

  const held = (
    <ContextMenu>
      <ContextMenu.Items>{items}</ContextMenu.Items>
      <ContextMenu.Trigger>{drawn}</ContextMenu.Trigger>
    </ContextMenu>
  );

  if (swiped.length === 0) return <HStack modifiers={placed}>{held}</HStack>;

  return (
    <SwipeActions modifiers={placed}>
      {held}
      <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
        {swiped.map((each) => (
          <SwiftUIButton
            key={each.label}
            label={each.label}
            role={NOTE_REMOVE.ROLE}
            onPress={each.onPress}
          />
        ))}
      </SwipeActions.Actions>
    </SwipeActions>
  );
}
