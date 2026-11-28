// workspace-switcher.tsx -- the switcher a tab's root bar names the workspace with: its tile, opening the system's menu of every workspace by its photo or tile, then New workspace, the chosen workspace's Manage under its name, and the account by its photo opening Settings, each on one line.

import {
  Circle,
  HStack,
  Image,
  Menu,
  Section,
  Spacer,
  Button as SwiftUIButton,
  Toggle,
  ZStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  menuIndicator,
  menuStyle,
  offset,
} from "@expo/ui/swift-ui/modifiers";
import { identityLetter, WORKSPACE_SWITCHER_WORDS } from "@repo/features/workspace-tile";
import { memo } from "react";
import { useColorScheme } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { font } from "./font.js";
import { GLYPH, type Glyph, glyphImage, letterTileGlyph } from "./glyph.js";
import { actContent, menuActContent } from "./glyph-label.js";
import { Host } from "./host.js";
import { useRowInset } from "./layout-margin.js";
import type { MenuPhotoFile } from "./row-menu-model.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { type SwitcherWorkspace, WorkspaceTile } from "./workspace-tile.js";
import { tileHue } from "./workspace-tile-model.js";

/** The tile in a bar, beside the workspace's name. */
const BAR_TILE_SIZE = 22;

/** The widest the name stands in a bar, so a long one is cut short rather than pushing the bar's other buttons off it. */
const NAME_MAX_WIDTH = 180;

/** The chevron after the name, which says the name opens a list, in the body's ink, since the muted ink faded into a dark bar's glass. */
const CHEVRON_SIZE = 10;

/** How the switcher's button stands: the tile, the name and ⌄, where a sidebar's row has room, or the tile alone at a bar's photo size, where a bar's title stands beside it, as the App Store and Gmail stand an account's photo that opens a list, with no ⌄. */
export const SWITCHER_LOOK = {
  NAMED: "named",
  TILE: "tile",
} as const;

export type SwitcherLook = (typeof SWITCHER_LOOK)[keyof typeof SWITCHER_LOOK];

/** How far the waiting mark's ring stands past its dot on each side, in the ground's ink, so it reads on any photo and on a bar's glass. */
const WAITING_RING = 1.5;

/** How far past the tile's top trailing corner the waiting mark stands, as an app icon's badge stands past its icon. */
const WAITING_OUT = 3;

/** What a flow finds the switcher by. */
const SWITCHER_ID = "workspace-switcher";

/** The signed-in account as the list's row that opens Settings. */
export type SwitcherAccount = {
  /** The account's name, or its address where it has none. */
  readonly name: string;
  /** The account's sign-in picture, which the landscape iPad's sidebar draws; its letters where it has none. */
  readonly picture?: string | undefined;
  /** That picture as a file on this device, which its row in the menu leads with; the gear while it has none. */
  readonly menuPhoto?: MenuPhotoFile | undefined;
  readonly onPress: () => void;
};

/** What the account's row is named: where it goes, ahead of whose it is, so it never reads as a third workspace; one line, with no address under it. */
const SETTINGS = "Settings";

/** What the chosen workspace's settings row is named under the section the workspace's name heads, so it fits one line and never stands as a second Settings beside the account's. */
const MANAGE = "Manage";

/** An act under the list's workspaces, such as New workspace. */
export type SwitcherAction = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly onPress: () => void;
};

type WorkspaceSwitcherProps = {
  /** Every workspace the account is a member of, in the order the host lists them. */
  readonly workspaces: readonly SwitcherWorkspace[];
  /** The one the phone works in, which the bar names and the list checks. */
  readonly chosen: SwitcherWorkspace;
  readonly onChoose: (id: string) => void;
  /** The signed-in account, whose row last in the list opens Settings; none while nobody is signed in, or where the window leads to Settings itself, as a landscape iPad's sidebar does at its foot. */
  readonly account?: SwitcherAccount | undefined;
  /** The acts after the workspaces, such as New workspace. */
  readonly actions: readonly SwitcherAction[];
  /** Opens the chosen workspace's settings, Manage standing after the acts in a section the workspace's name heads; none where it has no settings page. */
  readonly onWorkspaceSettings?: (() => void) | undefined;
  /** How its button stands; the tile and the name where none is given. */
  readonly look?: SwitcherLook | undefined;
  /** How large the tile stands where the look is the tile alone; the bar's face where none is given. */
  readonly tileSize?: number | undefined;
  /** Whether another workspace holds a thread waiting on the reader, which marks the button's tile, so it is seen without opening the list. */
  readonly waitingElsewhere?: boolean | undefined;
};

