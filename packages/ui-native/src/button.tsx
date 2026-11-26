// button.tsx -- the app's buttons, chips, and pills: the system's own buttons, a filled one in the brand's accent and the rest in the ink, and the small capsules a person picks among or reads a task's fields on.

import {
  HStack,
  Image,
  Menu,
  Picker,
  Button as SwiftUIButton,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityElement,
  accessibilityHint,
  accessibilityIdentifier,
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  menuIndicator,
  menuStyle,
  monospacedDigit,
  padding,
  pickerStyle,
  strokeBorder,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { labelFill } from "@repo/features/label-fill";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskPriority, TaskStatus } from "@repo/features/task-wire";
import type { ReactElement, ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { choiceContent, type MenuChoice } from "./list-row.js";
import {
  Avatar,
  type Face,
  TaskPriorityMark,
  TaskStatusMark,
  ToneGlyph,
  UnassignedMark,
} from "./marks.js";
import { Text } from "./text.js";
import { type BrandColors, type StatusTone, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How a button stands: filled for the one act a screen is for, outlined beside it, words alone, or Liquid Glass over content. */
export const BUTTON_LOOK = {
  PROMINENT: "borderedProminent",
  BORDERED: "bordered",
  PLAIN: "borderless",
  GLASS: "glass",
  GLASS_PROMINENT: "glassProminent",
} as const;

export type ButtonLook = (typeof BUTTON_LOOK)[keyof typeof BUTTON_LOOK];

/** How big a button is drawn: a capsule inside a list row, a row's, or a screen's own act. */
export const BUTTON_SIZE = {
  SMALL: "small",
  REGULAR: "regular",
  LARGE: "large",
} as const;

export type ButtonSize = (typeof BUTTON_SIZE)[keyof typeof BUTTON_SIZE];

/** How thick a capsule's edge is drawn: a hairline. */
const HAIRLINE = 0.5;

/** A capsule's inner margins, around its words. */
const CAPSULE_PADDING = { horizontal: 12, vertical: 6 } as const;

type ButtonProps = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  readonly look?: ButtonLook | undefined;
  readonly size?: ButtonSize | undefined;
  /** Whether it spans the width it stands in, as the one or two acts at a sheet's foot do. */
  readonly wide?: boolean | undefined;
  /** Whether the act deletes or undoes something, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/** The looks the system fills with the tint, whose words then stand on the accent. */
const FILLED_LOOKS: ReadonlySet<ButtonLook> = new Set([
  BUTTON_LOOK.PROMINENT,
  BUTTON_LOOK.GLASS_PROMINENT,
]);

/**
 * A button, filled in the accent unless it says otherwise: a primary act is
 * one of the few things drawn in copper, so a bordered or plain one stands
 * in the ink, as the panel's quiet buttons do. Note that a filled button's words
 * stand in the brand's ink on the accent rather than the system's white,
 * since white on the dark theme's lighter copper reads at under 3:1, where
 * the brand's dark ink holds WCAG's 4.5:1.
 */
export function Button(props: ButtonProps) {
  const { label, symbol, look = BUTTON_LOOK.PROMINENT, size = BUTTON_SIZE.REGULAR } = props;
  const colors = useColors();
  const accent = props.destructive !== true;
  const filled = accent && FILLED_LOOKS.has(look);

  return (
    <SwiftUIButton
      {...(props.wide === true
        ? {
            children: (
              <Text modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]}>{label}</Text>
            ),
          }
        : actContent(label, symbol))}
      role={props.destructive === true ? "destructive" : "default"}
      onPress={props.onPress}
      modifiers={[
        buttonStyle(look),
        controlSize(size),
        // Note that a small button stands in a list row as a capsule, as the App Store's Get and Settings' Add do.
        ...(size === BUTTON_SIZE.SMALL ? [SwiftModifiers.buttonBorderShape("capsule")] : []),
        ...(accent ? [tint(filled ? colors.ACCENT : colors.TEXT)] : []),
        ...(filled ? [foregroundStyle(colors.ON_ACCENT)] : []),
        disabledModifier(props.disabled === true),
      ]}
    />
  );
}

