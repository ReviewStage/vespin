// workspace-switcher.tsx -- a workspace's tile, and the switcher a tab's root bar names the workspace with: its tile and name, opening the menu of every workspace, the account opening Settings, New workspace, and Workspace settings.

import {
  Divider,
  Host,
  HStack,
  Image,
  Menu,
  RoundedRectangle,
  Button as SwiftUIButton,
  Text,
  Toggle,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityIdentifier,
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { identityLetter, WORKSPACE_SWITCHER_WORDS } from "@repo/features/workspace-tile";
import { useState } from "react";
import { PixelRatio, useColorScheme } from "react-native";
import { AvatarPhoto, TILE_ROUNDING } from "./marks.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { ON_IDENTITY } from "./tokens/identity-hues.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";
import { tileHue, tileSymbol } from "./workspace-tile-model.js";

/** The share of a tile its letter stands at. */
const LETTER_SCALE = 0.5;

/** The tile in a bar, beside the workspace's name. */
const BAR_TILE_SIZE = 22;

/** The widest the name stands in a bar, so a long one is cut short rather than pushing the bar's other buttons off it. */
const NAME_MAX_WIDTH = 180;

/** The chevron after the name, which says the name opens a menu, in the body's ink, since the muted ink faded into a dark bar's glass. */
const CHEVRON_SIZE = 10;

/** How the switcher's button stands: the tile, the name and ⌄, where a sidebar's row has room, or the tile alone at a bar's photo size, where a bar's title stands beside it, as the App Store and Gmail stand an account's photo that opens a menu, with no ⌄. */
export const SWITCHER_LOOK = {
  NAMED: "named",
  TILE: "tile",
} as const;

export type SwitcherLook = (typeof SWITCHER_LOOK)[keyof typeof SWITCHER_LOOK];

/** What a flow finds the switcher by. */
const SWITCHER_ID = "workspace-switcher";

/** A workspace as its tile and the switcher's row draw it. */
export type SwitcherWorkspace = {
  readonly id: string;
  readonly name: string;
  /** Who shares it, "5 members" or "Personal workspace", under its name; none from a service that does not count them. */
  readonly line?: string | undefined;
  /** Its photo as the host holds it, a `data:` address, where an owner set one. */
  readonly photo?: string | undefined;
  /** Its owner's sign-in picture, which a personal workspace with no photo stands. */
  readonly picture?: string | undefined;
};

/** The signed-in account as the menu's row that opens Settings. */
export type SwitcherAccount = {
  /** The account's name, or its address where it has none. */
  readonly name: string;
  readonly onPress: () => void;
};

/** What the account's row says under its name: where it goes. */
const SETTINGS = "Settings";

/** The account's row's image. Note that a menu draws its rows' images as templates in one ink, so a photo would stand as a flat silhouette; the system's person stands in its place. */
const ACCOUNT_SYMBOL = "person.crop.circle";

/** An act under the menu's workspaces, such as New workspace. */
export type SwitcherAction = {
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly onPress: () => void;
};

type WorkspaceSwitcherProps = {
  /** Every workspace the account is a member of, in the order the host lists them. */
  readonly workspaces: readonly SwitcherWorkspace[];
  /** The one the phone works in, which the bar names and the menu checks. */
  readonly chosen: SwitcherWorkspace;
  readonly onChoose: (id: string) => void;
  /** The signed-in account, whose row under the workspaces opens Settings; none while nobody is signed in. */
  readonly account?: SwitcherAccount | undefined;
  /** The acts after the account: New workspace, then Workspace settings. */
  readonly actions: readonly SwitcherAction[];
  /** How its button stands; the tile and the name where none is given. */
  readonly look?: SwitcherLook | undefined;
  /** How large the tile stands where the look is the tile alone; the bar's face where none is given. */
  readonly tileSize?: number | undefined;
};

/** The picture a tile draws over its letter: the photo as held, else the owner's picture asked for at the tile's size; none while the letter stands alone. */
function tilePicture(workspace: SwitcherWorkspace, size: number): string | undefined {
  if (workspace.photo !== undefined) return workspace.photo;
  const pinned = pinnedPictureUrl(workspace.picture);
  return pinned === undefined ? undefined : accountPictureAt(pinned, size * PixelRatio.get());
}

/**
 * A workspace's tile, as the panel's is: its photo, its owner's picture on a
 * personal one, or the first character of its name on one of six hues read
 * off its id, on a softened square, since a square says a team as a circle
 * says a person. Note that the letter stands under the picture, so it shows
 * while the picture loads and stays once it fails, which takes the picture
 * away. It is never heard, since the name beside it says the workspace.
 */
export function WorkspaceTile({
  workspace,
  size = MARK_SIZE.AVATAR,
}: {
  readonly workspace: SwitcherWorkspace;
  /** Its width, in points; an avatar's where none is given. */
  readonly size?: number | undefined;
}) {
  const dark = useColorScheme() === "dark";
  const picture = tilePicture(workspace, size);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const corner = size * TILE_ROUNDING;
  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityHidden()]}>
      <RoundedRectangle
        cornerRadius={corner}
        modifiers={[foregroundStyle(tileHue(workspace.id, dark))]}
      />
      <Text
        modifiers={[
          font({ size: size * LETTER_SCALE, weight: "semibold", design: "rounded" }),
          foregroundStyle(ON_IDENTITY),
        ]}
      >
        {identityLetter(workspace.name)}
      </Text>
      {picture === undefined || picture === failed ? null : (
        <AvatarPhoto
          address={picture}
          size={size}
          corner={corner}
          onFail={() => setFailed(picture)}
        />
      )}
    </ZStack>
  );
}