/** What the switcher is heard as: the workspace and who shares it, as the panel's head says it, then that a thread waits in another where one does. */
function heardAs(chosen: SwitcherWorkspace, waitingElsewhere: boolean): string {
  return [
    `Workspace: ${chosen.name}`,
    chosen.line,
    waitingElsewhere ? WORKSPACE_SWITCHER_WORDS.WAITING_ELSEWHERE : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
}

/**
 * The tile with the attention ink's dot past its top trailing corner, as an
 * app icon's badge stands past its icon, on a ring of the ground's ink so it
 * reads on any photo and on a bar's glass: the switcher's tile while another
 * workspace holds a thread that waits on the reader. Never heard, since the
 * switcher says it in its own words.
 */
function MarkedTile({
  workspace,
  size,
  marked,
}: {
  readonly workspace: SwitcherWorkspace;
  readonly size: number;
  readonly marked: boolean;
}) {
  const colors = useColors();
  const dot = useScaledSize(MARK_SIZE.DOT);

  if (!marked) return <WorkspaceTile workspace={workspace} size={size} />;

  const disc = dot + WAITING_RING * 2;

  return (
    <ZStack
      alignment="topTrailing"
      modifiers={[frame({ width: size, height: size }), accessibilityHidden()]}
    >
      <WorkspaceTile workspace={workspace} size={size} />
      <ZStack
        modifiers={[
          frame({ width: disc, height: disc }),
          offset({ x: WAITING_OUT, y: -WAITING_OUT }),
        ]}
      >
        <Circle modifiers={[foregroundStyle(colors.GROUND)]} />
        <Circle
          modifiers={[frame({ width: dot, height: dot }), foregroundStyle(colors.ATTENTION)]}
        />
      </ZStack>
    </ZStack>
  );
}

/**
 * A workspace as the menu holds it: its name over who shares it and what waits there, led by its
 * photo, or else its letter in the system's filled square in its tile's hue,
 * as Notion's switcher leads each workspace with its icon.
 */
function workspaceChoice(workspace: SwitcherWorkspace, dark: boolean) {
  // Note that a row whose photo is still on its way stands with no image rather than its letter, so the letter never shows where a photo is coming.
  return menuActContent(
    workspace.name,
    workspace.menuPhotoComing === true
      ? undefined
      : letterTileGlyph(identityLetter(workspace.name)),
    workspace.line,
    tileHue(workspace.id, dark),
    workspace.menuPhoto,
  );
}

/** The switcher's own face: the chosen workspace's tile, alone or with its name and ⌄, the tile marked while a thread waits in another workspace. */
function SwitcherFace({
  chosen,
  look,
  tileSize,
  marked,
}: {
  readonly chosen: SwitcherWorkspace;
  readonly look: SwitcherLook;
  readonly tileSize: number;
  readonly marked: boolean;
}) {
  const colors = useColors();
  const tile = useScaledSize(BAR_TILE_SIZE);
  const chevron = useScaledSize(CHEVRON_SIZE);
  const nameWidth = useScaledSize(NAME_MAX_WIDTH);

  if (look === SWITCHER_LOOK.TILE) {
    return <MarkedTile workspace={chosen} size={tileSize} marked={marked} />;
  }

  // Note that the named face heads the sidebar's list rather than a bar, so it grows with Dynamic Type as the rows under it do.
  return (
    <HStack
      spacing={SPACE.TIGHT + 2}
      modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}
    >
      <MarkedTile workspace={chosen} size={tile} marked={marked} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.SIDEBAR_TITLE, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
          lineLimit(1),
          frame({ maxWidth: nameWidth, alignment: "leading" }),
        ]}
      >
        {chosen.name}
      </Text>
      <Image
        {...glyphImage(GLYPH.UNFOLDED)}
        size={chevron}
        color={colors.TEXT_BODY}
        modifiers={[accessibilityHidden()]}
      />
    </HStack>
  );
}

/**
 * The switcher for a bar SwiftUI draws, such as a split view's sidebar or
 * column bar: the chosen workspace's tile and name and a chevron, or its tile
 * alone, opening the system's menu, as Notion's one workspace button does:
 * every workspace by its photo or tile, its name and who shares it, the
 * chosen one checked; then the acts, such as New workspace; then the chosen
 * workspace's settings as Manage in a section its name heads, so the row
 * fits one line and never reads as a second Settings; and last, where a
 * caller hands one, the row into Settings, led by the account's photo, with
 * no line under it, so every row stands on one line at the default text
 * size. A menu runs a
 * row's act once it has closed, so a screen it opens is never presented
 * over it as it leaves.
 */