/**
 * A small capsule's look: filled with the ink where it stands chosen, and
 * otherwise the surface inside a hairline edge, its words in the row line's style.
 */
function capsuleModifiers(colors: BrandColors, filled: boolean) {
  return [
    padding(CAPSULE_PADDING),
    background(filled ? colors.TEXT : colors.SURFACE, SwiftModifiers.shapes.capsule()),
    ...(filled
      ? []
      : [
          strokeBorder({
            content: colors.CHIP_EDGE,
            // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
            shape: "capsule",
            style: { lineWidth: HAIRLINE },
          }),
        ]),
  ];
}

/**
 * A capsule's words, in the row line's style, medium, in the ink its fill reads in, its count
 * after them in its own ink. Note that the words are the text itself where
 * no count follows; where one does, the package's Text draws the two anew as
 * either changes (`text.tsx`), so a chip never keeps saying Open after a merge.
 */
function CapsuleWords({
  label,
  count,
  ink,
  countInk,
}: {
  readonly label: string;
  readonly count?: number | undefined;
  readonly ink: string;
  readonly countInk: string;
}) {
  const large = useAccessibilitySize();

  const modifiers = [
    font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
    foregroundStyle(ink),
    monospacedDigit(),
    // Note that a capsule's words stand on one line, cut short at their end where the row gives them less than their width, but for an accessibility size, where the capsules stand one to a line and their words wrap rather than cut.
    ...(large ? [] : [lineLimit(1)]),
  ];

  if (count === undefined) return <Text modifiers={modifiers}>{label}</Text>;

  return (
    <Text modifiers={modifiers}>
      <Text>{label}</Text>
      <Text modifiers={[foregroundStyle(countInk)]}>{` ${count}`}</Text>
    </Text>
  );
}

type ChipProps = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  readonly onPress: () => void;
};

/**
 * A small act as the system's own small capsule button, as Mail and the App
 * Store stand an act under a card, bordered in the ink. The system draws its
 * press, its dimming, Button Shapes and Increase Contrast.
 */
export function Chip({ label, symbol, onPress }: ChipProps) {
  const colors = useColors();

  return (
    <SwiftUIButton
      {...actContent(label, symbol, "subheadline")}
      onPress={onPress}
      modifiers={[
        buttonStyle("bordered"),
        SwiftModifiers.buttonBorderShape("capsule"),
        controlSize("small"),
        tint(colors.TEXT),
      ]}
    />
  );
}

/** One scope a `ScopePicker` offers. */
export type Scope = {
  readonly label: string;
  /** How many it lists, where the count is worth reading. */
  readonly count?: number | undefined;
  readonly selected: boolean;
  readonly onPress: () => void;
};

/** How a `ScopePicker` stands: as segments across a screen, or as one menu button where a column is too narrow for segments. */
export const SCOPE_LOOK = {
  SEGMENTED: "segmented",
  MENU: "menu",
} as const;

export type ScopeLook = (typeof SCOPE_LOOK)[keyof typeof SCOPE_LOOK];

/** A scope as its segment names it: its label, and its count after it while it holds anything, as a split view's filter menu leaves out a 0. */
function segmentWords(scope: Scope): string {
  return scope.count === undefined || scope.count === 0
    ? scope.label
    : `${scope.label} ${scope.count}`;
}

/** A list's scopes as a `ScopePicker` or a `RowList` stands them: what the control chooses, heard by VoiceOver, its scopes, and its look. */
export type ListScopes = {
  /** What the control chooses, heard by VoiceOver before the scope chosen and kept off screen, such as "Filter". */
  readonly label: string;
  readonly scopes: readonly Scope[];
  readonly look?: ScopeLook | undefined;
};