/** What the switcher is heard as: the workspace and who shares it, as the panel's head says it. */
function heardAs(chosen: SwitcherWorkspace): string {
  return [`Workspace: ${chosen.name}`, chosen.line].filter((part) => part !== undefined).join(", ");
}

/**
 * The switcher for a bar SwiftUI draws, such as a split view's sidebar: the
 * chosen workspace's tile and name and a chevron, which open the system's
 * menu of every workspace by its letter, its name, and who shares it, the
 * chosen one checked as the system checks a choice, then under a rule the
 * account by its name, opening Settings, and the acts, as Notion's one
 * workspace button holds the account and its settings. Note that a menu's
 * row takes the system's image and words alone, so each workspace leads
 * with its letter's symbol rather than its tile, and the account with the
 * system's person rather than its photo.
 */
export function WorkspaceSwitcherMenu({
  workspaces,
  chosen,
  onChoose,
  account,
  actions,
  look = SWITCHER_LOOK.NAMED,
  tileSize = MARK_SIZE.BAR_FACE,
}: WorkspaceSwitcherProps) {
  const colors = useColors();
  return (
    <Menu
      modifiers={[accessibilityLabel(heardAs(chosen)), accessibilityIdentifier(SWITCHER_ID)]}
      label={
        look === SWITCHER_LOOK.TILE ? (
          <WorkspaceTile workspace={chosen} size={tileSize} />
        ) : (
          <HStack spacing={SPACE.TIGHT + 2}>
            <WorkspaceTile workspace={chosen} size={BAR_TILE_SIZE} />
            <Text
              modifiers={[
                font({ size: TEXT_SIZE.HEADLINE, weight: "semibold" }),
                foregroundStyle(colors.TEXT),
                lineLimit(1),
                frame({ maxWidth: NAME_MAX_WIDTH, alignment: "leading" }),
              ]}
            >
              {chosen.name}
            </Text>
            <Image
              systemName="chevron.down"
              size={CHEVRON_SIZE}
              color={colors.TEXT_BODY}
              modifiers={[accessibilityHidden()]}
            />
          </HStack>
        )
      }
    >
      {workspaces.map((workspace) => (
        <Toggle
          key={workspace.id}
          isOn={workspace.id === chosen.id}
          onIsOnChange={() => onChoose(workspace.id)}
          modifiers={[accessibilityLabel(workspace.name)]}
        >
          <Text>{workspace.name}</Text>
          {workspace.line === undefined ? null : <Text>{workspace.line}</Text>}
          <Image systemName={tileSymbol(workspace.name)} />
        </Toggle>
      ))}
      {account === undefined && actions.length === 0 ? null : <Divider />}
      {account === undefined ? null : (
        <SwiftUIButton onPress={account.onPress}>
          <Text>{account.name}</Text>
          <Text>{SETTINGS}</Text>
          <Image systemName={ACCOUNT_SYMBOL} />
        </SwiftUIButton>
      )}
      {actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          label={action.label}
          systemImage={action.symbol}
          onPress={action.onPress}
        />
      ))}
    </Menu>
  );
}

/**
 * The switcher for a screen's own navigation bar, the stack's header, which
 * holds React Native views: the same menu in a SwiftUI host the size of its
 * label, standing as the one bar item at the bar's leading edge: the tile
 * alone, at the size the account's photo stood, in the round glass the bar
 * stands it in, as the App Store and Gmail stand a photo that opens a menu,
 * so the screen's own title keeps its place in the bar and the menu names
 * the workspace, checked. Note that it stands as a
 * bar item rather than the bar's title view, because a host sized to its
 * contents drew at no size at all in the native stack's title on iOS 27.
 */
export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  return (
    <Host matchContents>
      <WorkspaceSwitcherMenu {...props} look={SWITCHER_LOOK.TILE} />
    </Host>
  );
}

/** The menu's act that makes a workspace, as the panel words it. */
export function newWorkspaceAction(onPress: () => void): SwitcherAction {
  return { label: WORKSPACE_SWITCHER_WORDS.NEW_WORKSPACE, symbol: "plus", onPress };
}

/** The menu's act that opens the chosen workspace's settings, as the panel words it, by a workspace's glyph so it stands apart from Settings' gear. */
export function workspaceSettingsAction(onPress: () => void): SwitcherAction {
  return { label: WORKSPACE_SWITCHER_WORDS.WORKSPACE_SETTINGS, symbol: "building.2", onPress };
}
