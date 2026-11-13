// button.tsx -- the app's buttons, chips, and pills: the system's own buttons, a filled one in the brand's accent and the rest in the ink, and the small capsules a person picks among or reads a task's fields on.

import {
  HStack,
  Image,
  Menu,
  Picker,
  Button as SwiftUIButton,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHint,
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
  monospacedDigit,
  padding,
  pickerStyle,
  strokeBorder,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import { Fragment, type ReactNode } from "react";
import { type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import type { MenuChoice } from "./list-row.js";
import { Avatar, type Face, TaskStatusMark, ToneGlyph } from "./marks.js";
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

/** How big a button is drawn: a row's, or a screen's own act. */
export const BUTTON_SIZE = {
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
      {...actContent(label, symbol)}
      role={props.destructive === true ? "destructive" : "default"}
      onPress={props.onPress}
      modifiers={[
        buttonStyle(look),
        controlSize(size),
        ...(accent ? [tint(filled ? colors.ACCENT : colors.TEXT)] : []),
        ...(filled ? [foregroundStyle(colors.ON_ACCENT)] : []),
        disabledModifier(props.disabled === true),
      ]}
    />
  );
}

/**
 * A small capsule's look: filled with the ink where it stands chosen, and
 * otherwise the surface inside a hairline edge, its words 13 pt.
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
 * A capsule's words, 13 pt medium in the ink its fill reads in, its count
 * after them in its own ink. Note that the words are the text itself where
 * no count follows, and the joined text is drawn anew whenever its words or
 * count change, because `@expo/ui`'s native text joins the texts nested in
 * it as it draws and is never told one of them changed, so it would keep
 * saying what they first said, such as Open after a merge.
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
  const modifiers = [
    font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
    foregroundStyle(ink),
    monospacedDigit(),
  ];

  if (count === undefined) return <Text modifiers={modifiers}>{label}</Text>;

  return (
    <Fragment key={label}>
      <Text key={count} modifiers={modifiers}>
        <Text>{label}</Text>
        <Text modifiers={[foregroundStyle(countInk)]}>{` ${count}`}</Text>
      </Text>
    </Fragment>
  );
}

type ChipProps = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  /** How many it holds, drawn after its words, such as a scope's count. */
  readonly count?: number | undefined;
  /** Whether the chip stands chosen, which fills it with the ink. */
  readonly selected?: boolean | undefined;
  /** What a press does, heard after the chip's words where they leave it unsaid, such as a picture's × taking it off a message. */
  readonly hint?: string | undefined;
  readonly onPress: () => void;
};

/**
 * A small act or choice as the system's own small capsule button, as Mail
 * and the App Store stand an act under a card: bordered in the ink, and
 * filled with the ink once chosen, as a selection reads without the accent.
 * The system draws its press, its dimming, Button Shapes and Increase
 * Contrast. VoiceOver hears the chosen one as selected, since its fill
 * alone says so on screen.
 */