/**
 * A list's scopes as the system draws them, in its own glass and its own
 * selection, so they read as iOS's rather than a row of capsules of our
 * own: its segmented control, as Mail and the App Store switch between a
 * list's views, or, in a split view's list column, whose 320 pt cut the
 * segments' words short, its menu picker, one button naming the scope
 * chosen and opening the others.
 */
export function ScopeControl({ label, scopes, look = SCOPE_LOOK.SEGMENTED }: ListScopes) {
  const chosen = scopes.find((scope) => scope.selected);

  return (
    <Picker<string>
      label={label}
      selection={chosen?.label ?? ""}
      onSelectionChange={(label) => scopes.find((scope) => scope.label === label)?.onPress()}
      modifiers={[
        pickerStyle(look),
        labelsHidden(),
        ...(look === SCOPE_LOOK.MENU
          ? [frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]
          : []),
        padding({ horizontal: SPACE.EDGE, top: SPACE.TIGHT, bottom: SPACE.TIGHT * 2 }),
      ]}
    >
      {scopes.map((scope) => (
        <Text key={scope.label} modifiers={[tag(scope.label)]}>
          {segmentWords(scope)}
        </Text>
      ))}
    </Picker>
  );
}

/**
 * A list's scopes standing over what they scope while it lists nothing, so
 * another scope is one tap away from an empty one, or over a form's fields.
 * A list that has rows stands its scopes as its own first row instead
 * (`RowList`'s `scopes`), so they scroll away with the rows, as Mail's
 * categories do, and the rows meet the bar's own edge.
 */
export function ScopePicker({
  children,
  ...control
}: ListScopes & {
  /** What the control scopes: what stands in a list's place while it lists nothing, or a form. */
  readonly children: ReactNode;
}) {
  return (
    <VStack spacing={0}>
      <ScopeControl {...control} />
      {children}
    </VStack>
  );
}

type FieldChipProps = {
  /** What the field says: a status's name, a priority, a person's name. */
  readonly label: string;
  /** A task's status, whose ring leads the chip. */
  readonly status?: TaskStatus | undefined;
  /** A task's priority, whose bars lead the chip. */
  readonly priority?: TaskPriority | undefined;
  /** A person, whose face leads the chip, their picture where one is known. */
  readonly face?: Face | undefined;
  /** Whether it names no one, as an assignee's chip does with no one assigned, led by no one's mark (`UnassignedMark`) where a face would stand. */
  readonly nobody?: boolean | undefined;
  /** A glyph leading the chip where neither does, in the muted ink. */
  readonly symbol?: Glyph | undefined;
  /** A mark leading the chip in its tone where none of the above does, such as a pull request's state. */
  readonly mark?: { readonly glyph: Glyph; readonly tone: StatusTone } | undefined;
  /** What a press offers, the field's other values, where the reader may change it; a chip with none takes no press. */
  readonly menu?: FieldMenu | undefined;
  /** What VoiceOver hears for a chip that takes no press, where its words alone don't say what it is, such as the task an agent starts on and its status; its words otherwise. */
  readonly heard?: string | undefined;
};

/** An act a field's chip's menu offers rather than a value, such as Close pull request on a pull request's state. */
export type FieldAct = {
  readonly label: string;
  readonly symbol: Glyph;
  /** Whether it ends what it acts on, which the system draws red, as Close pull request is. */
  readonly destructive: boolean;
  /** Whether it stands dimmed and takes no press, as every act does while another change is out. */
  readonly disabled: boolean;
  readonly onPress: () => void;
};

/** A field's values as its chip's menu offers them: the field's name, which VoiceOver hears before its value, each value, the one it holds checked, and the acts after them, such as a pull request's changes to where it stands. */
export type FieldMenu = {
  /** The field's name, such as Status, heard before the chip's words. */
  readonly label: string;
  readonly choices: readonly MenuChoice[];
  readonly actions?: readonly FieldAct[] | undefined;
};

