// split-view.tsx -- a regular window's columns, each under a bar of its own: the list and the detail side by side, as SwiftUI's own NavigationSplitView, or on an iPad each in a column of the system's split view at the root, its sidebar, its list, and its page.

import {
  Divider,
  Host,
  HStack,
  Image,
  Menu,
  NavigationSplitView,
  NavigationStack,
  Section,
  Button as SwiftUIButton,
  Text,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
  ZStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  ignoreSafeArea,
  labelStyle,
  lineLimit,
  type ModifierConfig,
  menuIndicator,
  menuStyle,
  navigationSplitViewColumnWidth,
  navigationSplitViewStyle,
  navigationTitle,
  overlay,
  searchable,
  tint,
  toolbarTitleDisplayMode,
} from "@expo/ui/swift-ui/modifiers";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import type { TaskStatus } from "@repo/features/task-wire";
import { Fragment, memo, type ReactElement, type ReactNode, useEffect } from "react";
import { useScaledSize } from "./accessibility.js";
import { BarContent } from "./bar-content.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent, menuActContent, menuLabel } from "./glyph-label.js";
import { choiceContent, type MenuChoice } from "./list-row.js";
import { MANAGER_FACE_SEAT, ManagerFace, TaskStatusMark } from "./marks.js";
import type { MenuLead } from "./row-menu-model.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/**
 * A bar menu's trigger as its glyph alone, with no button of its own, so the
 * bar's glass is the one layer around it. Note that `@expo/ui` hands a
 * `ToolbarItem` its menu inside a view of its own, so SwiftUI doesn't place
 * the menu as a bar item and draws its own round button inside the bar's
 * glass, where Mail's ⋯ stands in the bar's glass alone.
 */
export const BAR_ITEM_MENU = [menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")];

/**
 * How wide a split view's list column stands, as Mail's message list does:
 * the system's own 320 pt at first, and dragged by its divider between the
 * narrowest its rows still read in and the widest that leaves the detail
 * room, as iPadOS 26 lets a person resize a split view's columns.
 */
const LIST_COLUMN_WIDTH = { min: 280, ideal: 320, max: 480 } as const;

/** What parts a thread's path, as the panel's crumbs part a task from its agent. */
export const PATH_PART = " › ";

/** An act a bar holds by its symbol alone, such as Settings, or by its words where it has no symbol, such as a Select mode's Done. */
export type BarAction = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  /** Whether it stands dimmed, as a page's acts do while nothing is picked, rather than leaving the bar. */
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/** An act a menu holds, by its words and what leads it: its glyph, or the mark of the entity it opens, such as Open task's status ring; none for an act that stands as words alone, such as a reminder's time. */
export type BarMenuAction = MenuLead & {
  readonly label: string;
  /** What the menu says under its words, such as when a reminder's time comes due. */
  readonly detail?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Whether the act takes something away for good, such as Permanently delete, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
};

/** One entry of a menu's group: an act, or a menu within it, such as Move to. */
export type BarMenuEntry = BarMenuAction | BarMenu;

/** Whether a group's entry is a menu within it rather than one act. */
export function isMenuEntry(entry: BarMenuEntry): entry is BarMenu {
  return "actions" in entry;
}

/**
 * One group of a menu, set apart from the rest by the system's rule, as
 * Mail's ⋯ groups Reply apart from Move: its switches, such as a list's Show
 * sub-tasks, checked as the system checks them, then its entries, acts and
 * menus within it, in the order they stand, as SwiftUI's menu takes its
 * children, such as an agent's Move to before its Archive.
 */
export type BarMenuGroup = {
  /** What heads the group, as a compact thread's ⋯ heads its task and agent with the thread's path; a rule alone where none is given. */
  readonly title?: string | undefined;
  readonly choices?: readonly MenuChoice[] | undefined;
  readonly items: readonly BarMenuEntry[];
};

/**
 * A bar's menu, as a list's View options: the choices one of which is on,
 * such as a list's scopes, checked as the system checks them, and the acts
 * under them, such as Mark all as read; then each of its `groups`, set
 * apart by a rule, the one way a menu groups its acts.
 */
export type BarMenu = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly choices: readonly MenuChoice[];
  readonly actions: readonly BarMenuAction[];
  /** Menus within it, after its acts, such as a task's Status. */
  readonly submenus?: readonly BarMenu[] | undefined;
  /** Whether the menu stands dimmed and opens on nothing, as a bar's act does while it can't act. */
  readonly disabled?: boolean | undefined;
  /** Groups after its acts and menus, each set apart by a rule, such as a task's ⋯ setting Permanently delete apart. */
  readonly groups?: readonly BarMenuGroup[] | undefined;
};

