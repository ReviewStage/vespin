// icon-picker.tsx -- the app's one icon picker on iOS, as the panel's `IconPicker` is the desktop's: a sheet with a search over named groups of choices, each a picture or an emoji in a grid, the ones chosen ringed in copper.

import {
  BottomSheet,
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
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  resizable,
  scrollContentBackground,
  searchable,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useScaledSize } from "./accessibility.js";
import { Text } from "./text.js";
import { ElevatedGround, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

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

/** One choice of the picker: what tells it apart, its name, which it is heard as, what it is drawn as (a picture of the asset catalog, or an emoji), and whether it is chosen. */
type IconPickerChoice = {
  readonly key: string;
  readonly label: string;
  readonly picked: boolean;
} & ({ readonly picture: string } | { readonly emoji: string });

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
            content: choice.picked ? colors.ACCENT : "#00000000",
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

/** A group's choices in rows of `GRID_COLUMNS`, each row standing from the section's leading edge, so the columns line up down the group. */
function ChoiceGrid({
  choices,
  onPick,
}: {
  readonly choices: readonly IconPickerChoice[];
  readonly onPick: (key: string) => void;
}) {
  const rows = Array.from({ length: Math.ceil(choices.length / GRID_COLUMNS) }, (_, at) =>
    choices.slice(at * GRID_COLUMNS, (at + 1) * GRID_COLUMNS),
  );

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

/** The picker's page: its search in the bar's drawer, its groups under their names, and Done. */
function IconPickerPage(props: IconPickerSheetProps) {
  const colors = useColors();
  const query = useNativeState("");

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
          {props.groups.length === 0 ? (
            <Section>
              <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{props.empty}</Text>
            </Section>
          ) : (
            props.groups.map((group) => (
              <Section key={group.key} title={group.name}>
                <ChoiceGrid choices={group.choices} onPick={props.onPick} />
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
 * field in the bar's drawer, over the choices in named groups, each group
 * a grid six wide of pictures, the one chosen ringed in copper, as a
 * picked option is. The caller narrows its groups by the search's words
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
