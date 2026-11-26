// icon-picker.tsx -- the app's one icon picker on iOS, as the panel's `IconPicker` is the desktop's: a sheet with a search over named groups of choices, each a picture or an emoji in a grid, the ones chosen ringed in copper, a bar of the groups across its top and the name of the group in view standing at the grid's top.

import {
  BottomSheet,
  Divider,
  Group,
  Host,
  HStack,
  Image,
  LazyVStack,
  NavigationStack,
  Rectangle,
  ScrollView,
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
  accessibilityHidden,
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  navigationBarTitleDisplayMode,
  navigationTitle,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  resizable,
  scrollPosition,
  scrollTargetLayout,
  searchable,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useCallback, useMemo, useState } from "react";
import { useScaledSize } from "./accessibility.js";
import type { Glyph } from "./glyph.js";
import { GlyphImage } from "./glyph-label.js";
import { Text } from "./text.js";
import { ElevatedGround, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How many choices stand in one row of the grid: six, so a Manager's six colors fill a row on the narrowest phone. */
const GRID_COLUMNS = 6;

/** A choice's side in the grid, in points at the default text size, a little larger than a row's lead, so a finger finds each. */
const CHOICE_SIDE = 32;

/** The room between a choice and the ring the chosen one wears, and the ring's width, in points. */
const RING_GAP = 3;
const RING_WIDTH = 2;

/** How large an emoji stands in its choice's side, so its face fills the side as a picture does. */
const EMOJI_SHARE = 0.85;

/** What the sheet's bar names its act. */
const DONE = "Done";

/** A group's picture or emoji in the bar of groups, in points at the default text size, a step smaller than a choice's. */
const BAR_PICTURE_SIDE = 24;

/** The rule under the group in view in the bar of groups, in points. */
const BAR_RULE_HEIGHT = 2;

/** Clear, a ring's or a rule's ink where it stands for nothing, which keeps its room so nothing shifts. */
const CLEAR = "#00000000";

/** How many rows past those on screen the grid keeps built on each side, so a fling lands on drawn choices. */
const OVERSCAN_ROWS = 12;

/** The kinds of row the grid stands its groups in: a group's name, then its choices six to a row. */
const GRID_ROW = {
  NAME: "name",
  CHOICES: "choices",
} as const;

/** One choice of the picker: what tells it apart, its name, which it is heard as, what it is drawn as (a picture of the asset catalog, or an emoji), and whether it is chosen. */
type IconPickerChoice = {
  readonly key: string;
  readonly label: string;
  readonly picked: boolean;
} & ({ readonly picture: string } | { readonly emoji: string });

/** A named group of the picker's choices, such as a character's faces, and the glyph the bar of groups draws it by, such as an emoji category's; its first choice where it has none. */
type IconPickerGroup = {
  readonly key: string;
  readonly name: string;
  readonly choices: readonly IconPickerChoice[];
  readonly glyph?: Glyph | undefined;
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
  readonly groups: readonly IconPickerGroup[];
  /** Hands on the key of the choice pressed. */
  readonly onPick: (key: string) => void;
};

/** One choice to press: its picture or its emoji, ringed in copper while it is chosen, heard as its name and as selected where it is. */
function Choice({
  choice,
  onPick,
}: {
  readonly choice: IconPickerChoice;
  readonly onPick: (key: string) => void;
}) {
  const colors = useColors();
  const side = useScaledSize(CHOICE_SIDE);
  const ringed = side + 2 * (RING_GAP + RING_WIDTH);

  return (
    <SwiftUIButton
      onPress={() => onPick(choice.key)}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(choice.label),
        ...(choice.picked ? [accessibilityAddTraits(["isSelected"])] : []),
      ]}
    >
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
        {"picture" in choice ? (
          <Image
            assetName={choice.picture}
            modifiers={[resizable(), frame({ width: side, height: side })]}
          />
        ) : (
          <Text modifiers={[font({ size: side * EMOJI_SHARE })]}>{choice.emoji}</Text>
        )}
      </ZStack>
    </SwiftUIButton>
  );
}

/** One row of the grid, by the key of the group it stands in: the group's name over its choices, or up to `GRID_COLUMNS` of its choices. */
type GridRow = { readonly group: string } & (
  | { readonly kind: typeof GRID_ROW.NAME; readonly name: string }
  | { readonly kind: typeof GRID_ROW.CHOICES; readonly choices: readonly IconPickerChoice[] }
);

