// start-page.tsx -- a page that starts work, as Messages, ChatGPT and Claude start a conversation: an empty page with what the start is about at its head, and the agent page's composer on the keyboard, the + and the capsules saying where and how the work starts in a row under its field.

import {
  Divider,
  Host,
  HStack,
  Image,
  Menu,
  Picker,
  ScrollView,
  Section,
  Button as SwiftUIButton,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityIdentifier,
  accessibilityRemoveTraits,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  type ModifierConfig,
  menuIndicator,
  padding,
  pickerStyle,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ModelProvider } from "@repo/features/models-wire";
import type { ReactNode } from "react";
import { useAnnounced, useScaledSize } from "./accessibility.js";
import { COMPOSER_CALL } from "./call.js";
import { Composer, type ComposerDictation, type ComposerMenu } from "./composer.js";
import {
  type AttachedPicture,
  AttachedPictures,
  type SkillSuggestion,
  SkillSuggestions,
} from "./composer-head.js";
import { GlassDock } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent, PickOption } from "./glyph-label.js";
import { choiceColor, type MenuChoice } from "./list-row.js";
import { HarnessMark, RepositoryPicture } from "./marks.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/**
 * Where a capsule menu stands: in a composer's row under its field, where
 * a start says where and how it runs, as the system's small capsule with no
 * glass of its own, since the composer's glass is the one layer there; or
 * on the page, such as the task a new one is related to, as the system's
 * small bordered capsule.
 */
