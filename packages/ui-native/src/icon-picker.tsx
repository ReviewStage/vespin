// icon-picker.tsx -- the app's one icon picker on iOS, as the panel's `IconPicker` is the desktop's: a sheet with a search, and tabs where it has them, over named groups of choices, each a picture or an emoji in a grid, the one chosen ringed in copper, a choice with options opening the system's menu of them.

import {
  BottomSheet,
  Circle,
  Form,
  Group,
  Host,
  HStack,
  Image,
  NavigationStack,
  Section,
  Spacer,
  Button as SwiftUIButton,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
  navigationBarTitleDisplayMode,
  navigationTitle,
  onAppear,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  resizable,
  scrollContentBackground,
  searchable,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScaledSize } from "./accessibility.js";
import { type ListScopes, ScopeControl } from "./button.js";
import { headerMenu } from "./interactions.js";
import { MANAGER_FACE_EMOJI_SCALE } from "./manager-face-look.js";
import { type ChoiceMark, choicePressAt, choiceTree, type MenuChoice } from "./row-menu-model.js";
import { Text } from "./text.js";
import { ElevatedGround, toneColor, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import type { StatusTone } from "./tokens/status-tone.js";

/** How many choices stand in one row of the grid: six, so a Manager's six colors fill a row on the narrowest phone. */
const GRID_COLUMNS = 6;

/** A choice's side in the grid, in points at the default text size, a little larger than a row's lead, so a finger finds each. */
const CHOICE_SIDE = 32;

/** The room between a choice and the ring the chosen one wears, and the ring's width, in points. */
const RING_GAP = 3;
const RING_WIDTH = 2;

/** How much of a choice's side a bare emoji fills, a little under it, since its line stands taller than its face. */
const BARE_EMOJI_SCALE = 0.8;

/**
 * How many choices the sheet draws at once before a group waits for its place
 * to scroll near: about a screen and a half of the grid, so a tab of some two
 * thousand emoji opens on its first category and draws the rest as the reader
 * reaches them.
 */
const DRAWN_AHEAD = 120;

/** No color at all, for a ring's room where no choice is chosen and the tabs' row. */
const CLEAR = "#00000000";

/** What the sheet's bar names its act. */
const DONE = "Done";

/** What a choice is drawn as: a picture of the asset catalog, or an emoji, on a disc of its color where it has one. */
export const ICON_PICKER_LOOK = {
  PICTURE: "picture",
  EMOJI: "emoji",
} as const;

type IconPickerLook =
  | { readonly kind: typeof ICON_PICKER_LOOK.PICTURE; readonly asset: string }
  | {
      readonly kind: typeof ICON_PICKER_LOOK.EMOJI;
      readonly emoji: string;
      /** The disc it stands on, in the theme's shade, as a Manager's emoji face stands on its color; none for an emoji alone. */
      readonly disc?: string | undefined;
    };

/** One of a choice's options, such as a face's color: its name, led by its mark, checked where it stands, and what VoiceOver calls it. */
type IconPickerOption = {
  readonly label: string;
  readonly mark: ChoiceMark;
  readonly on: boolean;
  readonly heard: string;
};

/** One choice of the picker: what tells it apart, its name, which it is heard as, how it is drawn, whether it is the one chosen, and the options a press offers, where it offers any rather than picking it at once. */
type IconPickerChoice = {
  readonly key: string;
  readonly label: string;
  readonly look: IconPickerLook;
  readonly picked: boolean;
  readonly options?: readonly IconPickerOption[] | undefined;
};

/** A named group of the picker's choices, such as a character's faces. */
type IconPickerGroup = {
  readonly key: string;
  readonly name: string;
  readonly choices: readonly IconPickerChoice[];
};

type IconPickerSheetProps = {
  /** The sheet's title, in its bar. */
  readonly title: string;
  /** What the search asks for, such as "Search faces". */
  readonly searchPrompt: string;
  /** What the sheet says where a search finds nothing. */
  readonly empty: string;
  readonly presented: boolean;
  readonly onDismiss: () => void;
  /** Hears the search's words as they are typed, which the caller narrows its groups by. */
  readonly onQuery: (query: string) => void;
  /** Its tabs, the system's segmented control over its groups, where it has them, which the caller stands only while nothing is searched. */
  readonly scopes?: ListScopes | undefined;
  readonly groups: readonly IconPickerGroup[];
  /** Hands on the key of the choice pressed, and the place of the option chosen among its options where it has them. */
  readonly onPick: (key: string, option: number | undefined) => void;
};

/** What the grid hands a press: the choice's key, and its option's place where it has options. */
type PickChoice = (key: string, option: number | undefined) => void;

/** A choice's face: its picture, or its emoji, on its disc where it has one. */
function ChoiceFace({ look, side }: { readonly look: IconPickerLook; readonly side: number }) {
  if (look.kind === ICON_PICKER_LOOK.PICTURE)
    return (
      <Image
        assetName={look.asset}
        modifiers={[resizable(), frame({ width: side, height: side })]}
      />
    );

  const scale = look.disc === undefined ? BARE_EMOJI_SCALE : MANAGER_FACE_EMOJI_SCALE;

  return (
    <ZStack modifiers={[frame({ width: side, height: side })]}>
      {look.disc === undefined ? null : <Circle modifiers={[foregroundStyle(look.disc)]} />}
      <Text modifiers={[font({ size: side * scale })]}>{look.emoji}</Text>
    </ZStack>
  );
}

/**
 * One choice to press: its face, ringed in copper while it is the one
 * chosen, heard as its name and as selected where it is. One with options
 * opens the system's menu of them on a tap, built natively from their tree as
 * it opens (`headerMenu`), so a grid of thousands holds no views of menus
 * nobody opened; any other picks it at once. Note that it draws again only
 * when its own choice changes, so a group drawn as the reader scrolls near
 * it redraws none of the groups drawn before.
 */
const Choice = memo(function Choice({
  choice,
  onPick,
}: {
  readonly choice: IconPickerChoice;
  readonly onPick: PickChoice;
}) {
  const colors = useColors();
  const side = useScaledSize(CHOICE_SIDE);
  const ringed = side + 2 * (RING_GAP + RING_WIDTH);
  const options = choice.options;

  const menu = useMemo(() => {
    if (options === undefined) return undefined;

    const choices = options.map(
      (option, at): MenuChoice => ({ ...option, onPress: () => onPick(choice.key, at) }),
    );

    const inks = { act: colors.TEXT_MUTED, tone: (tone: StatusTone) => toneColor(colors, tone) };

    return { choices, tree: JSON.stringify({ groups: choiceTree(choices, inks) }) };
  }, [options, onPick, choice.key, colors]);

  const heard = [
    accessibilityLabel(choice.label),
    ...(choice.picked ? [accessibilityAddTraits(["isSelected"])] : []),
  ];

  const face = (
    <ZStack
      modifiers={[
        frame({ width: ringed, height: ringed }),
        // Note that every choice keeps its ring's room, clear where it is not chosen, so a pick never shifts the grid.
        strokeBorder({
          content: choice.picked ? colors.ACCENT : CLEAR,
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
          shape: "circle",
          style: { lineWidth: RING_WIDTH },
        }),
      ]}
    >
      <ChoiceFace look={choice.look} side={side} />
    </ZStack>
  );

  if (menu !== undefined)
    return (
      <HStack
        modifiers={[
          headerMenu(menu.tree, (path) => choicePressAt(menu.choices, path)?.(), undefined),
          buttonStyle("plain"),
          ...heard,
        ]}
      >
        {face}
      </HStack>
    );

  return (
    <SwiftUIButton
      onPress={() => onPick(choice.key, undefined)}
      modifiers={[buttonStyle("plain"), ...heard]}
    >
      {face}
    </SwiftUIButton>
  );
});

/** A group's choices in rows of `GRID_COLUMNS`, each row standing from the section's leading edge, so the columns line up down the group. */
function ChoiceGrid({
  choices,
  onPick,
}: {
  readonly choices: readonly IconPickerChoice[];
  readonly onPick: PickChoice;
}) {
  const rows = gridRows(choices);

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT}>
      {rows.map((row) => (
        <HStack key={row[0]?.key ?? "empty"} spacing={SPACE.ROW}>
          {row.map((choice) => (
            <Choice key={choice.key} choice={choice} onPick={onPick} />
          ))}
          <Spacer />
        </HStack>
      ))}
    </VStack>
  );
}