export const WorkspaceSwitcherItem = memo(function WorkspaceSwitcherItem(
  props: WorkspaceSwitcherProps,
) {
  const {
    workspaces,
    chosen,
    onChoose,
    account,
    actions,
    onWorkspaceSettings,
    look = SWITCHER_LOOK.NAMED,
    tileSize = MARK_SIZE.BAR_FACE,
    waitingElsewhere = false,
  } = props;

  const dark = useColorScheme() === "dark";

  return (
    <Menu
      label={
        <SwitcherFace chosen={chosen} look={look} tileSize={tileSize} marked={waitingElsewhere} />
      }
      modifiers={[
        menuStyle("button"),
        buttonStyle("plain"),
        menuIndicator("hidden"),
        accessibilityLabel(heardAs(chosen, waitingElsewhere)),
        accessibilityIdentifier(SWITCHER_ID),
      ]}
    >
      <Section>
        {workspaces.map((workspace) => (
          <Toggle
            key={workspace.id}
            {...workspaceChoice(workspace, dark)}
            isOn={workspace.id === chosen.id}
            onIsOnChange={() => onChoose(workspace.id)}
          />
        ))}
      </Section>
      {actions.length === 0 ? null : (
        <Section>
          {actions.map((action) => (
            <SwiftUIButton
              key={action.label}
              {...actContent(action.label, action.symbol)}
              onPress={action.onPress}
            />
          ))}
        </Section>
      )}
      {onWorkspaceSettings === undefined ? null : (
        <Section title={chosen.name}>
          <SwiftUIButton {...actContent(MANAGE, GLYPH.SETTINGS)} onPress={onWorkspaceSettings} />
        </Section>
      )}
      {account === undefined ? null : (
        <Section>
          <SwiftUIButton
            {...menuActContent(SETTINGS, GLYPH.SETTINGS, undefined, undefined, account.menuPhoto)}
            onPress={account.onPress}
          />
        </Section>
      )}
    </Menu>
  );
});

/**
 * The switcher for a screen's own navigation bar, the stack's header, which
 * holds React Native views: the same switcher in a SwiftUI host the size of
 * its button, standing as the one bar item at the bar's leading edge: the
 * tile alone, at the size the account's photo stood, in the round glass the
 * bar stands it in, as the App Store and Gmail stand a photo that opens a
 * list, so the screen's own title keeps its place in the bar and the menu
 * names the workspace, checked. Note that it stands as a bar item rather
 * than the bar's title view, because a host sized to its contents drew at
 * no size at all in the native stack's title on iOS 27.
 */
export const WorkspaceSwitcher = memo(function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  return (
    <Host matchContents>
      <WorkspaceSwitcherItem {...props} look={SWITCHER_LOOK.TILE} />
    </Host>
  );
});

/**
 * The switcher heading an iPad's own sidebar, as the panel's sidebar heads
 * itself with the workspace: its tile, its name and ⌄ on the list's first
 * row, its words where the rows' words start, which picks nothing itself
 * and opens the switcher's menu, and New task's glyph at the row's end, as
 * the panel's head ends in it.
 */
export const WorkspaceSwitcherRow = memo(function WorkspaceSwitcherRow({
  compose,
  ...props
}: WorkspaceSwitcherProps & {
  /** New task at the row's end, as the panel's sidebar ends its workspace's row with it. */
  readonly compose?: SwitcherAction | undefined;
}) {
  const inset = useRowInset();

  return (
    <HStack
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({
          leading: inset.lead,
          trailing: inset.margin,
          top: SPACE.ROW,
          bottom: SPACE.ROW,
        }),
      ]}
    >
      <WorkspaceSwitcherItem {...props} look={SWITCHER_LOOK.NAMED} />
      <Spacer />
      {compose === undefined ? null : (
        <SwiftUIButton
          {...actContent(compose.label, compose.symbol)}
          onPress={compose.onPress}
          modifiers={[labelStyle("iconOnly"), buttonStyle("borderless")]}
        />
      )}
    </HStack>
  );
});

/** The menu's act that makes a workspace, as the panel words it. */
export function newWorkspaceAction(onPress: () => void): SwitcherAction {
  return { label: WORKSPACE_SWITCHER_WORDS.NEW_WORKSPACE, symbol: GLYPH.ADD, onPress };
}