/** Whether a group holds anything to draw: an entry or a switch. */
function holds(group: BarMenuGroup): boolean {
  return group.items.length > 0 || (group.choices ?? []).length > 0;
}

/** Whether a menu holds anything over its groups: a choice, an act, or a menu within it. */
function headHolds(menu: BarMenu): boolean {
  return menu.choices.length > 0 || menu.actions.length > 0 || (menu.submenus ?? []).length > 0;
}

/**
 * A menu of groups, each set apart by the system's rule, as a page's ⋯ groups
 * its acts in the panel's order: the groups that hold anything, the first at
 * the menu's head and each after it behind a rule; none where no group holds
 * anything.
 */
export function menuOfGroups(
  label: string,
  symbol: Glyph,
  groups: readonly BarMenuGroup[],
): BarMenu | undefined {
  const held = groups.filter(holds);

  return held.length === 0 ? undefined : { label, symbol, choices: [], actions: [], groups: held };
}

/** A list's search, the system's field over its column: what it says before anything is typed, what is typed now, and what is called with each change. */
export type BarSearch = {
  readonly placeholder: string;
  /** The query the list is filtered by, which the field starts from wherever the list stands, so a list moved to another column keeps its words. */
  readonly text: string;
  readonly onChange: (text: string) => void;
};

/** A column's path, small and muted in its bar's middle, after its task's ring, as a pushed page's bar names it. */
export type BarPath = {
  readonly path: readonly string[];
  readonly status?: TaskStatus | undefined;
};

/**
 * What a column's bar holds: its title, large under the list's bar as a tab
 * root's stands and leading the detail's, which the back button and the
 * reader name it by; what leads it
 * (a SwiftUI view such as the workspace switcher), a page's path in its
 * middle, its menu and its act at its trailing edge, such as Select mode's
 * Done, a search field over its list, and the acts at its foot, in its
 * bottom bar.
 */
export type ColumnBar = {
  readonly title?: string | undefined;
  readonly leading?: ReactNode | undefined;
  /** Glyph acts at the bar's leading edge, sharing one glass, as Mail's expand and compose stand over a message. */
  readonly lead?: readonly BarAction[] | undefined;
  readonly path?: BarPath | undefined;
  /** A page's main acts as glyphs before its ⋯, as Mail's Reply and Trash stand, sharing the bar's one glass; each a button or a menu, such as Remind me's times. */
  readonly acts?: readonly BarFootItem[] | undefined;
  readonly menu?: BarMenu | undefined;
  readonly action?: BarAction | undefined;
  readonly search?: BarSearch | undefined;
  /** The acts at its foot, each a button or a menu, such as Select mode's Remind me. */
  readonly foot?: readonly BarFootItem[] | undefined;
};

/** What a bar's foot holds: an act, or a menu that opens from its glyph (from its words at a list column's foot), such as Remind me's times. */
export type BarFootItem = BarAction | BarMenu;

/** Whether a foot's item is a menu rather than one act. */
export function isBarMenu(item: BarFootItem): item is BarMenu {
  return "actions" in item;
}

type SplitViewProps = {
  /** The tab's list, such as the Inbox's threads, as a `RowList`. */
  readonly sidebar: ReactNode;
  readonly sidebarBar?: ColumnBar | undefined;
  /** The selected row's page, or an `EmptyState` before one is picked. */
  readonly detail: ReactNode;
  readonly detailBar?: ColumnBar | undefined;
  /** Whether the list stands beside the detail; hidden, the system's own button in the detail's bar brings it back. */
  readonly sidebarShown: boolean;
  /** Called as a person shows or hides the list, with the system's button, a swipe, or a drag. */
  readonly onSidebarShownChange: (shown: boolean) => void;
};

/** What a group is told apart by, since it has no name of its own: the words of its first entry, or of its first switch. */
export function groupKey(group: BarMenuGroup): string {
  return group.items[0]?.label ?? group.choices?.[0]?.label ?? "";
}

