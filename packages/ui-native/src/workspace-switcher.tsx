// workspace-switcher.tsx -- the switcher a tab's root bar names the workspace with: its tile, opening the list of every workspace by its tile or photo, the account by its photo opening Settings, New workspace, and the chosen workspace's Settings… under its name, in a popover on an iPad and a sheet on an iPhone.

import {
  BottomSheet,
  Group,
  Host,
  HStack,
  Image,
  Popover,
  Section,
  Spacer,
  Button as SwiftUIButton,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityHidden,
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  onDisappear,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { WORKSPACE_SWITCHER_WORDS } from "@repo/features/workspace-tile";
import { type ReactNode, useState } from "react";
import { Avatar } from "./marks.js";
import { SettingsForm } from "./settings-form.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TEXT_SIZE, TYPE_ROLE } from "./tokens/type.js";
import { type SwitcherWorkspace, WorkspaceTile } from "./workspace-tile.js";

/** The tile in a bar, beside the workspace's name. */
const BAR_TILE_SIZE = 22;

/** The widest the name stands in a bar, so a long one is cut short rather than pushing the bar's other buttons off it. */
const NAME_MAX_WIDTH = 180;

/** The check on the chosen workspace's row. */
const CHECK_SIZE = 14;

/** The chevron after the name, which says the name opens a list, in the body's ink, since the muted ink faded into a dark bar's glass. */
const CHEVRON_SIZE = 10;

/** How the switcher's button stands: the tile, the name and ⌄, where a sidebar's row has room, or the tile alone at a bar's photo size, where a bar's title stands beside it, as the App Store and Gmail stand an account's photo that opens a list, with no ⌄. */
export const SWITCHER_LOOK = {
  NAMED: "named",
  TILE: "tile",
} as const;

export type SwitcherLook = (typeof SWITCHER_LOOK)[keyof typeof SWITCHER_LOOK];

/** How the switcher's list opens: a popover over its button, in a regular window such as an iPad's, or a sheet from the screen's foot, in a compact one such as an iPhone's, as Notion's switcher opens on each. Note that `@expo/ui`'s popover keeps itself a popover in a compact window too, so the caller says which the window takes. */
export const SWITCHER_PRESENTATION = {
  POPOVER: "popover",
  SHEET: "sheet",
} as const;

export type SwitcherPresentation =
  (typeof SWITCHER_PRESENTATION)[keyof typeof SWITCHER_PRESENTATION];

/** What a flow finds the switcher by. */
const SWITCHER_ID = "workspace-switcher";

/** The signed-in account as the list's row that opens Settings. */
export type SwitcherAccount = {
  /** The account's name, or its address where it has none. */
  readonly name: string;
  /** The account's sign-in picture, which its row leads with; its letters where it has none. */
  readonly picture?: string | undefined;
  readonly onPress: () => void;
};

/** What the account's row says under its name: where it goes. */
const SETTINGS = "Settings";

/** What opens the chosen workspace's settings, under its name, as the menu it replaced said it. Note that it is heard as the panel's words, so VoiceOver, which may not read the section's name, never takes it for the account's Settings. */
const WORKSPACE_SETTINGS = "Settings…";

/** A workspace's tile, and the account's photo, at the head of their rows. */
const ROW_MARK_SIZE = 30;

/** How wide the popover stands, near the width iOS's own popovers of a list keep. */
const POPOVER_WIDTH = 320;

/**
 * How tall the popover's rows and their gaps stand, in points, at the
 * default text size, which its height is reckoned from, since a list has no
 * height of its own for a popover to fit: a row with its mark and two lines,
 * one with a line, the gap above and below the list and between its
 * sections, and a section's name over it. A larger text size scrolls inside
 * it, and `POPOVER_TALLEST` keeps a long list of workspaces on the screen.
 */
const POPOVER_ROW = { MARKED: 52, PLAIN: 44, EDGE: 20, BETWEEN: 32, TITLED: 22 } as const;

/** The tallest the popover stands, so a long list of workspaces scrolls inside it rather than running off an iPad's screen. */
const POPOVER_TALLEST = 560;

/** An act under the list's workspaces, such as New workspace. */
export type SwitcherAction = {
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly onPress: () => void;
};

type WorkspaceSwitcherProps = {
  /** Every workspace the account is a member of, in the order the host lists them. */
  readonly workspaces: readonly SwitcherWorkspace[];
  /** The one the phone works in, which the bar names and the list checks. */
  readonly chosen: SwitcherWorkspace;
  readonly onChoose: (id: string) => void;
  /** The signed-in account, whose row under the workspaces opens Settings; none while nobody is signed in. */
  readonly account?: SwitcherAccount | undefined;
  /** The acts after the account, such as New workspace. */
  readonly actions: readonly SwitcherAction[];
  /** Opens the chosen workspace's settings, its Settings… standing last in a section under its name; none where it has no settings page. */
  readonly onWorkspaceSettings?: (() => void) | undefined;
  /** How its button stands; the tile and the name where none is given. */
  readonly look?: SwitcherLook | undefined;
  /** How large the tile stands where the look is the tile alone; the bar's face where none is given. */
  readonly tileSize?: number | undefined;
  /** How its list opens; a popover where none is given. */
  readonly presentation?: SwitcherPresentation | undefined;
};

/** What the switcher is heard as: the workspace and who shares it, as the panel's head says it. */
function heardAs(chosen: SwitcherWorkspace): string {
  return [`Workspace: ${chosen.name}`, chosen.line].filter((part) => part !== undefined).join(", ");
}

/** What a row of the list is heard as: its name and its line together, as a flow finds a workspace by both. */
function rowHeard(name: string, line: string | undefined): string {
  return line === undefined ? name : `${name}, ${line}`;
}

/** The popover's height for the rows it holds, reckoned as `POPOVER_ROW` says, never taller than `POPOVER_TALLEST`. */
function popoverHeight({
  workspaces,
  account,
  actions,
  onWorkspaceSettings,
}: WorkspaceSwitcherProps) {
  const marked = workspaces.length + (account === undefined ? 0 : 1);
  const plain = actions.length + (onWorkspaceSettings === undefined ? 0 : 1);
  const middle = account !== undefined || actions.length > 0;
  const gaps = (middle ? 1 : 0) + (onWorkspaceSettings === undefined ? 0 : 1);

  const height =
    POPOVER_ROW.EDGE * 2 +
    marked * POPOVER_ROW.MARKED +
    plain * POPOVER_ROW.PLAIN +
    gaps * POPOVER_ROW.BETWEEN +
    (onWorkspaceSettings === undefined ? 0 : POPOVER_ROW.TITLED);

  return Math.min(height, POPOVER_TALLEST);
}

/** A row of the list: what leads it, its name and the line under it, and the copper check on the one chosen, the whole row pressed. */
function SwitcherRow({
  mark,
  name,
  line,
  checked = false,
  onPress,
}: {
  readonly mark: ReactNode;
  readonly name: string;
  readonly line?: string | undefined;
  readonly checked?: boolean | undefined;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(rowHeard(name, line)),
        ...(checked ? [accessibilityAddTraits(["isSelected"])] : []),
        listRowBackground(colors.SURFACE),
      ]}
    >
      <HStack
        spacing={SPACE.ROW + 2}
        modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}
      >
        {mark}
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[foregroundStyle(colors.TEXT), lineLimit(1)]}>{name}</Text>
          {line === undefined ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.TEXT_MUTED),
                lineLimit(1),
              ]}
            >
              {line}
            </Text>
          )}
        </VStack>
        <Spacer />
        {checked ? (
          <Image
            systemName="checkmark"
            size={CHECK_SIZE}
            color={colors.ACCENT}
            modifiers={[accessibilityHidden()]}
          />
        ) : null}
      </HStack>
    </SwiftUIButton>
  );
}

