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
  accessibilityLabel,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  type ModifierConfig,
  menuIndicator,
  padding,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ModelProvider } from "@repo/features/models-wire";
import type { ReactNode } from "react";
import { useScaledSize } from "./accessibility.js";
import type { ComposerMenu } from "./composer.js";
import {
  type AttachedPicture,
  AttachedPictures,
  type SkillSuggestion,
  SkillSuggestions,
} from "./composer-head.js";
import { WORDS_LOOK, WordsField } from "./form-rows.js";
import { DockRow, GlassDock, useDockRoom } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropPictures } from "./interactions.js";
import { choiceColor, type MenuChoice } from "./list-row.js";
import { HarnessMark } from "./marks.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How far apart the capsules in the dock's row stand, as the glass buttons over Notes' keyboard stand apart. */
const CHIP_SPACING = SPACE.TIGHT * 2;

/** What the sheet's + is heard as. */
const ADD_LABEL = "Add";

/**
 * Where a capsule menu stands: in a compose sheet's dock over the keyboard,
 * as the system's own glass button, one layer, as Notes' and Reminders'
 * controls over the keyboard stand; or on the page among the words, such as
 * the task a new one is related to, as the system's small bordered capsule,
 * since glass is for the controls over content, never the content itself.
 */
export const MENU_CHIP_LOOK = {
  DOCK: "dock",
  PAGE: "page",
} as const;

export type MenuChipLook = (typeof MENU_CHIP_LOOK)[keyof typeof MENU_CHIP_LOOK];

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

/** What leads a capsule's words: the panel's glyph for what it picks, or, for a model, the mark of the harness its agent runs in, as the panel's model chip leads with it. */
type ChipLead =
  | { readonly symbol?: Glyph | undefined; readonly harness?: undefined }
  | { readonly harness: ModelProvider; readonly symbol?: undefined };

type MenuChipProps = ChipLead & {
  /** What is picked, as the capsule says it: a repository, a model and its effort, where an agent runs. */
  readonly label: string;
  /** The name a flow finds the capsule by. */
  readonly testId?: string | undefined;
} & (
    | {
        readonly look: typeof MENU_CHIP_LOOK.DOCK;
        /** What the capsule opens; none where what it says can't be changed here, such as a sub-task's repository, which its tree holds, drawn as the system draws a control it holds still. */
        readonly menu?: ChipMenu | undefined;
      }
    | { readonly look?: typeof MENU_CHIP_LOOK.PAGE | undefined; readonly menu: ChipMenu }
  );

/** The capsule's words, what leads them before them, in the capsule's small type. */
function ChipLabel({ label, symbol, harness }: ChipLead & { readonly label: string }) {
  const markSize = useScaledSize(MARK_SIZE.FACE);
  const type = font({ textStyle: TYPE_ROLE.ROW_TITLE });
  const words = <Text modifiers={[type, lineLimit(1)]}>{label}</Text>;

  if (harness !== undefined) {
    return (
      <HStack spacing={SPACE.TIGHT + 2}>
        <HarnessMark harness={harness} size={markSize} />
        {words}
      </HStack>
    );
  }

  if (symbol === undefined) return words;

  return (
    <HStack spacing={SPACE.TIGHT + 2}>
      <Image {...glyphImage(symbol)} modifiers={[type]} />
      {words}
    </HStack>
  );
}

/** The system's button style a capsule stands in, by where it stands: its own glass over the keyboard, a bordered capsule on the page. */
function chipStyle(look: MenuChipLook): readonly ModifierConfig[] {
  return look === MENU_CHIP_LOOK.DOCK
    ? [buttonStyle("glass"), SwiftModifiers.buttonBorderShape("capsule"), controlSize("large")]
    : [buttonStyle("bordered"), SwiftModifiers.buttonBorderShape("capsule"), controlSize("small")];
}

/**
 * A choice among many as one of the system's capsules, opening its menu on
 * a press, as Mail's and Notes' compose stand one: it says what is picked,
 * after the panel's glyph for it (or a model's harness mark), with the
 * system's chevron after it, and its menu checks the one on in each group,
 * under the group's heading, then its acts and the menus within it. In the
 * dock it is the system's glass button, one layer with no bar around it; on
 * the page, the small bordered capsule. Drawn in the ink, never the accent.
 */
