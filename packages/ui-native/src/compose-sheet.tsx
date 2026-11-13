// compose-sheet.tsx -- a sheet that starts work, as Mail's compose stands one: its words filling the page under what they start in, and the + with a row of capsule menus pinned above the keyboard.

import {
  Divider,
  Host,
  HStack,
  Image,
  Menu,
  ScrollView,
  Section,
  Button as SwiftUIButton,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityIdentifier,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  menuIndicator,
  padding,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { AddPress, type ComposerMenu } from "./composer.js";
import {
  type AttachedPicture,
  AttachedPictures,
  type SkillSuggestion,
  SkillSuggestions,
} from "./composer-head.js";
import { WORDS_LOOK, WordsField } from "./form-rows.js";
import { GlassBar, GlassDock, useDockRoom } from "./glass-bar.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropPictures } from "./interactions.js";
import type { MenuChoice } from "./list-row.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How far apart the capsules in the bar's row stand. */
const CHIP_SPACING = SPACE.TIGHT * 2;

/** One group of a capsule menu's choices, one of which is on, under its own heading, such as a model's or its effort's. */
export type ChipMenuGroup = {
  readonly title?: string | undefined;
  readonly choices: readonly MenuChoice[];
};

/** What a capsule menu opens: its groups of choices, each checked as the system checks one, then its acts and the menus within it. */
export type ChipMenu = {
  readonly groups: readonly ChipMenuGroup[];
  readonly actions?: BarMenu["actions"] | undefined;
  readonly submenus?: readonly BarMenu[] | undefined;
};

type MenuChipProps = {
  /** What is picked, as the capsule says it: a repository, a model and its effort, where an agent runs. */
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  readonly menu: ChipMenu;
  /** The name a flow finds the capsule by. */
  readonly testId?: string | undefined;
};

/** The capsule's words, its glyph before them where it has one, in the capsule's small type. */
function chipLabel(label: string, symbol: Glyph | undefined): ReactNode {
  const words = (
    <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), lineLimit(1)]}>{label}</Text>
  );

  if (symbol === undefined) return words;

  return (
    <HStack spacing={SPACE.TIGHT + 2}>
      <Image {...glyphImage(symbol)} modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE })]} />
      {words}
    </HStack>
  );
}

/**
 * A choice among many as the system's small bordered capsule, opening its
 * menu on a press, as Mail's and Notes' compose bars stand one: it says
 * what is picked, with the system's chevron after it, and its menu checks
 * the one on in each group, under the group's heading, then its acts and
 * the menus within it. Drawn in the ink, never the accent, as a bordered
 * button is.
 */
export function MenuChip({ label, symbol, menu, testId }: MenuChipProps) {
  const colors = useColors();
  const actions = menu.actions ?? [];

  return (
    <Menu
      label={chipLabel(label, symbol)}
      modifiers={[
        buttonStyle("bordered"),
        SwiftModifiers.buttonBorderShape("capsule"),
        controlSize("small"),
        menuIndicator("visible"),
        tint(colors.TEXT),
        ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
      ]}
    >
      {menu.groups.map((group, at) => (
        // Note that a group is keyed by its place, since a group may have no heading.
        <Section key={at} {...(group.title === undefined ? {} : { title: group.title })}>
          {group.choices.map((choice) => (
            <Toggle
              key={choice.label}
              {...actContent(choice.label, choice.symbol)}
              isOn={choice.on}
              onIsOnChange={() => choice.onPress()}
            />
          ))}
        </Section>
      ))}
      {actions.length === 0 ? null : <Divider />}
      {actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          {...actContent(action.label, action.symbol)}
          onPress={action.onPress}
          modifiers={[disabled(action.disabled === true)]}
          {...(action.destructive === true ? { role: "destructive" } : {})}
        />
      ))}
      {(menu.submenus ?? []).map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
    </Menu>
  );
}

/** The words a compose sheet sends, as its holder keeps them. */
export type ComposeWords = {
  /** What the page says before anything is typed: "Describe the task". */
  readonly placeholder: string;
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** The name a flow finds the field by. */
  readonly testId: string;
};