/** Every group as the grid's rows, in order: its name, then its choices in rows of `GRID_COLUMNS`, so the lazy stack builds only the rows near the screen however many choices there are. */
function gridRows(groups: readonly IconPickerGroup[]): readonly GridRow[] {
  return groups.flatMap((group) => [
    { group: group.key, kind: GRID_ROW.NAME, name: group.name },
    ...Array.from({ length: Math.ceil(group.choices.length / GRID_COLUMNS) }, (_, at) => ({
      group: group.key,
      kind: GRID_ROW.CHOICES,
      choices: group.choices.slice(at * GRID_COLUMNS, (at + 1) * GRID_COLUMNS),
    })),
  ]);
}

/** A group's name as a list's section header stands, over its choices in the grid, and standing at the grid's top while they scroll under it (`NameBand`). */
function GroupName({ name }: { readonly name: string }) {
  const colors = useColors();

  return (
    <HStack modifiers={[padding({ top: SPACE.EDGE, bottom: SPACE.TIGHT })]}>
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "semibold" }),
          foregroundStyle(colors.TEXT_MUTED),
          accessibilityAddTraits(["isHeader"]),
        ]}
      >
        {name}
      </Text>
      <Spacer />
    </HStack>
  );
}

/**
 * The name of the group in view, standing over the grid's top on the
 * sheet's own ground while its choices scroll under it, as Slack's emoji
 * picker's headers stick. Note that it is drawn over the grid rather than
 * pinned in it, because a recycled row cannot be a section's pinned header;
 * it stands where the group's own name row stands at the top, so the two
 * meet as one, and a reader hears the row's name alone.
 */
function NameBand({ name }: { readonly name: string }) {
  const colors = useColors();

  return (
    <VStack
      modifiers={[
        padding({ horizontal: SPACE.PAGE }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        background(colors.GROUPED),
        accessibilityHidden(true),
      ]}
    >
      <GroupName name={name} />
    </VStack>
  );
}

/** What a group's tab in the bar of groups wears: its glyph, else its first choice's picture or emoji, a step smaller than a choice. */
function GroupMark({ group }: { readonly group: IconPickerGroup }) {
  const colors = useColors();
  const side = useScaledSize(BAR_PICTURE_SIDE);
  const first = group.choices[0];

  if (group.glyph !== undefined)
    return <GlyphImage glyph={group.glyph} color={colors.TEXT_MUTED} />;

  if (first === undefined) return null;

  if ("picture" in first)
    return (
      <Image
        assetName={first.picture}
        modifiers={[resizable(), frame({ width: side, height: side })]}
      />
    );

  return <Text modifiers={[font({ size: side * EMOJI_SHARE })]}>{first.emoji}</Text>;
}

/**
 * The bar of groups across the sheet's top, as the panel's emoji picker's
 * category bar: each group's mark, a press scrolling the grid to the
 * group's name, the group in view ruled under in the ink and heard as
 * selected.
 */
function GroupBar({
  groups,
  inView,
  onJump,
}: {
  readonly groups: readonly IconPickerGroup[];
  readonly inView: string | undefined;
  readonly onJump: (group: string) => void;
}) {
  const colors = useColors();

  return (
    <HStack
      spacing={0}
      modifiers={[
        padding({ horizontal: SPACE.EDGE, top: SPACE.TIGHT }),
        accessibilityAddTraits(["isTabBar"]),
      ]}
    >
      {groups.map((group) => {
        const current = group.key === inView;

        return (
          <SwiftUIButton
            key={group.key}
            onPress={() => onJump(group.key)}
            modifiers={[
              buttonStyle("plain"),
              accessibilityLabel(group.name),
              ...(current ? [accessibilityAddTraits(["isSelected"])] : []),
            ]}
          >
            <VStack
              spacing={SPACE.TIGHT}
              modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]}
            >
              <GroupMark group={group} />
              <Rectangle
                modifiers={[
                  frame({ height: BAR_RULE_HEIGHT }),
                  foregroundStyle(current ? colors.TEXT : CLEAR),
                ]}
              />
            </VStack>
          </SwiftUIButton>
        );
      })}
    </HStack>
  );
}

/** Each group's name row's key in the grid, by the group's key, which the bar of groups scrolls to. */
function nameRows(rows: readonly GridRow[]): ReadonlyMap<string, string> {
  const places = new Map<string, string>();

  rows.forEach((row, at) => {
    if (row.kind === GRID_ROW.NAME) places.set(row.group, gridRowKey(row, at));
  });

  return places;
}