export function MenuChip(props: MenuChipProps) {
  const colors = useColors();
  const { label, menu, testId } = props;
  const look = props.look ?? MENU_CHIP_LOOK.PAGE;
  const content = <ChipLabel label={label} {...leadOf(props)} />;
  const found = testId === undefined ? [] : [accessibilityIdentifier(testId)];

  // Note that a capsule that can't be changed here stands as the same glass button held still, so the row's capsules keep one height and one look.
  if (menu === undefined) {
    return (
      <SwiftUIButton
        onPress={() => undefined}
        modifiers={[...chipStyle(look), tint(colors.TEXT), disabled(true), ...found]}
      >
        {content}
      </SwiftUIButton>
    );
  }

  const actions = menu.actions ?? [];

  return (
    <Menu
      label={content}
      modifiers={[...chipStyle(look), menuIndicator("visible"), tint(colors.TEXT), ...found]}
    >
      {menu.groups.map((group, at) => (
        // Note that a group is keyed by its place, since a group may have no heading.
        <Section key={at} {...(group.title === undefined ? {} : { title: group.title })}>
          {group.choices.map((choice) => (
            <Toggle
              key={choice.label}
              {...actContent(choice.label, choice.symbol, undefined, choiceColor(choice, colors))}
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

/** What leads a capsule's words, as its props name it. */
function leadOf(props: ChipLead): ChipLead {
  return props.harness === undefined ? { symbol: props.symbol } : { harness: props.harness };
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

/** The sheet's page: the line over the words, what heads them, the words, the skills a `/` offers, the pictures attached, and the notes, clear of the bar at its foot, taking a drop of pictures. */
function ComposePage(props: ComposeSheetProps) {
  const colors = useColors();
  const room = useDockRoom();
  const { title, head, words, skills, pictures, onDetach, notes, onDropPictures } = props;
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
            // Note that the page takes a drop of pictures as the bar does, so one dropped on the words or the pictures attached is attached too.
            ...(onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]),
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
 * The sheet's +, as the system's round glass button over the keyboard, as
 * Messages' + stands: one act, such as attaching a picture, or the system's
 * menu of what it adds (Photos, then a relation to another task), its acts,
 * the menus within it, then its switches.
 */
function ComposeAddPress({ add }: { readonly add: ComposeAdd }) {
  const colors = useColors();

  const style = [
    buttonStyle("glass"),
    SwiftModifiers.buttonBorderShape("circle"),
    controlSize("large"),
    tint(colors.TEXT),
    accessibilityLabel(ADD_LABEL),
    accessibilityIdentifier(add.testId),
  ];

  const glyph = <Image {...glyphImage(GLYPH.ADD)} />;
  const { menu } = add;

  if (menu === undefined) {
    return add.onAdd === undefined ? null : (
      <SwiftUIButton onPress={add.onAdd} modifiers={style}>
        {glyph}
      </SwiftUIButton>
    );
  }

  const submenus = menu.submenus ?? [];
  const switches = menu.switches ?? [];

  return (
    <Menu label={glyph} modifiers={[...style, menuIndicator("hidden")]}>
      {menu.actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          {...actContent(action.label, action.symbol)}
          onPress={action.onPress}
        />
      ))}
      {menu.actions.length === 0 || (submenus.length === 0 && switches.length === 0) ? null : (
        <Divider />
      )}
      {submenus.map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
      {switches.map((each) => (
        <Toggle
          key={each.label}
          label={each.label}
          isOn={each.on}
          onIsOnChange={() => each.onPress()}
        />
      ))}
    </Menu>
  );
}

/**
 * A sheet that starts work, as Mail's and Messages' compose stand: the
 * words fill the page on the sheet's own ground, with no card around them,
 * under the line naming who suggested them and what heads them, such as
 * the task the new one is related to; the skills a `/` offers, the pictures
 * attached and what a start said follow them. Pinned above the keyboard,
 * with no bar around them, stand the + and, after it, a row of capsule
 * menus (`MenuChip` in its dock look) saying where and how the work starts,
 * each the system's own glass button, as Notes' and Reminders' controls
 * over the keyboard stand; the row scrolls sideways where it outruns the
 * window. The sheet's own bar holds Cancel and Start.
 */
export function ComposeSheet(props: ComposeSheetProps) {
  const { add, chips, onDropPictures } = props;

  return (
    <GlassDock
      bar={
        <DockRow modifiers={onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]}>
          <ComposeAddPress add={add} />
          <ScrollView axes="horizontal" showsIndicators={false}>
            {/* Note that the row stands in a little from the scroller's top and foot, so each capsule's glass draws whole rather than cut by the scroller's edge. */}
            <HStack
              spacing={CHIP_SPACING}
              modifiers={[padding({ vertical: SPACE.TIGHT, trailing: SPACE.ROW })]}
            >
              {chips}
            </HStack>
          </ScrollView>
        </DockRow>
      }
    >
      <ComposePage {...props} />
    </GlassDock>
  );
}