export const MENU_CHIP_LOOK = {
  COMPOSER: "composer",
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

/** What leads a capsule's words: the panel's glyph for what it picks; for a model, the mark of the harness its agent runs in, as the panel's model chip leads with it; or, for a repository, its owner's picture, as the panel's repository chip leads with it. */
type ChipLead =
  | {
      readonly symbol?: Glyph | undefined;
      readonly harness?: undefined;
      readonly repository?: undefined;
    }
  | {
      readonly harness: ModelProvider;
      readonly symbol?: undefined;
      readonly repository?: undefined;
    }
  | { readonly repository: string; readonly symbol?: undefined; readonly harness?: undefined };

type MenuChipProps = ChipLead & {
  /** What is picked, as the capsule says it: a repository, a model and its effort, where an agent runs. */
  readonly label: string;
  /** The name a flow finds the capsule by. */
  readonly testId?: string | undefined;
} & (
    | {
        readonly look: typeof MENU_CHIP_LOOK.COMPOSER;
        /** What the capsule opens; none where what it says can't be changed here, such as a sub-task's repository, which its tree holds, drawn as the system draws a control it holds still. */
        readonly menu?: ChipMenu | undefined;
        readonly onOpen?: undefined;
      }
    | {
        readonly look: typeof MENU_CHIP_LOOK.COMPOSER;
        /** Opens what the capsule picks in, such as a sheet of the models, on a tap, in place of a menu. */
        readonly onOpen: () => void;
        readonly menu?: undefined;
      }
    | {
        readonly look?: typeof MENU_CHIP_LOOK.PAGE | undefined;
        readonly menu: ChipMenu;
        readonly onOpen?: undefined;
      }
  );

/** The capsule's words, what leads them before them, in the capsule's small type. */
function ChipLabel({ label, symbol, harness, repository }: ChipLead & { readonly label: string }) {
  const markSize = useScaledSize(MARK_SIZE.FACE);
  const type = font({ textStyle: TYPE_ROLE.ROW_TITLE });
  const words = <Text modifiers={[type, lineLimit(1)]}>{label}</Text>;

  if (repository !== undefined) {
    return (
      <HStack spacing={SPACE.TIGHT + 2}>
        <RepositoryPicture repository={repository} size={markSize} />
        {words}
      </HStack>
    );
  }

  if (harness !== undefined) {
    return (
      <HStack spacing={SPACE.TIGHT + 2}>
        <HarnessMark provider={harness} size={markSize} />
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

/** The system's button style a capsule stands in, by where it stands: a plain capsule on the composer's glass, a bordered capsule on the page. */
function chipStyle(look: MenuChipLook): readonly ModifierConfig[] {
  return look === MENU_CHIP_LOOK.COMPOSER
    ? [buttonStyle("borderless"), controlSize("small")]
    : [buttonStyle("bordered"), SwiftModifiers.buttonBorderShape("capsule"), controlSize("small")];
}

/**
 * A choice among many as one of the system's capsules, opening its menu on
 * a press, as Mail's and Notes' compose stand one: it says what is picked,
 * after the panel's glyph for it (or a model's harness mark, or a
 * repository's owner's picture), with the
 * system's chevron after it, and its menu checks the one on in each group,
 * under the group's heading, then its acts and the menus within it. In a
 * composer's row it stands plain on the composer's glass; on the page, as
 * the small bordered capsule. One that picks in a sheet of its own, such as
 * the models', opens it on a tap (`onOpen`) rather than a menu. Drawn in
 * the ink, never the accent.
 */
export function MenuChip(props: MenuChipProps) {
  const colors = useColors();
  const { label, menu, testId } = props;
  const look = props.look ?? MENU_CHIP_LOOK.PAGE;
  const content = <ChipLabel label={label} {...leadOf(props)} />;
  const found = testId === undefined ? [] : [accessibilityIdentifier(testId)];

  // Note that a capsule that opens a sheet of its own stands as the same capsule, its up-and-down chevron after its words as a menu's stands.
  if (props.onOpen !== undefined) {
    return (
      <SwiftUIButton
        onPress={props.onOpen}
        modifiers={[...chipStyle(look), tint(colors.TEXT), ...found]}
      >
        <HStack spacing={SPACE.TIGHT}>
          {content}
          <Image
            {...glyphImage(GLYPH.MENU_OPENS)}
            modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE })]}
          />
        </HStack>
      </SwiftUIButton>
    );
  }

  // Note that a capsule that can't be changed here stands as the same glass button held still, so the row's capsules keep one height and one look, and is heard as words rather than a button, as the field it reads is.
  if (menu === undefined) {
    return (
      <SwiftUIButton
        onPress={() => undefined}
        modifiers={[
          ...chipStyle(look),
          tint(colors.TEXT),
          disabled(true),
          accessibilityRemoveTraits(["isButton"]),
          accessibilityAddTraits(["isStaticText"]),
          ...found,
        ]}
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
          <GroupPicker group={group} />
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

/**
 * A capsule menu's group as SwiftUI's own single choice: an inline picker,
 * its options standing in the menu with the one chosen checked, as the
 * system checks it, its label left to the group's section. Note that each
 * option is tagged by its place in the group, never its label or id, so two
 * choices of one name, such as two Macs both called MacBook Pro, stay two;
 * and that a pick of the option already chosen sends nothing, as the
 * system's picker answers only a change.
 */
function GroupPicker({ group }: { readonly group: ChipMenuGroup }) {
  const colors = useColors();
  const chosen = group.choices.findIndex((choice) => choice.on);

  return (
    <Picker
      label={group.title ?? ""}
      {...(chosen === -1 ? {} : { selection: String(chosen) })}
      onSelectionChange={(value: string) => group.choices[Number(value)]?.onPress()}
      modifiers={[pickerStyle("inline"), labelsHidden()]}
    >
      {group.choices.map((choice, at) => (
        <PickOption
          // Note that an option is keyed by its place, as it is tagged, since two may share a name.
          key={at}
          label={choice.label}
          value={String(at)}
          glyph={choice.symbol}
          color={choiceColor(choice, colors)}
          photo={choice.photo}
        />
      ))}
    </Picker>
  );
}

/** What leads a capsule's words, as its props name it. */
function leadOf(props: ChipLead): ChipLead {
  if (props.repository !== undefined) return { repository: props.repository };

  return props.harness === undefined ? { symbol: props.symbol } : { harness: props.harness };
}

/** The words a start sends, as its holder keeps them. */
export type StartWords = {
  /** What the field says before anything is typed: "Describe the task". */
  readonly placeholder: string;
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** Takes words pasted long enough to come as a file, answering whether it did; they paste as words where none is given. */
  readonly onLongPaste?: ((words: string) => boolean) | undefined;
};

/** What the composer's + adds: a menu of what it offers, or its one act, such as a picture. */
export type StartAdd = {
  readonly menu?: ComposerMenu | undefined;
  readonly onAdd?: (() => void) | undefined;
};

type StartPageProps = {
  /** The line at the page's head, such as who suggested the words; none for a draft of the member's own. */
  readonly title?: string | undefined;
  /** What stands at the page's head, such as the task the new one is related to, as capsules. */
  readonly head?: ReactNode;
  readonly words: StartWords;
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
  /** Called with the file addresses of pictures dropped on the page, on an iPad; it takes no drop where none is given. */
  readonly onDropPictures?: ((uris: readonly string[], unreadable: number) => void) | undefined;
  /** What a start, the picker, or a read said, each its own line over the field. */
  readonly notes: readonly string[];
  readonly add: StartAdd;
  /** The capsules after the + under the field, saying where the start runs, such as Repository and Machine. */
  readonly chips: ReactNode;
  /** What stands at the end of the row under the field before Send, such as Model · Effort, as the desktop composer stands its model picker. */
  readonly trailing?: ReactNode;
  /** Dictate before Send, and its strip while a dictation stands; none where the page takes none. */
  readonly dictation?: ComposerDictation | undefined;
  /** Whether Start may be pressed now: there is something to start on, and no start is out. */
  readonly ready: boolean;
  readonly onStart: () => void;
  /** Talk in Start's place while the field holds nothing, as an agent's composer offers it; none where the page offers no Talk. */
  readonly onTalk?: (() => void) | undefined;
  /** The names a flow finds the field and the + by. */
  readonly testIds: { readonly field: string; readonly add: string };
};

/**
 * What a start, the picker, or a read said, in the muted line over the
 * field, as the panel's composer says it. Note that VoiceOver is told it at
 * once, since it stands because something did not go, such as a refused
 * start.
 */
function StartNote({ words }: { readonly words: string }) {
  const colors = useColors();
  useAnnounced(words, true);

  return (
    <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}>
      {words}
    </Text>
  );
}

/** The page over the composer: empty, as a new conversation's is, but for the line naming who suggested the words and what the start is about, such as the task it is related to; a tap on it lowers the keyboard. */
function StartHead({ title, head }: Pick<StartPageProps, "title" | "head">) {
  const colors = useColors();
  const muted = [font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)];

  return (
    <Host style={{ flex: 1, backgroundColor: colors.GROUND }} modifiers={[tint(colors.TEXT)]}>
      <ScrollView modifiers={[scrollDismissesKeyboard("immediately")]}>
        <VStack
          alignment="leading"
          spacing={SPACE.ROW}
          modifiers={[
            frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
            padding({ horizontal: SPACE.EDGE, top: SPACE.ROW }),
          ]}
        >
          {title === undefined ? null : <Text modifiers={muted}>{title}</Text>}
          {head}
        </VStack>
      </ScrollView>
    </Host>
  );
}

/**
 * A page that starts work, as Messages, ChatGPT and Claude start a new
 * conversation: an empty page, what the start is about at its head, and the
 * agent page's own composer docked on the keyboard, the same glass with
 * Send, or Talk while it holds nothing, at its end. Under its field, inside
 * the same glass, stand the + and the capsules saying where and how the work
 * starts (`MenuChip` in its composer look), so the keyboard, or the bar iOS
 * stands over it, never covers them. The skills a `/` offers, the pictures
 * attached, and what a start said stand over the field, as they do on an
 * agent's page. The page's own bar holds its close.
 */
export function StartPage(props: StartPageProps) {
  const { words, skills, pictures, onDetach, notes, add, chips, trailing, ready, onStart, onTalk } =
    props;

  const head =
    skills === undefined && pictures.length === 0 && notes.length === 0 ? undefined : (
      <>
        {skills === undefined ? null : (
          <SkillSuggestions skills={skills.skills} empty={skills.empty} onPick={skills.onPick} />
        )}
        <AttachedPictures pictures={pictures} onDetach={onDetach} />
        {notes.map((note) => (
          <StartNote key={note} words={note} />
        ))}
      </>
    );

  return (
    <GlassDock
      bar={
        <Composer
          placeholder={words.placeholder}
          words={words.words}
          onWords={words.onWords}
          onLongPaste={words.onLongPaste}
          sendable={ready}
          onSend={ready ? onStart : undefined}
          addMenu={add.menu}
          onAdd={add.onAdd}
          call={onTalk === undefined ? undefined : { kind: COMPOSER_CALL.TALK, onTalk }}
          head={head}
          tools={chips}
          trailing={trailing}
          dictation={props.dictation}
          autoFocus
          onDropPictures={props.onDropPictures}
          testIds={props.testIds}
        />
      }
    >
      <StartHead title={props.title} head={props.head} />
    </GlassDock>
  );
}