/** The mark a field's chip leads with: a status ring, a face, a muted glyph, or none. */
function fieldMark(props: FieldChipProps, colors: BrandColors, glyphSize: number): ReactNode {
  if (props.status !== undefined) return <TaskStatusMark status={props.status} />;

  if (props.priority !== undefined) return <TaskPriorityMark priority={props.priority} />;

  if (props.face !== undefined) {
    return (
      <Avatar
        name={props.face.name}
        id={props.face.id}
        picture={props.face.picture}
        size={MARK_SIZE.FACE}
      />
    );
  }

  if (props.nobody === true) return <UnassignedMark size={MARK_SIZE.FACE} />;

  if (props.symbol !== undefined) {
    return <Image {...glyphImage(props.symbol)} size={glyphSize} color={colors.TEXT_MUTED} />;
  }

  if (props.mark !== undefined) {
    return (
      <ToneGlyph glyph={props.mark.glyph} tone={props.mark.tone} textStyle={TYPE_ROLE.ROW_LINE} />
    );
  }

  return null;
}

/**
 * A task's field read as a small capsule, such as its status, priority, or
 * assignee, heard as its words once, its mark saying the same. Where it
 * carries a menu, it is the system's own small bordered capsule, as `Chip`
 * stands, whose press opens the system's pull-down menu of the field's
 * values, the one it holds checked, as Reminders' and Linear's fields open
 * theirs, and VoiceOver hears the field's name and its value as one label;
 * with none it takes no press, and stands on the surface inside a hairline,
 * since a bordered button reads as pressable.
 */
export function FieldChip(props: FieldChipProps) {
  const colors = useColors();
  const glyphSize = useScaledSize(MARK_SIZE.GLYPH - 2);
  const { menu } = props;

  const words = (
    <HStack spacing={SPACE.TIGHT + 2}>
      {fieldMark(props, colors, glyphSize)}
      <CapsuleWords label={props.label} ink={colors.TEXT_BODY} countInk={colors.TEXT_MUTED} />
    </HStack>
  );

  if (menu === undefined) {
    return (
      <HStack
        modifiers={[
          ...capsuleModifiers(colors, false),
          accessibilityElement("ignore"),
          accessibilityLabel(props.heard ?? props.label),
        ]}
      >
        {words}
      </HStack>
    );
  }

  return <FieldValuesMenu menu={menu} label={props.label} words={words} />;
}

/** What makes a pressable capsule the system's own small bordered capsule, as `Chip` stands, in the ink: its press, dimming, Button Shapes and Increase Contrast the system's. */
function systemCapsule(colors: BrandColors) {
  return [
    buttonStyle("bordered"),
    SwiftModifiers.buttonBorderShape("capsule"),
    controlSize("small"),
    tint(colors.TEXT),
  ];
}