/** What the sheet's + adds: a menu of what it offers, or its one act, such as a picture, and the name a flow finds it by. */
export type ComposeAdd = {
  readonly menu?: ComposerMenu | undefined;
  readonly onAdd?: (() => void) | undefined;
  readonly testId: string;
};

type ComposeSheetProps = {
  /** The line over the words, such as who suggested them; none for a draft of the member's own. */
  readonly title?: string | undefined;
  /** What stands over the words, such as the task the new one is related to, as capsules. */
  readonly head?: ReactNode;
  readonly words: ComposeWords;
  /** The skills a `/` being typed offers; none while no `/` word ends the words. */
  readonly skills?:
    | {
        readonly skills: readonly SkillSuggestion[];
        readonly empty: string | undefined;
        readonly onPick: (name: string) => void;
      }
    | undefined;
  readonly pictures: readonly AttachedPicture[];
  readonly onDetach: (id: string) => void;
  /** Called with the file addresses of pictures dropped on the sheet, on an iPad; it takes no drop where none is given. */
  readonly onDropPictures?: ((uris: readonly string[], unreadable: number) => void) | undefined;
  /** What a start, the picker, or a read said, each its own line under the words. */
  readonly notes: readonly string[];
  readonly add: ComposeAdd;
  /** The capsules in the bar's row after the +, such as Repository, Model · Effort, and Runs on. */
  readonly chips: ReactNode;
};

/** The sheet's page: the line over the words, what heads them, the words, the skills a `/` offers, the pictures attached, and the notes, clear of the bar at its foot. */
function ComposePage(props: ComposeSheetProps) {
  const colors = useColors();
  const room = useDockRoom();
  const { title, head, words, skills, pictures, onDetach, notes } = props;
  const muted = [font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)];

  return (
    <Host style={{ flex: 1, backgroundColor: colors.GROUPED }} modifiers={[tint(colors.TEXT)]}>
      <ScrollView modifiers={[scrollDismissesKeyboard("immediately")]}>
        <VStack
          alignment="leading"
          spacing={SPACE.ROW}
          modifiers={[
            frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
            padding({ horizontal: SPACE.EDGE, top: SPACE.ROW, bottom: room + SPACE.ROW }),
          ]}
        >
          {title === undefined ? null : <Text modifiers={muted}>{title}</Text>}
          {head}
          <WordsField
            placeholder={words.placeholder}
            words={words.words}
            onWords={words.onWords}
            autoFocus
            testId={words.testId}
            look={WORDS_LOOK.PAGE}
          />
          {skills === undefined ? null : (
            <SkillSuggestions skills={skills.skills} empty={skills.empty} onPick={skills.onPick} />
          )}
          <AttachedPictures pictures={pictures} onDetach={onDetach} />
          {notes.map((note) => (
            <Text key={note} modifiers={muted}>
              {note}
            </Text>
          ))}
        </VStack>
      </ScrollView>
    </Host>
  );
}

/**
 * A sheet that starts work, as Mail's and Messages' compose stand: the
 * words fill the page on the sheet's own ground, with no card around them,
 * under the line naming who suggested them and what heads them, such as
 * the task the new one is related to; the skills a `/` offers, the pictures
 * attached and what a start said follow them. Pinned above the keyboard, a
 * bar of glass holds the + and, after it, a row of capsule menus
 * (`MenuChip`) saying where and how the work starts, which scrolls sideways
 * where it outruns the bar. The sheet's own bar holds Cancel and Start.
 */
export function ComposeSheet(props: ComposeSheetProps) {
  const { add, chips, onDropPictures } = props;

  return (
    <GlassDock
      bar={
        <GlassBar modifiers={onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]}>
          <AddPress menu={add.menu} onAdd={add.onAdd} testId={add.testId} />
          <ScrollView axes="horizontal" showsIndicators={false}>
            <HStack spacing={CHIP_SPACING} modifiers={[padding({ trailing: SPACE.ROW })]}>
              {chips}
            </HStack>
          </ScrollView>
        </GlassBar>
      }
    >
      <ComposePage {...props} />
    </GlassDock>
  );
}