/** One row of the grid as it is drawn: a group's name as a list's section header stands, or its choices from the row's leading edge, so the columns line up down the group. */
function GridRowView({
  row,
  onPick,
}: {
  readonly row: GridRow;
  readonly onPick: (key: string) => void;
}) {
  if (row.kind === GRID_ROW.NAME) return <GroupName name={row.name} />;

  return (
    <HStack spacing={SPACE.ROW}>
      {row.choices.map((choice) => (
        <Choice key={choice.key} choice={choice} onPick={onPick} />
      ))}
      <Spacer />
    </HStack>
  );
}

/** A row's place in the grid, which a recycled row is told apart by, one to each row however many groups hold the same choice: the grid is built anew for each search, so a place names one row while it stands. */
function gridRowKey(_row: GridRow, at: number): string {
  return String(at);
}

/**
 * The picker's page: its search in the bar's drawer, the bar of groups
 * while nothing is searched and it offers more than one, its groups under
 * their names in one lazy stack of recycled rows, the name of the group in
 * view standing at the top (`NameBand`), and Done. The group in view is the
 * one whose row leads the grid, as the scroll view reports it
 * (`scrollPosition`, by the rows' keys), the first until it reports one;
 * a press in the bar scrolls its group's name row there.
 */
function IconPickerPage(props: IconPickerSheetProps) {
  const colors = useColors();
  const query = useNativeState("");
  const position = useNativeState<string | null>(null);
  const [leading, setLeading] = useState<string | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const { groups, onPick, onQuery } = props;
  const rows = useMemo(() => gridRows(groups), [groups]);
  const names = useMemo(() => nameRows(rows), [rows]);
  const rowSide = useScaledSize(CHOICE_SIDE) + 2 * (RING_GAP + RING_WIDTH);
  const leadRow = leading === undefined ? undefined : rows[Number(leading)];
  const inView = groups.find((group) => group.key === (leadRow?.group ?? groups[0]?.key));

  const jump = (group: string) => {
    const key = names.get(group);

    if (key === undefined) return;
    position.value = key;
    setLeading(key);
  };

  const search = (words: string) => {
    setSearching(words.trim() !== "");
    setLeading(undefined);
    onQuery(words);
  };

  const drawRow = useCallback(
    ({ item }: { readonly item: GridRow }) => <GridRowView row={item} onPick={onPick} />,
    [onPick],
  );

  return (
    <NavigationStack modifiers={[tint(colors.TEXT)]}>
      <Toolbar>
        <VStack
          spacing={0}
          modifiers={[
            background(colors.GROUPED),
            navigationTitle(props.title),
            navigationBarTitleDisplayMode("inline"),
            searchable(query, {
              placement: "navigationBarDrawer",
              prompt: props.searchPrompt,
              onChange: search,
            }),
          ]}
        >
          {groups.length > 1 && !searching ? (
            <>
              <GroupBar groups={groups} inView={inView?.key} onJump={jump} />
              <Divider />
            </>
          ) : null}
          <ZStack alignment="top">
            <ScrollView
              modifiers={[
                scrollPosition(position, {
                  anchor: "top",
                  onChange: (key) => setLeading(key ?? undefined),
                }),
              ]}
            >
              <LazyVStack
                alignment="leading"
                spacing={SPACE.TIGHT}
                modifiers={[
                  padding({ horizontal: SPACE.PAGE, bottom: SPACE.PAGE }),
                  scrollTargetLayout(),
                ]}
              >
                {props.groups.length === 0 ? (
                  <Text
                    modifiers={[foregroundStyle(colors.TEXT_MUTED), padding({ top: SPACE.EDGE })]}
                  >
                    {props.empty}
                  </Text>
                ) : (
                  <LazyVStack.ForEach
                    data={rows}
                    keyExtractor={gridRowKey}
                    overscanCount={OVERSCAN_ROWS}
                    estimatedItemSize={rowSide}
                  >
                    {drawRow}
                  </LazyVStack.ForEach>
                )}
              </LazyVStack>
            </ScrollView>
            {inView === undefined ? null : <NameBand name={inView.name} />}
          </ZStack>
        </VStack>
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
 * field in the bar's drawer, over the choices in named groups, each group
 * a grid six wide of pictures or emoji, the ones chosen ringed in copper,
 * as a picked option is. Its rows stand in one lazy stack that builds only
 * those near the screen and reuses them as it scrolls
 * (`LazyVStack.ForEach`), so a picker of every emoji lists them all. Where
 * it offers more than one group and nothing is searched, a bar of them
 * stands across its top, as the panel's category bar does, each group's
 * glyph or first choice scrolling to it, the group in view ruled under; and
 * the name of the group in view stands at the grid's top while its choices
 * scroll under it. The caller narrows its groups by the search's words
 * (`onQuery`), so a search finds what the panel's would; a press hands on
 * the choice's key and the caller decides whether the sheet goes. It stands
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