/** A field chip's menu of its values and then its acts, the system's small bordered capsule as its button, heard as the field's name and its value. */
function FieldValuesMenu({
  menu,
  label,
  words,
}: {
  readonly menu: FieldMenu;
  readonly label: string;
  readonly words: ReactElement;
}) {
  const colors = useColors();

  return (
    <Menu
      label={words}
      modifiers={[
        menuStyle("button"),
        menuIndicator("hidden"),
        ...systemCapsule(colors),
        // Note that the field's name and its value are one label, "Status, Todo", because Maestro and Voice Control match a label and never a value.
        accessibilityLabel(`${menu.label}, ${label}`),
      ]}
    >
      {menu.choices.map((choice, at) => (
        <Toggle
          // Note that a choice is keyed by its place, since two members may share a name.
          key={at}
          {...choiceContent(choice, colors)}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
      {(menu.actions ?? []).map((act) => (
        <SwiftUIButton
          key={act.label}
          {...actContent(act.label, act.symbol)}
          onPress={act.onPress}
          modifiers={[disabledModifier(act.disabled)]}
          {...(act.destructive ? { role: "destructive" } : {})}
        />
      ))}
    </Menu>
  );
}

/** A task's status as its chip: the ring and the status's name, opening its menu where it carries one. */
export function StatusChip({
  status,
  menu,
}: {
  readonly status: TaskStatus;
  readonly menu?: FieldMenu | undefined;
}) {
  return <FieldChip label={TASK_STATUS_WORDS[status]} status={status} menu={menu} />;
}

/** A task's priority as a field's chip, its bars leading its name, as the panel's chip draws it. */
export function PriorityChip({
  priority,
  menu,
}: {
  readonly priority: TaskPriority;
  readonly menu?: FieldMenu | undefined;
}) {
  return <FieldChip label={TASK_PRIORITY_WORDS[priority]} priority={priority} menu={menu} />;
}

/**
 * A label filled with its provider's color, as the panel's header draws a
 * pull request's labels: in the light appearance its color solid, edged a
 * shade darker, its words dark or white by how light it reads, and in the
 * dark a tint of it, its words in the color lifted to read
 * (`@repo/features/label-fill`). A color spelled any other way than six hex
 * digits draws the plain chip. It takes no press, and is heard as its name.
 */
export function LabelChip({ name, color }: { readonly name: string; readonly color: string }) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  const inks = labelFill(color);
  const shown = inks === undefined ? undefined : dark ? inks.dark : inks.light;

  return (
    <HStack
      modifiers={[
        ...(shown === undefined
          ? capsuleModifiers(colors, false)
          : [
              padding(CAPSULE_PADDING),
              background(shown.fill, SwiftModifiers.shapes.capsule()),
              strokeBorder({
                content: shown.edge,
                // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
                shape: "capsule",
                style: { lineWidth: HAIRLINE },
              }),
            ]),
        accessibilityElement("ignore"),
        accessibilityLabel(name),
      ]}
    >
      <CapsuleWords
        label={name}
        ink={shown?.words ?? colors.TEXT_BODY}
        countInk={colors.TEXT_MUTED}
      />
    </HStack>
  );
}

/** How far each face of a face pile tucks under the one after it, in points. */
const FACE_OVERLAP = 4;

type FollowingChipProps = {
  /** What it says: Following where the reader follows, Follow where they don't. */
  readonly label: string;
  /** The faces it shows, the earliest first. */
  readonly faces: readonly Face[];
  /** How many more follow than it shows, drawn as +N after the faces; none at 0. */
  readonly more: number;
  /** What a press opens, heard after its words. */
  readonly hint: string;
  /** What VoiceOver hears beside its words, such as who follows. */
  readonly heard: string;
  readonly onPress: () => void;
};

/**
 * Who follows a task as a capsule beside its fields: a face pile, each face
 * overlapping the one before it and a +N count last and on top, then
 * Following or Follow; pressed, it opens who follows. It is the system's
 * own small bordered capsule, as a field's chip with a menu is.
 */
export function FollowingChip({ label, faces, more, hint, heard, onPress }: FollowingChipProps) {
  const colors = useColors();

  const words = (
    <HStack spacing={SPACE.TIGHT + 2}>
      {faces.length === 0 ? null : (
        <HStack spacing={-FACE_OVERLAP}>
          {faces.map((face, at) => (
            <Avatar
              // Note that a face is keyed by its place, since two followers may share a name.
              key={at}
              name={face.name}
              id={face.id}
              picture={face.picture}
              size={MARK_SIZE.FACE}
            />
          ))}
          {more === 0 ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.TIME, weight: "medium" }),
                monospacedDigit(),
                foregroundStyle(colors.TEXT_MUTED),
                padding({ leading: FACE_OVERLAP + 2 }),
              ]}
            >
              {`+${more}`}
            </Text>
          )}
        </HStack>
      )}
      <CapsuleWords label={label} ink={colors.TEXT_BODY} countInk={colors.TEXT_MUTED} />
    </HStack>
  );

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        ...systemCapsule(colors),
        accessibilityLabel(label),
        accessibilityValue(heard),
        accessibilityHint(hint),
        accessibilityIdentifier("following-chip"),
      ]}
    >
      {words}
    </SwiftUIButton>
  );
}