export function Chip({ label, symbol, count, selected = false, hint, onPress }: ChipProps) {
  const colors = useColors();

  return (
    <SwiftUIButton
      {...actContent(count === undefined ? label : `${label} ${count}`, symbol, "subheadline")}
      onPress={onPress}
      modifiers={[
        buttonStyle(selected ? "borderedProminent" : "bordered"),
        SwiftModifiers.buttonBorderShape("capsule"),
        controlSize("small"),
        tint(colors.TEXT),
        ...(selected ? [foregroundStyle(colors.GROUND)] : []),
        ...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
        ...(hint === undefined ? [] : [accessibilityHint(hint)]),
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

/** A scope as its segment names it: its label, and its count after it where it has one. */
function segmentWords(scope: Scope): string {
  return scope.count === undefined ? scope.label : `${scope.label} ${scope.count}`;
}

/**
 * A list's scopes as the system's segmented control under the screen's
 * title, as Mail and the App Store switch between a list's views, over the
 * list they scope. It stands over the list rather than in it, so it stays
 * when the scope chosen lists nothing. Note that the system draws it, in
 * its own glass and its own selection, so it reads as iOS's rather than a
 * row of capsules of our own. In a split view's list column, whose 320 pt
 * cut the segments' words short, it stands as the system's menu picker
 * instead: one button naming the scope chosen, opening the others.
 */
export function ScopePicker({
  label,
  scopes,
  look = SCOPE_LOOK.SEGMENTED,
  children,
}: {
  /** What the control chooses, heard by VoiceOver before the scope chosen and kept off screen, such as "Filter". */
  readonly label: string;
  readonly scopes: readonly Scope[];
  readonly look?: ScopeLook | undefined;
  /** The list the control scopes, or what stands in its place while it lists nothing. */
  readonly children: ReactNode;
}) {
  const chosen = scopes.find((scope) => scope.selected);

  return (
    <VStack spacing={0}>
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
      {children}
    </VStack>
  );
}

type FieldChipProps = {
  /** What the field says: a status's name, a priority, a person's name. */
  readonly label: string;
  /** A task's status, whose ring leads the chip. */
  readonly status?: TaskStatus | undefined;
  /** A person, whose face leads the chip, their picture where one is known. */
  readonly face?: Face | undefined;
  /** A glyph leading the chip where neither does, in the muted ink. */
  readonly symbol?: Glyph | undefined;
  /** A mark leading the chip in its tone where none of the above does, such as a pull request's state. */
  readonly mark?: { readonly glyph: Glyph; readonly tone: StatusTone } | undefined;
  /** What a press offers, the field's other values, where the reader may change it; a chip with none takes no press. */
  readonly menu?: FieldMenu | undefined;
};

/** A field's values as its chip's menu offers them: the field's name, which VoiceOver hears before its value, and each value, the one it holds checked. */
export type FieldMenu = {
  /** The field's name, such as Status, heard before the chip's words. */
  readonly label: string;
  readonly choices: readonly MenuChoice[];
};

/** The mark a field's chip leads with: a status ring, a face, a muted glyph, or none. */
function fieldMark(props: FieldChipProps, colors: BrandColors): ReactNode {
  if (props.status !== undefined) return <TaskStatusMark status={props.status} />;

  if (props.face !== undefined) {
    return <Avatar name={props.face.name} picture={props.face.picture} size={MARK_SIZE.FACE} />;
  }

  if (props.symbol !== undefined) {
    return (
      <Image {...glyphImage(props.symbol)} size={MARK_SIZE.GLYPH - 2} color={colors.TEXT_MUTED} />
    );
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
 * assignee: on the surface inside a hairline, and heard as its words once,
 * its mark saying the same. Where it carries a menu, a press opens the
 * system's pull-down menu of the field's values over it, the one it holds
 * checked, as Reminders' and Linear's fields open theirs, and VoiceOver
 * hears the field's name, then its value; with none it takes no press.
 */
export function FieldChip(props: FieldChipProps) {
  const colors = useColors();
  const { menu } = props;

  const capsule = (
    <HStack
      spacing={SPACE.TIGHT + 2}
      modifiers={[
        ...capsuleModifiers(colors, false),
        ...(menu === undefined
          ? [accessibilityElement("ignore"), accessibilityLabel(props.label)]
          : []),
      ]}
    >
      {fieldMark(props, colors)}
      <CapsuleWords label={props.label} ink={colors.TEXT_BODY} countInk={colors.TEXT_MUTED} />
    </HStack>
  );

  if (menu === undefined) return capsule;

  return (
    <Menu
      label={capsule}
      modifiers={[
        // Note that a borderless menu takes only its own press, since a list row holding the system's buttons hands any press on it to all of them.
        buttonStyle("borderless"),
        accessibilityLabel(menu.label),
        accessibilityValue(props.label),
      ]}
    >
      {menu.choices.map((choice) => (
        <Toggle
          key={choice.label}
          {...actContent(choice.label, choice.symbol)}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
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
 * Following or Follow; pressed, it opens who follows. It stands as the
 * fields' chips do, on the surface inside a hairline, but takes a press, as
 * the system's borderless button over it.
 */
export function FollowingChip({ label, faces, more, hint, heard, onPress }: FollowingChipProps) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityLabel(label),
        accessibilityValue(heard),
        accessibilityHint(hint),
      ]}
    >
      <HStack spacing={SPACE.TIGHT + 2} modifiers={capsuleModifiers(colors, false)}>
        {faces.length === 0 ? null : (
          <HStack spacing={-FACE_OVERLAP}>
            {faces.map((face, at) => (
              <Avatar
                // Note that a face is keyed by its place, since two followers may share a name.
                key={at}
                name={face.name}
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
    </SwiftUIButton>
  );
}