/** A group's choices in the grid's rows. */
function gridRows(choices: readonly IconPickerChoice[]): readonly (readonly IconPickerChoice[])[] {
  return Array.from({ length: Math.ceil(choices.length / GRID_COLUMNS) }, (_, at) =>
    choices.slice(at * GRID_COLUMNS, (at + 1) * GRID_COLUMNS),
  );
}

/** A group not yet drawn: the grid's room, empty, which draws the group once it scrolls near (`onReach`), so the form's length holds steady as it fills. */
function WaitingGrid({ count, onReach }: { readonly count: number; readonly onReach: () => void }) {
  const ringed = useScaledSize(CHOICE_SIDE) + 2 * (RING_GAP + RING_WIDTH);
  const rows = Math.ceil(count / GRID_COLUMNS);

  return (
    <Spacer
      modifiers={[
        frame({ height: rows * ringed + Math.max(0, rows - 1) * SPACE.TIGHT }),
        onAppear(onReach),
      ]}
    />
  );
}

/** The groups drawn at once: those whose choices before them number under `DRAWN_AHEAD`, and each the reader has scrolled near. */
function drawnGroups(
  groups: readonly IconPickerGroup[],
  reached: ReadonlySet<string>,
): ReadonlySet<string> {
  const drawn = new Set(reached);
  let before = 0;

  for (const group of groups) {
    if (before < DRAWN_AHEAD) drawn.add(group.key);
    before += group.choices.length;
  }

  return drawn;
}