/** A plain act of the list, such as New workspace: its glyph and its words, in the ink. */
function ActRow({
  label,
  symbol,
  heard = label,
  onPress,
}: {
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly heard?: string | undefined;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <SwiftUIButton
      label={label}
      systemImage={symbol}
      onPress={onPress}
      modifiers={[accessibilityLabel(heard), listRowBackground(colors.SURFACE)]}
    />
  );
}

/**
 * The list the switcher opens, as Notion's opens: every workspace by its own
 * tile or photo, its name, and who shares it, the chosen one checked in
 * copper; then the account by its photo and name, opening Settings, and the
 * acts, such as New workspace; and last a section under the chosen
 * workspace's name holding its Settings…. Each row closes the list and says
 * what it does through `closed`, which runs a choice at once and an act that
 * opens a screen once the list has gone.
 */
function SwitcherList({
  props,
  closed,
}: {
  readonly props: WorkspaceSwitcherProps;
  readonly closed: (then: () => void, presents: boolean) => void;
}) {
  const { workspaces, chosen, onChoose, account, actions, onWorkspaceSettings } = props;

  return (
    <SettingsForm>
      <Section>
        {workspaces.map((workspace) => (
          <SwitcherRow
            key={workspace.id}
            mark={<WorkspaceTile workspace={workspace} size={ROW_MARK_SIZE} />}
            name={workspace.name}
            line={workspace.line}
            checked={workspace.id === chosen.id}
            onPress={() => closed(() => onChoose(workspace.id), false)}
          />
        ))}
      </Section>
      {account === undefined && actions.length === 0 ? null : (
        <Section>
          {account === undefined ? null : (
            <SwitcherRow
              mark={<Avatar name={account.name} picture={account.picture} size={ROW_MARK_SIZE} />}
              name={account.name}
              line={SETTINGS}
              onPress={() => closed(account.onPress, true)}
            />
          )}
          {actions.map((action) => (
            <ActRow
              key={action.label}
              label={action.label}
              symbol={action.symbol}
              onPress={() => closed(action.onPress, true)}
            />
          ))}
        </Section>
      )}
      {onWorkspaceSettings === undefined ? null : (
        <Section title={chosen.name}>
          <ActRow
            label={WORKSPACE_SETTINGS}
            symbol="building.2"
            heard={WORKSPACE_SWITCHER_WORDS.WORKSPACE_SETTINGS}
            onPress={() => closed(onWorkspaceSettings, true)}
          />
        </Section>
      )}
    </SettingsForm>
  );
}

