// icon-picker.tsx -- the app's one icon picker on iOS, as the panel's `IconPicker` is the desktop's: a sheet with the choice large at its top, its colors as the system's palette under it, a search, and tabs where it has them, over named groups of choices, each a picture, a glyph, or an emoji in a grid, the one chosen ringed in copper, confirmed by Done and dropped by Cancel, and an act that takes it away at its foot.

import {
  BottomSheet,
  Circle,
  Form,
  Group,
  Host,
  HStack,
  Image,
  NavigationStack,
  Picker,
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
  disabled,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  listRowBackground,
  listRowInsets,
  navigationBarTitleDisplayMode,
  navigationTitle,
  onAppear,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  resizable,
  scrollContentBackground,
  searchable,
  strokeBorder,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useScaledSize } from "./accessibility.js";
import { type ListScopes, ScopeControl } from "./button.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { MANAGER_FACE_EDGE_WIDTH, MANAGER_FACE_EMOJI_SCALE } from "./manager-face-look.js";
import { ActionRow } from "./settings-form.js";
import { Text } from "./text.js";
import { ElevatedGround, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/** How many choices stand in one row of the grid: eight, as the system's emoji keyboard lays out a row, so a Manager's six characters stand on one. */
const GRID_COLUMNS = 8;

/** A choice's side in the grid, in points at the default text size, so eight with their rings fill a row on the narrowest phone. */
const CHOICE_SIDE = 30;

/** The grid's room from its section's edges, in points, narrower than a row's, so its eight columns have the width. */
const GRID_INSET = 2 * SPACE.TIGHT;

/** The preview's side at the sheet's top, in points at the default text size, as Messages shows a contact's photo while it is picked. */
const PREVIEW_SIDE = 96;

/** The room between a choice and the ring the chosen one wears, and the ring's width, in points. */
const RING_GAP = 3;
const RING_WIDTH = 2;

/** How much of a choice's side a bare emoji fills, a little under it, since its line stands taller than its face. */
const BARE_EMOJI_SCALE = 0.8;

/**
 * How many choices the sheet draws at once before the rest wait for their
 * place to scroll near, and how many a long group draws at a time: about a
 * screen and a half of the grid, whole rows of it, so a tab of some two
 * thousand emoji or glyphs opens on its first rows and draws the rest as the
 * reader reaches them, and no chunk ends on a short row inside its group.
 */
const DRAWN_AHEAD = 15 * GRID_COLUMNS;

/** How much of a choice's side a glyph fills, as a symbol stands a little inside its line. */
const GLYPH_SCALE = 0.75;

/** No color at all, for a ring's room where no choice is chosen and the tabs' row. */
const CLEAR = "#00000000";

/** What the sheet's bar names its acts. */
const WORDS = {
  DONE: "Done",
  CANCEL: "Cancel",
} as const;

/** What a choice is drawn as: a picture of the asset catalog, a glyph in its ink, or an emoji, on a disc of its color where it has one. */
export const ICON_PICKER_LOOK = {
  PICTURE: "picture",
  GLYPH: "glyph",
  EMOJI: "emoji",
} as const;

type IconPickerLook =
  | { readonly kind: typeof ICON_PICKER_LOOK.PICTURE; readonly asset: string }
  | {
      readonly kind: typeof ICON_PICKER_LOOK.GLYPH;
      readonly glyph: Glyph;
      /** Its ink in the theme's shade, as a section's glyph wears its color. */
      readonly ink: string;
    }
  | {
      readonly kind: typeof ICON_PICKER_LOOK.EMOJI;
      readonly emoji: string;
      /** The disc it stands on, in the theme's shade, as a Manager's emoji face stands on its color; none for an emoji alone. */
      readonly disc?: string | undefined;
      /** The hairline its disc stands inside, as an emoji face's does in the light; none for a disc that needs none. */
      readonly edge?: string | undefined;
    };

/** One choice of the picker: what tells it apart in its group, its name, which it is heard as, how it is drawn, and whether it is the one chosen. */
type IconPickerChoice = {
  readonly key: string;
  readonly label: string;
  readonly look: IconPickerLook;
  readonly picked: boolean;
};

/** One color of the sheet's color row: what tells it apart, its name, which VoiceOver hears, and its fill in the theme's shade. */
type IconPickerColor = {
  readonly key: string;
  readonly label: string;
  readonly fill: string;
};

/** The sheet's color row: what it chooses, heard by VoiceOver, its colors, the one chosen, and what hears a choice. */
type IconPickerColors = {
  readonly label: string;
  readonly options: readonly IconPickerColor[];
  readonly chosen: string;
  readonly onChoose: (key: string) => void;
};

/** The sheet's preview: the choice standing, as it is drawn and as it is heard. */
type IconPickerPreview = {
  readonly look: IconPickerLook;
  readonly heard: string;
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
  /** The choice standing, drawn large at the sheet's top; none before a pick, which draws the chosen color alone and leaves Done unlit. */
  readonly preview: IconPickerPreview | undefined;
  readonly colors: IconPickerColors;
  /** Drops what was picked and puts the sheet away, as Cancel and a swipe down do. */
  readonly onCancel: () => void;
  /** Keeps what was picked and puts the sheet away. */
  readonly onDone: () => void;
  /** Hears the search's words as they are typed, which the caller narrows its groups by. */
  readonly onQuery: (query: string) => void;
  /** Its tabs, the system's segmented control over its groups, where it has them, which the caller stands only while nothing is searched. */
  readonly scopes?: ListScopes | undefined;
  readonly groups: readonly IconPickerGroup[];
  /** Hands on the key of the group and of the choice pressed, which the caller shows in the preview. */
  readonly onPick: (group: string, key: string) => void;
  /** An act that takes the choice away, such as a section's Remove icon, standing alone in red at the sheet's foot; none where nothing can be taken away. */
  readonly remove?: { readonly label: string; readonly onPress: () => void } | undefined;
};

/** What the grid hands a press: its group's key and its choice's. */
type PickChoice = (group: string, key: string) => void;

/** A choice's face: its picture, its glyph in its ink, or its emoji, on its disc where it has one. */
function ChoiceFace({ look, side }: { readonly look: IconPickerLook; readonly side: number }) {
  if (look.kind === ICON_PICKER_LOOK.PICTURE)
    return (
      <Image
        assetName={look.asset}
        modifiers={[resizable(), frame({ width: side, height: side })]}
      />
    );

  if (look.kind === ICON_PICKER_LOOK.GLYPH)
    return (
      <Image
        {...glyphImage(look.glyph)}
        color={look.ink}
        modifiers={[font({ size: side * GLYPH_SCALE }), frame({ width: side, height: side })]}
      />
    );

  const scale = look.disc === undefined ? BARE_EMOJI_SCALE : MANAGER_FACE_EMOJI_SCALE;

  return (
    <ZStack modifiers={[frame({ width: side, height: side })]}>
      {look.disc === undefined ? null : <Circle modifiers={[foregroundStyle(look.disc)]} />}
      {look.disc === undefined || look.edge === undefined ? null : (
        <Circle
          modifiers={[
            strokeBorder({
              content: look.edge,
              // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
              shape: "circle",
              style: { lineWidth: MANAGER_FACE_EDGE_WIDTH },
            }),
          ]}
        />
      )}
      <Text modifiers={[font({ size: side * scale })]}>{look.emoji}</Text>
    </ZStack>
  );
}

/**
 * One choice to press: its face, ringed in copper while it is the one
 * chosen, heard as its name and as selected where it is, each column of its
 * row as wide as the next. Note that it draws again only when its own
 * choice changes, so a group drawn as the reader scrolls near it redraws
 * none of the groups drawn before.
 */
const Choice = memo(function Choice({
  group,
  choice,
  onPick,
}: {
  readonly group: string;
  readonly choice: IconPickerChoice;
  readonly onPick: PickChoice;
}) {
  const colors = useColors();
  const side = useScaledSize(CHOICE_SIDE);
  const ringed = side + 2 * (RING_GAP + RING_WIDTH);

  const heard = [
    accessibilityLabel(choice.label),
    ...(choice.picked ? [accessibilityAddTraits(["isSelected"])] : []),
  ];

  return (
    <SwiftUIButton
      onPress={() => onPick(group, choice.key)}
      modifiers={[buttonStyle("plain"), frame({ maxWidth: Number.POSITIVE_INFINITY }), ...heard]}
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
        <ChoiceFace look={choice.look} side={side} />
      </ZStack>
    </SwiftUIButton>
  );
});

/** A row's room past its last choice, as wide as a choice's column, so a short row's columns line up with a full one's. */
function EmptyColumn() {
  const ringed = useScaledSize(CHOICE_SIDE) + 2 * (RING_GAP + RING_WIDTH);

  return (
    <Spacer
      modifiers={[
        frame({
          minWidth: ringed,
          maxWidth: Number.POSITIVE_INFINITY,
          minHeight: ringed,
          maxHeight: ringed,
        }),
      ]}
    />
  );
}

/** A group's choices in rows of `GRID_COLUMNS` even columns across the section, a short row keeping the room of those it lacks, so the columns line up down the group and the groups. */
function ChoiceGrid({
  group,
  choices,
  onPick,
}: {
  readonly group: string;
  readonly choices: readonly IconPickerChoice[];
  readonly onPick: PickChoice;
}) {
  const rows = gridRows(choices);

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT}>
      {rows.map((row) => (
        <HStack key={row[0]?.key ?? "empty"} spacing={0}>
          {row.map((choice) => (
            <Choice key={choice.key} group={group} choice={choice} onPick={onPick} />
          ))}
          {Array.from({ length: GRID_COLUMNS - row.length }, (_, at) => (
            <EmptyColumn key={at} />
          ))}
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

/** The chunks the reader has scrolled near, by their group's key and their place in it. */
type ReachedChunks = ReadonlyMap<string, ReadonlySet<number>>;

/** One chunk of a group's choices, `DRAWN_AHEAD` at most, and whether it is drawn. */
type GroupChunk = { readonly choices: readonly IconPickerChoice[]; readonly drawn: boolean };

/**
 * Each group's choices in the chunks it draws at a time, `DRAWN_AHEAD` each,
 * a chunk drawn where it starts within the sheet's first `DRAWN_AHEAD`
 * choices or the reader has scrolled near it.
 */
function groupChunks(
  groups: readonly IconPickerGroup[],
  reached: ReachedChunks,
): readonly (readonly GroupChunk[])[] {
  let before = 0;

  return groups.map((group) =>
    Array.from({ length: Math.ceil(group.choices.length / DRAWN_AHEAD) }, (_, at) => {
      const choices = group.choices.slice(at * DRAWN_AHEAD, (at + 1) * DRAWN_AHEAD);
      const drawn = before < DRAWN_AHEAD || (reached.get(group.key)?.has(at) ?? false);

      before += choices.length;

      return { choices, drawn };
    }),
  );
}

/** The sheet's top: the choice standing, large, or the chosen color's disc alone before a pick, heard by its name. */
function Preview({
  preview,
  colors: row,
}: {
  readonly preview: IconPickerPreview | undefined;
  readonly colors: IconPickerColors;
}) {
  const side = useScaledSize(PREVIEW_SIDE);
  const fill = row.options.find((each) => each.key === row.chosen)?.fill;

  return (
    <HStack modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]}>
      {preview === undefined ? (
        <Circle
          modifiers={[foregroundStyle(fill ?? CLEAR), frame({ width: side, height: side })]}
        />
      ) : (
        <ZStack modifiers={[accessibilityLabel(preview.heard)]}>
          <ChoiceFace look={preview.look} side={side} />
        </ZStack>
      )}
    </HStack>
  );
}

/** The sheet's colors as the system's palette picker, each a filled circle in its own fill, heard by its name, the one chosen marked as the system marks it. */
function ColorRow({ colors: row }: { readonly colors: IconPickerColors }) {
  return (
    <Picker<string>
      label={row.label}
      selection={row.chosen}
      onSelectionChange={row.onChoose}
      modifiers={[pickerStyle("palette"), labelsHidden()]}
    >
      {row.options.map((each) => (
        <Image
          key={each.key}
          systemName="circle.fill"
          color={each.fill}
          modifiers={[tint(each.fill), tag(each.key), accessibilityLabel(each.label)]}
        />
      ))}
    </Picker>
  );
}

/** The picker's page: the preview and its colors, its search in the bar's drawer, its tabs where it has them, its groups under their names, and Cancel and Done. */
function IconPickerPage(props: IconPickerSheetProps) {
  const colors = useColors();
  const query = useNativeState("");
  const [reached, setReached] = useState<ReachedChunks>(() => new Map());
  const chunks = groupChunks(props.groups, reached);

  // Note that every choice hears one press that reads the caller's latest, so a choice redraws only when it changes, never because the caller's handler did.
  const latestPick = useRef(props.onPick);

  useEffect(() => {
    latestPick.current = props.onPick;
  });
  const onPick = useCallback<PickChoice>((group, key) => latestPick.current(group, key), []);

  const reach = (group: string, at: number) =>
    setReached((before) => new Map(before).set(group, new Set(before.get(group)).add(at)));

  const clearRow = [
    listRowBackground(CLEAR),
    listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
  ];

  const gridRow = listRowInsets({ leading: GRID_INSET, trailing: GRID_INSET });

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
          <Section>
            <HStack modifiers={clearRow}>
              <Preview preview={props.preview} colors={props.colors} />
            </HStack>
          </Section>
          <Section>
            <ColorRow colors={props.colors} />
          </Section>
          {props.scopes === undefined ? null : (
            <Section>
              <HStack modifiers={clearRow}>
                <ScopeControl {...props.scopes} />
              </HStack>
            </Section>
          )}
          {props.groups.length === 0 ? (
            <Section>
              <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{props.empty}</Text>
            </Section>
          ) : (
            props.groups.map((group, place) => (
              <Section key={group.key} title={group.name}>
                <VStack modifiers={[gridRow]} spacing={SPACE.TIGHT}>
                  {(chunks[place] ?? []).map((chunk, at) =>
                    chunk.drawn ? (
                      <ChoiceGrid
                        key={at}
                        group={group.key}
                        choices={chunk.choices}
                        onPick={onPick}
                      />
                    ) : (
                      <WaitingGrid
                        key={at}
                        count={chunk.choices.length}
                        onReach={() => reach(group.key, at)}
                      />
                    ),
                  )}
                </VStack>
              </Section>
            ))
          )}
          {props.remove === undefined ? null : (
            <Section>
              <ActionRow
                label={props.remove.label}
                destructive
                centered
                onPress={props.remove.onPress}
              />
            </Section>
          )}
        </Form>
        <Toolbar.Content>
          <ToolbarItem placement="cancellationAction">
            <SwiftUIButton label={WORDS.CANCEL} onPress={props.onCancel} />
          </ToolbarItem>
          <ToolbarItem placement="confirmationAction">
            <SwiftUIButton
              label={WORDS.DONE}
              onPress={props.onDone}
              modifiers={[disabled(props.preview === undefined)]}
            />
          </ToolbarItem>
        </Toolbar.Content>
      </Toolbar>
    </NavigationStack>
  );
}

/**
 * The app's one icon picker, the panel's `IconPicker` in the way iOS picks
 * a contact's photo in Messages: a sheet over the screen that opens it,
 * rising to half height and dragged to full, its title, Cancel, and Done in
 * its bar and the system's search field in the bar's drawer; the choice
 * standing large at its top, its colors under it as the system's palette;
 * its tabs, where it has them, as the system's segmented control; and the
 * choices in named groups, each group a grid eight wide of pictures,
 * glyphs, or emoji, the one chosen ringed in copper, as a picked option is.
 * A press hands on the choice, which the caller shows in the preview, and a
 * color chosen recolors it; Done keeps it and Cancel, or a swipe down, drops
 * it. An act that takes the choice away (`remove`) stands alone in red at
 * its foot, as a form's red row does. A long grid draws its choices a chunk
 * at a time as the reader scrolls near them (`DRAWN_AHEAD`), a long group's
 * included. The caller narrows its groups by the search's words
 * (`onQuery`), so a search finds what the panel's would. It stands on the
 * lifted ground in a host of its own beside its screen, as every sheet of
 * choices does.
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
          if (!shown) props.onCancel();
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