/** The picker's page: its search in the bar's drawer, its tabs where it has them, its groups under their names, and Done. */
function IconPickerPage(props: IconPickerSheetProps) {
  const colors = useColors();
  const query = useNativeState("");
  const [reached, setReached] = useState<ReadonlySet<string>>(() => new Set());
  const drawn = drawnGroups(props.groups, reached);

  // Note that every choice hears one press that reads the caller's latest, so a choice redraws only when it changes, never because the caller's handler did.
  const latestPick = useRef(props.onPick);

  useEffect(() => {
    latestPick.current = props.onPick;
  });
  const onPick = useCallback<PickChoice>((key, option) => latestPick.current(key, option), []);
  const reach = (key: string) => setReached((before) => new Set(before).add(key));

  return (
    <NavigationStack modifiers={[tint(colors.TEXT)]}>
      <Toolbar>
        <Form
          modifiers={[
            scrollContentBackground("hidden"),
            background(colors.GROUPED),
            navigationTitle(props.title),
            navigationBarTitleDisplayMode("inline"),
            searchable(query, {
              placement: "navigationBarDrawer",
              prompt: props.searchPrompt,
              onChange: props.onQuery,
            }),
          ]}
        >
          {props.scopes === undefined ? null : (
            <Section>
              <HStack
                modifiers={[
                  listRowBackground(CLEAR),
                  listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
                ]}
              >
                <ScopeControl {...props.scopes} />
              </HStack>
            </Section>
          )}
          {props.groups.length === 0 ? (
            <Section>
              <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{props.empty}</Text>
            </Section>
          ) : (
            props.groups.map((group) => (
              <Section key={group.key} title={group.name}>
                {drawn.has(group.key) ? (
                  <ChoiceGrid choices={group.choices} onPick={onPick} />
                ) : (
                  <WaitingGrid count={group.choices.length} onReach={() => reach(group.key)} />
                )}
              </Section>
            ))
          )}
        </Form>
        <Toolbar.Content>
          <ToolbarItem placement="confirmationAction">
            <SwiftUIButton label={DONE} onPress={props.onDismiss} />
          </ToolbarItem>
        </Toolbar.Content>
      </Toolbar>
    </NavigationStack>
  );
}

/**
 * The app's one icon picker, the panel's `IconPicker` in the way iOS picks
 * an icon: a sheet over the screen that opens it, rising to half height and
 * dragged to full, its title and Done in its bar and the system's search
 * field in the bar's drawer, its tabs, where it has them, as the system's
 * segmented control, over the choices in named groups, each group a grid
 * six wide of pictures or emoji, the one chosen ringed in copper, as a
 * picked option is. A choice with options, such as a face's colors, opens
 * the system's menu of them, as the panel's pops its colors up; any other
 * is chosen at once. A long grid draws its groups as the reader scrolls
 * near them (`DRAWN_AHEAD`). The caller narrows its groups by the search's
 * words (`onQuery`), so a search finds what the panel's would; a press
 * hands on the choice's key, and its option's place, and the caller decides
 * whether the sheet goes. It stands
 * on the lifted ground in a host of its own beside its screen, as every
 * sheet of choices does.
 */
export function IconPickerSheet(props: IconPickerSheetProps) {
  return (
    <ElevatedGround>
      <IconPickerHost {...props} />
    </ElevatedGround>
  );
}

/** The sheet itself, under its lifted ground. */
function IconPickerHost(props: IconPickerSheetProps) {
  const colors = useColors();

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet
        isPresented={props.presented}
        onIsPresentedChange={(shown) => {
          if (!shown) props.onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(["medium", "large"]),
            presentationDragIndicator("visible"),
            presentationBackground(colors.GROUPED),
          ]}
        >
          <IconPickerPage {...props} />
        </Group>
      </BottomSheet>
    </Host>
  );
}