/** The switcher's own button: the chosen workspace's tile, alone or with its name and ⌄, heard as the workspace. */
function SwitcherFace({
  chosen,
  look,
  tileSize,
  onPress,
}: {
  readonly chosen: SwitcherWorkspace;
  readonly look: SwitcherLook;
  readonly tileSize: number;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(heardAs(chosen)),
        accessibilityIdentifier(SWITCHER_ID),
      ]}
    >
      {look === SWITCHER_LOOK.TILE ? (
        <WorkspaceTile workspace={chosen} size={tileSize} />
      ) : (
        <HStack
          spacing={SPACE.TIGHT + 2}
          modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}
        >
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
      )}
    </SwiftUIButton>
  );
}

/**
 * The switcher for a bar SwiftUI draws, such as a split view's sidebar or
 * column bar: the chosen workspace's tile and name and a chevron, or its tile
 * alone, opening the list of every workspace (`SwitcherList`), as Notion's
 * one workspace button does, in a popover over the button in a regular
 * window and in a sheet from the screen's foot in a compact one, half the
 * screen tall and dragged to its whole height. It replaced the system's menu,
 * which draws its rows' images as templates in one ink, so no workspace's
 * photo or the account's showed in it. Note that an act that opens a screen,
 * such as Settings, runs only once the list has gone, since a screen
 * presented while the popover or the sheet is still leaving is refused.
 */
export function WorkspaceSwitcherItem(props: WorkspaceSwitcherProps) {
  const {
    chosen,
    look = SWITCHER_LOOK.NAMED,
    tileSize = MARK_SIZE.BAR_FACE,
    presentation = SWITCHER_PRESENTATION.POPOVER,
  } = props;

  const [presented, setPresented] = useState(false);
  const [after, setAfter] = useState<{ readonly act: () => void } | undefined>(undefined);

  // Note that the act is taken off as it runs, so a second dismissal never runs it again.
  const gone = () => {
    setAfter(undefined);
    after?.act();
  };

  const closed = (then: () => void, presents: boolean) => {
    if (presents) setAfter({ act: then });
    else then();

    setPresented(false);
  };

  const face = (
    <SwitcherFace
      chosen={chosen}
      look={look}
      tileSize={tileSize}
      onPress={() => setPresented(true)}
    />
  );

  if (presentation === SWITCHER_PRESENTATION.SHEET) {
    return (
      <BottomSheet
        anchor={face}
        isPresented={presented}
        onIsPresentedChange={setPresented}
        onDismiss={gone}
      >
        <Group
          modifiers={[
            presentationDetents(["medium", "large"]),
            presentationDragIndicator("visible"),
          ]}
        >
          <SwitcherList props={props} closed={closed} />
        </Group>
      </BottomSheet>
    );
  }

  return (
    <Popover isPresented={presented} onIsPresentedChange={setPresented} arrowEdge="top">
      <Popover.Trigger>{face}</Popover.Trigger>
      <Popover.Content>
        <Group
          modifiers={[
            frame({ width: POPOVER_WIDTH, height: popoverHeight(props) }),
            onDisappear(gone),
          ]}
        >
          <SwitcherList props={props} closed={closed} />
        </Group>
      </Popover.Content>
    </Popover>
  );
}

/**
 * The switcher for a screen's own navigation bar, the stack's header, which
 * holds React Native views: the same switcher in a SwiftUI host the size of
 * its button, standing as the one bar item at the bar's leading edge: the
 * tile alone, at the size the account's photo stood, in the round glass the
 * bar stands it in, as the App Store and Gmail stand a photo that opens a
 * list, so the screen's own title keeps its place in the bar and the list
 * names the workspace, checked. Note that it stands as a bar item rather
 * than the bar's title view, because a host sized to its contents drew at
 * no size at all in the native stack's title on iOS 27.
 */
export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  return (
    <Host matchContents>
      <WorkspaceSwitcherItem {...props} look={SWITCHER_LOOK.TILE} />
    </Host>
  );
}

/** The list's act that makes a workspace, as the panel words it. */
export function newWorkspaceAction(onPress: () => void): SwitcherAction {
  return { label: WORKSPACE_SWITCHER_WORDS.NEW_WORKSPACE, symbol: "plus", onPress };
}