/** A menu's switches, acts, and the menus within it, as SwiftUI's toggles, buttons, and menus. */
function MenuActs({ group }: { readonly group: BarMenuGroup }) {
  const colors = useColors();

  return (
    <>
      {(group.choices ?? []).map((choice) => (
        <Toggle
          key={choice.id ?? choice.label}
          {...choiceContent(choice, colors)}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
      {group.items.map((entry) =>
        isMenuEntry(entry) ? (
          <BarMenuButton key={entry.label} menu={entry} />
        ) : (
          <SwiftUIButton
            key={entry.label}
            {...(entry.mark === undefined
              ? menuActContent(entry.label, entry.symbol, entry.detail)
              : choiceContent(entry, colors))}
            onPress={entry.onPress}
            modifiers={[disabled(entry.disabled === true)]}
            {...(entry.destructive === true ? { role: "destructive" } : {})}
          />
        ),
      )}
    </>
  );
}

/**
 * A bar's menu as SwiftUI's: each choice a toggle the system checks, then a
 * rule, then each act, then each group behind a rule of its own. Note that it
 * is drawn again only for a menu changed, because a menu of many choices,
 * such as one listing every open task, would otherwise build each of them
 * anew on every key typed beside it.
 */
export const BarMenuButton = memo(function BarMenuButton({
  menu,
  modifiers = [],
  worded = false,
}: {
  readonly menu: BarMenu;
  /** How the menu's trigger is drawn where it stands, such as in a bar; a submenu takes none. */
  readonly modifiers?: readonly ModifierConfig[] | undefined;
  /** Whether its trigger reads as its words alone rather than its glyph, as a list column's foot holds its acts. */
  readonly worded?: boolean | undefined;
}) {
  const colors = useColors();

  return (
    <Menu
      label={worded ? menu.label : menuLabel(menu.label, menu.symbol)}
      modifiers={[...modifiers, disabled(menu.disabled === true)]}
    >
      {menu.choices.map((choice) => (
        <Toggle
          key={choice.id ?? choice.label}
          {...choiceContent(choice, colors)}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
      {menu.actions.length === 0 ? null : <Divider />}
      <MenuActs group={{ items: [...menu.actions, ...(menu.submenus ?? [])] }} />
      {(menu.groups ?? []).map((group, at) =>
        group.title === undefined ? (
          <Fragment key={groupKey(group)}>
            {/* Note that a menu led by its first group, with nothing over it, draws no rule at its head. */}
            {at === 0 && !headHolds(menu) ? null : <Divider />}
            <MenuActs group={group} />
          </Fragment>
        ) : (
          <Section key={groupKey(group)} title={group.title}>
            <MenuActs group={group} />
          </Section>
        ),
      )}
    </Menu>
  );
});

/** A bar's menu standing in its bar, such as a column's ⋯, its glyph alone in the bar's glass. */
export function BarMenuItem({ menu }: { readonly menu: BarMenu }) {
  return <BarMenuButton menu={menu} modifiers={BAR_ITEM_MENU} />;
}

/**
 * A bar's menu standing in a compact window's stack bar, such as the Tasks
 * list's View options or a page's ⋯: SwiftUI's own menu, as a split view's
 * bar stands it (`BarMenuButton`), hosted as the bar's item, as the
 * workspace switcher stands beside it, so every choice leads with its own
 * mark, a status's ring in its tone or a person's photo, which the stack
 * bar's own menu, building UIKit's menu from a glyph's name alone, drew as
 * a gray template. Its trigger is its glyph alone, at the bar face's size,
 * in the bar's round glass, heard by its name.
 */
export function StackBarMenu({ menu }: { readonly menu: BarMenu }) {
  return (
    <Host matchContents>
      <BarMenuButton
        menu={menu}
        modifiers={[
          ...BAR_ITEM_MENU,
          labelStyle("iconOnly"),
          frame({ width: MARK_SIZE.BAR_FACE, height: MARK_SIZE.BAR_FACE }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          accessibilityLabel(menu.label),
        ]}
      />
    </Host>
  );
}

/** A bar act as SwiftUI's button, its symbol alone, heard by its words, or its words where it has no symbol or stands `worded`, dimmed while it can't act. */
function BarActionButton({
  action,
  worded = false,
}: {
  readonly action: BarAction;
  readonly worded?: boolean | undefined;
}) {
  return (
    <SwiftUIButton
      {...actContent(action.label, worded ? undefined : action.symbol)}
      onPress={action.onPress}
      modifiers={[disabled(action.disabled === true)]}
    />
  );
}

/**
 * A page's main acts as items of its bar's trailing edge, each its glyph
 * alone. Note that they stand as items side by side in one placement, so
 * iPadOS 26 draws them in one shared glass with the ⋯ after them, as Mail
 * groups Reply, Forward and Trash, never a glass of their own each.
 */
export function barActItems(acts: readonly BarFootItem[]): ReactElement[] {
  return acts.map((act) => (
    <ToolbarItem key={act.label} placement="topBarTrailing">
      {isBarMenu(act) ? <BarMenuItem menu={act} /> : <BarActionButton action={act} />}
    </ToolbarItem>
  ));
}

/** A menu with the acts and menus a bar already stands as glyphs left out, so ⋯ holds only the rest, and a group left empty drops with its rule. */
export function menuWithout(menu: BarMenu, acts: readonly BarFootItem[]): BarMenu {
  const barred = new Set(acts.map((act) => act.label));

  const groups = menu.groups
    ?.map((group) => ({ ...group, items: group.items.filter((entry) => !barred.has(entry.label)) }))
    .filter(holds);

  return {
    ...menu,
    actions: menu.actions.filter((action) => !barred.has(action.label)),
    submenus: menu.submenus?.filter((submenu) => !barred.has(submenu.label)),
    groups,
  };
}

/**
 * A search field's words as the system's field holds them, started from the
 * query its list is filtered by. Note that the field is handed a query only
 * as its search first arrives, so typing never fights its own echo.
 */
function useSearchWords(search: BarSearch | undefined) {
  const text = useNativeState(search?.text ?? "");
  const query = search?.text ?? "";
  const searching = search !== undefined;

  useEffect(() => {
    text.set(query);
  }, [searching]);

  return text;
}

/** Whether a bar holds anything for the toolbar to draw. */
function barHolds(bar: ColumnBar): boolean {
  return (
    bar.leading !== undefined ||
    (bar.lead ?? []).length > 0 ||
    (bar.acts ?? []).length > 0 ||
    bar.path !== undefined ||
    bar.menu !== undefined ||
    bar.action !== undefined ||
    (bar.foot ?? []).length > 0
  );
}

/**
 * A split view's detail column's bar: a page's path, small and muted after
 * its task's ring, in the bar's middle, as a compact window's stack draws it
 * in its own bar. Given what it opens, the path is a menu of them under a
 * small chevron, as iOS's own title menus stand, so a thread leads to its
 * task and its agent as the panel's crumbs do.
 */
export function PathTitle({
  path,
  status,
  manager,
  actions = [],
  wrap = false,
}: {
  /** Where the page stands, its task and then its agent, as the panel's crumbs name them. */
  readonly path: readonly string[];
  /** The status of the task it stands in, its ring leading the path; none for an agent's own page. */
  readonly status?: TaskStatus | undefined;
  /** The face of the Manager it stands under, on no task, leading the path among its words; none for a task's. */
  readonly manager?: ManagerFaceValue | undefined;
  readonly actions?: BarMenu["actions"] | undefined;
  /** Whether the words wrap rather than cut to one line, as where the path heads the page rather than standing in a bar. */
  readonly wrap?: boolean | undefined;
}) {
  const colors = useColors();
  const words = path.join(PATH_PART);
  const faceSize = useScaledSize(MARK_SIZE.GLYPH);

  const title = (
    <HStack spacing={SPACE.TIGHT + 2}>
      {manager !== undefined ? (
        <ManagerFace face={manager} size={faceSize} seat={MANAGER_FACE_SEAT.WORDS} />
      ) : status === undefined ? null : (
        <TaskStatusMark status={status} />
      )}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
          foregroundStyle(colors.TEXT_MUTED),
          ...(wrap ? [] : [lineLimit(1)]),
        ]}
      >
        {words}
      </Text>
      {actions.length === 0 ? null : (
        <Image
          {...glyphImage(GLYPH.UNFOLDED)}
          size={MARK_SIZE.GLYPH - 4}
          color={colors.TEXT_MUTED}
          modifiers={[accessibilityHidden(true)]}
        />
      )}
    </HStack>
  );

  if (actions.length === 0) return title;

  return (
    // Note that the menu takes a bar item's plain look, so the bar's glass is the one layer around the path, as the ⋯ stands.
    <Menu label={title} modifiers={[...BAR_ITEM_MENU, accessibilityLabel(words)]}>
      {actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          {...(action.mark === undefined
            ? actContent(action.label, action.symbol)
            : choiceContent(action, colors))}
          onPress={action.onPress}
          modifiers={[disabled(action.disabled === true)]}
        />
      ))}
    </Menu>
  );
}

/**
 * A column under its bar: its view in a `ZStack`, then the bar's items, then
 * its search where it has one. Note that the view stands in a `ZStack`,
 * because a column lays several children out one above another, so a sheet
 * or an alert a screen draws beside a column's page would otherwise take
 * half its height. The list and detail columns stand on the brand's
 * `GROUND`, as their lists do, so what isn't a list (a page, an empty state,
 * a scope picker over its list) never shows the system's own column color;
 * the list paints its ground, as Mail's message list stands solid beside
 * the message.
 */
function Column({
  view,
  bar = {},
  sidebar = false,
  system = false,
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
  /** Whether it is the first column, whose search the system stands in the sidebar's own place. */
  readonly sidebar?: boolean | undefined;
  /** Whether it stands in a column of UIKit's split view, which draws the columns' edges and widths itself. */
  readonly system?: boolean | undefined;
}) {
  const colors = useColors();
  const text = useSearchWords(bar.search);
  // Note that the list ends in a hairline beside the detail, as Mail's message list does, because both columns paint one ground and the system's sidebar column draws no edge of its own; a column of UIKit's split view stands its own edge.
  const ruled = sidebar && !system;

  const stacked = (
    <ZStack
      modifiers={[
        // Note that the column paints its ground itself, filling it under its bar too, because the shots showed `containerBackground` leaving a dark column at the system's black beside the list's ground, where Mail paints its columns one ground.
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
        background(colors.GROUND),
        // Note that the list column is drawn at its own width, which a person drags its divider within, rather than the system's fixed one.
        ...(ruled ? [navigationSplitViewColumnWidth(LIST_COLUMN_WIDTH)] : []),
        // Note that the list stands its title large under its bar, collapsing into it as the list scrolls, as Mail's list column does, rather than leading the bar (`inlineLarge`), because its 320 pt bar also holds the switcher, ⋯ and the sidebar button, and a leading title folds them into an overflow. A column with no title, such as a page under its path, keeps its bar inline, because iPadOS 26 otherwise holds an empty large-title band under it.
        ...(bar.title !== undefined
          ? [navigationTitle(bar.title), toolbarTitleDisplayMode(sidebar ? "large" : "inlineLarge")]
          : [toolbarTitleDisplayMode("inline")]),
      ]}
    >
      {ruled ? (
        <HStack spacing={0}>
          <ZStack>{view}</ZStack>
          {/* Note that the rule runs the column's whole height, under its bar and over the home indicator, as the column's ground does and Mail's rule does. */}
          <Divider
            modifiers={[
              overlay({ color: colors.CHIP_EDGE }),
              ignoreSafeArea({ edges: "vertical" }),
            ]}
          />
        </HStack>
      ) : (
        view
      )}
    </ZStack>
  );

  const barred = !barHolds(bar) ? (
    stacked
  ) : (
    <Toolbar>
      {stacked}
      <BarContent>
        {bar.leading === undefined ? null : (
          <ToolbarItem placement="topBarLeading">{bar.leading}</ToolbarItem>
        )}
        {(bar.lead ?? []).map((act) => (
          <ToolbarItem key={act.label} placement="topBarLeading">
            <BarActionButton action={act} />
          </ToolbarItem>
        ))}
        {bar.path === undefined ? null : (
          <ToolbarItem placement="principal">
            <PathTitle path={bar.path.path} status={bar.path.status} />
          </ToolbarItem>
        )}
        {barActItems(bar.acts ?? [])}
        {bar.action === undefined ? null : (
          <ToolbarItem placement="topBarTrailing">
            <BarActionButton action={bar.action} />
          </ToolbarItem>
        )}
        {bar.menu === undefined ? null : (
          <ToolbarItem placement="topBarTrailing">
            <BarMenuItem menu={bar.menu} />
          </ToolbarItem>
        )}
        {/* Note that a column's foot holds its acts by their words, as Files' and Mail's edit bars do on an iPad, since a regular window has the room and a bare glyph there left Mark as read, Remind me and Resolve to be guessed. */}
        {(bar.foot ?? []).map((item) => (
          <ToolbarItem key={item.label} placement="bottomBar">
            {isBarMenu(item) ? (
              <BarMenuButton menu={item} modifiers={BAR_ITEM_MENU} worded />
            ) : (
              <BarActionButton action={item} worded />
            )}
          </ToolbarItem>
        ))}
      </BarContent>
    </Toolbar>
  );

  if (bar.search === undefined) return barred;

  return (
    <Toolbar
      modifiers={[
        searchable(text, {
          // Note that a list's field stands in its own column's bar, under its title, as Mail's list holds its search, so the detail's bar stays the page's alone and is empty while nothing is picked.
          placement: sidebar ? "sidebar" : "navigationBarDrawer",
          prompt: bar.search.placeholder,
          onChange: bar.search.onChange,
        }),
      ]}
    >
      {barred}
    </Toolbar>
  );
}

/**
 * A tab's columns in a regular-width window, such as an iPad's or the
 * unfolded iPhone Duo's, beside the system's own tab sidebar, as Mail
 * stands its message list beside the message: the tab's list and the
 * selected row's page. The split view draws each column's navigation bar
 * itself, so the screen around it shows no header of its own. Whether the
 * list stands is the caller's, so a menu bar's command can toggle it and a
 * person's choice holds as the tabs change; hidden, the page stands alone
 * across the window.
 */
export function SplitView({
  sidebar,
  sidebarBar,
  detail,
  detailBar,
  sidebarShown,
  onSidebarShownChange,
}: SplitViewProps) {
  return (
    <NavigationSplitView
      // Note that a two-column split view names both columns standing "doubleColumn", which is its "all".
      columnVisibility={sidebarShown ? "all" : "detailOnly"}
      onColumnVisibilityChange={(visibility) => {
        if (visibility === "automatic") return;

        onSidebarShownChange(visibility === "all" || visibility === "doubleColumn");
      }}
      modifiers={[navigationSplitViewStyle("balanced")]}
    >
      <NavigationSplitView.Sidebar>
        <Column view={sidebar} bar={sidebarBar} sidebar />
      </NavigationSplitView.Sidebar>
      <NavigationSplitView.Detail>
        <Column view={detail} bar={detailBar} />
      </NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}

/**
 * A page under its own bar in a column of the system's split view, as an
 * iPad stands the picked row's page beside its list: its view under its
 * column's bar, a title, a path, acts and a menu as a split view's detail
 * holds them.
 */
export function PageColumn({
  view,
  bar,
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
}) {
  return (
    <NavigationStack>
      <Column view={view} bar={bar} system />
    </NavigationStack>
  );
}

/**
 * A tab's list as the middle column of the system's own split view on an
 * iPad (UISplitViewController's supplementary column, between the sidebar
 * and the picked row's page), as Mail stands a mailbox's messages between
 * its mailboxes and the message: its rows under its bar, its title large,
 * its search, ⋯ and acts as a split view's list column holds them. It is
 * one SwiftUI host of its own, its bar its own navigation stack's.
 */
export function ListColumn({
  view,
  bar,
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
}) {
  const colors = useColors();

  return (
    <Host style={{ flex: 1 }} modifiers={[tint(colors.TEXT)]}>
      <NavigationStack>
        <Column view={view} bar={bar} sidebar system />
      </NavigationStack>
    </Host>
  );
}

/**
 * An iPad's sidebar as the content of the system's own sidebar column, the
 * first of its split view at the root, whose own bar holds its toggle: its
 * list alone, with no bar or ground of its own, so it stands on the
 * system's sidebar glass.
 */
export function SidebarColumn({ view }: { readonly view: ReactNode }) {
  const colors = useColors();

  return (
    // Note that the sidebar's list takes the brand's accent as its tint, which the system's own selection fills with, rather than the ink the screens take, which drew the selection a black capsule over its words.
    <Host style={{ flex: 1 }} modifiers={[tint(colors.ACCENT)]}>
      {view}
    </Host>
  );
}
