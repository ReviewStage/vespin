// split-view.tsx -- a regular window's columns side by side, as SwiftUI's own NavigationSplitView: the list and the detail, each column under a bar of its own.

import {
  Divider,
  HStack,
  Menu,
  NavigationDestination,
  NavigationSplitView,
  NavigationStack,
  RNHostView,
  Button as SwiftUIButton,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  containerBackground,
  disabled,
  frame,
  ignoreSafeArea,
  type ModifierConfig,
  menuIndicator,
  menuStyle,
  navigationSplitViewStyle,
  navigationTitle,
  overlay,
  searchable,
  toolbarTitleDisplayMode,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { Fragment, memo, type ReactElement, type ReactNode, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BarContent } from "./bar-content.js";
import { type BarSubtitle, ColumnBarTitle } from "./bar-title.js";
import type { Glyph } from "./glyph.js";
import { actContent, menuActContent, menuLabel } from "./glyph-label.js";
import { choiceContent, type MenuChoice } from "./list-row.js";
import { PathTitle } from "./thread-page.js";
import { useColors } from "./tokens/colors.js";

const layers = StyleSheet.create({
  fill: { flex: 1 },
});

/**
 * A bar menu's trigger as its glyph alone, with no button of its own, so the
 * bar's glass is the one layer around it. Note that `@expo/ui` hands a
 * `ToolbarItem` its menu inside a view of its own, so SwiftUI doesn't place
 * the menu as a bar item and draws its own round button inside the bar's
 * glass, where Mail's ⋯ stands in the bar's glass alone.
 */
export const BAR_ITEM_MENU = [menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")];

/** An act a bar holds by its symbol alone, such as Settings, or by its words where it has no symbol, such as a Select mode's Done. */
export type BarAction = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  /** Whether it stands dimmed, as a page's acts do while nothing is picked, rather than leaving the bar. */
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/** An act a menu holds, by its words and its glyph. */
export type BarMenuAction = {
  readonly label: string;
  /** Its glyph; none for an act that stands as words alone, such as a reminder's time. */
  readonly symbol?: Glyph | undefined;
  /** What the menu says under its words, such as when a reminder's time comes due. */
  readonly detail?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Whether the act takes something away for good, such as Permanently delete, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
};

/** One group of a menu's acts, set apart from the rest by the system's rule, as Mail's ⋯ groups Reply apart from Move: its acts, then the menus within it. */
export type BarMenuGroup = {
  readonly actions: readonly BarMenuAction[];
  readonly submenus?: readonly BarMenu[] | undefined;
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
 * What a column's bar holds: its title, small and inline as every screen's
 * stands, which the back button and the reader name it by; what leads it
 * (a SwiftUI view such as the workspace switcher), a page's path in its
 * middle, its menu and its act at its trailing edge, such as Select mode's
 * Done, a search field over its list, and the acts at its foot, in its
 * bottom bar.
 */
export type ColumnBar = {
  readonly title?: string | undefined;
  /** A pushed page's name, small and inline in the ink, as a compact window's stack names an agent's page; never with a `title`. */
  readonly name?: string | undefined;
  /** A muted line under the page's `name`, such as an agent's state and model, standing with it in the bar's middle; never without a `name`. */
  readonly subtitle?: BarSubtitle | undefined;
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
  /** The pages pushed over the detail inside its own column, with a Back of its own, as Mail opens a message's related pages; the detail stands alone where none is given. */
  readonly detailStack?: DetailStack | undefined;
};

/** One page pushed over a split view's detail, by the key its stack's path names it by, drawn by its `DetailPage`. */
export type DetailStackPage = { readonly key: string; readonly view: ReactNode };

/** How long a detail's stack stands after its last page is popped, a little past UIKit's own pop, before the plain column takes its place. */
const POP_SETTLE_MS = 500;

/**
 * The pages pushed over a split view's detail, oldest first: the path of
 * their keys, each page by its key, and what is called as the stack moves
 * by itself, with Back or a swipe back, with the path left standing.
 */
export type DetailStack = {
  readonly pages: readonly DetailStackPage[];
  readonly onPathChange: (path: readonly string[]) => void;
};

/** What a group is told apart by, since it has no name of its own: the words of its first act, or of its first menu. */
export function groupKey(group: BarMenuGroup): string {
  return group.actions[0]?.label ?? group.submenus?.[0]?.label ?? "";
}

/** A menu's acts and the menus within it, as SwiftUI's buttons and menus. */
function MenuActs({ group }: { readonly group: BarMenuGroup }) {
  return (
    <>
      {group.actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          {...menuActContent(action.label, action.symbol, action.detail)}
          onPress={action.onPress}
          modifiers={[disabled(action.disabled === true)]}
          {...(action.destructive === true ? { role: "destructive" } : {})}
        />
      ))}
      {(group.submenus ?? []).map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
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
      <MenuActs group={menu} />
      {(menu.groups ?? []).map((group) => (
        <Fragment key={groupKey(group)}>
          <Divider />
          <MenuActs group={group} />
        </Fragment>
      ))}
    </Menu>
  );
});

/** A bar's menu standing in its bar, such as a column's ⋯, its glyph alone in the bar's glass. */
export function BarMenuItem({ menu }: { readonly menu: BarMenu }) {
  return <BarMenuButton menu={menu} modifiers={BAR_ITEM_MENU} />;
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

  const kept = (group: BarMenuGroup): BarMenuGroup => ({
    actions: group.actions.filter((action) => !barred.has(action.label)),
    submenus: group.submenus?.filter((submenu) => !barred.has(submenu.label)),
  });

  const groups = menu.groups
    ?.map(kept)
    .filter((group) => group.actions.length > 0 || (group.submenus ?? []).length > 0);

  return { ...menu, ...kept(menu), groups };
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
    (bar.name !== undefined && bar.subtitle !== undefined) ||
    bar.menu !== undefined ||
    bar.action !== undefined ||
    (bar.foot ?? []).length > 0
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
  stacked: inStack = false,
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
  /** Whether it is the first column, whose search the system stands in the sidebar's own place. */
  readonly sidebar?: boolean | undefined;
  /** Whether it stands inside the detail's own navigation stack, as its root or a page pushed over it, whose ground the stack paints too. */
  readonly stacked?: boolean | undefined;
}) {
  const colors = useColors();
  const text = useSearchWords(bar.search);
  // Note that the list ends in a hairline beside the detail, as Mail's message list does, because both columns paint one ground and the system's sidebar column draws no edge of its own.
  const ruled = sidebar;

  const stacked = (
    <ZStack
      modifiers={[
        // Note that the column paints its ground itself, filling it under its bar too, because the shots showed `containerBackground` leaving a dark column at the system's black beside the list's ground, where Mail paints its columns one ground.
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
        background(colors.GROUND),
        // Note that a page in the detail's own stack paints the stack's ground too, because a navigation stack stands the system's own color behind each of its pages.
        ...(inStack ? [containerBackground(colors.GROUND, "navigation")] : []),
        // Note that the list keeps its title small in the middle, because its 320 pt bar also holds the switcher, ⋯ and the sidebar button, and a leading title folds them into an overflow. A page pushed over the detail names itself small and inline, as a stack's page does. A column with no title, such as a page under its path, keeps its bar inline too, because iPadOS 26 otherwise holds an empty large-title band under it.
        ...(bar.title !== undefined
          ? [
              navigationTitle(bar.title),
              toolbarTitleDisplayMode(sidebar ? "inline" : "inlineLarge"),
            ]
          : bar.name !== undefined
            ? [navigationTitle(bar.name), toolbarTitleDisplayMode("inline")]
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
        {bar.name === undefined || bar.subtitle === undefined ? null : (
          <ToolbarItem placement="principal">
            <ColumnBarTitle title={bar.name} subtitle={bar.subtitle} />
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
 * The detail column as a navigation stack of its own, as Mail opens a
 * message's related pages inside its detail with a Back there: the detail
 * at its root under the detail's bar, and each page pushed over it under
 * the bar its `DetailPage` draws, so each page's items belong to its own
 * view and the root's stand again as Back returns to it. Note that the bars
 * stand inside the stack, never around it, because a bar around a stack
 * stands over the stack's own and draws twice. Note that every page on the
 * path stays drawn, each by its key, so a page pushed already carries its
 * bar as it slides in and one swiped half back stands as it was.
 */
function DetailStackColumn({
  stack,
  root,
  rootBar,
}: {
  readonly stack: DetailStack;
  readonly root: ReactNode;
  readonly rootBar: ColumnBar | undefined;
}) {
  const { pages, onPathChange } = stack;
  const empty = pages.length === 0;
  // The pages last pushed, kept mounted while the stack finishes popping them.
  const [held, hold] = useState(pages);
  // Whether the last pop has had time to finish, so the plain column may take the stack's place.
  const [settled, settle] = useState(empty);

  if (!empty && held !== pages) hold(pages);

  if (!empty && settled) settle(false);

  useEffect(() => {
    if (!empty) return;
    const timer = setTimeout(() => settle(true), POP_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [empty]);

  // Note that a detail with nothing pushed over it stands as a plain column, since a thread's React Native hosts drew no words as a stack's root; the stack stands on through a pop, its pages still mounted, because SwiftUI writes the emptied path as the pop starts, and taking the stack out then left the column on the popped page's bar with no root.
  if (empty && settled) return <Column view={root} bar={rootBar} />;

  return (
    <NavigationStack path={pages.map((page) => page.key)} onPathChange={onPathChange}>
      <Column view={root} bar={rootBar} stacked />
      {(empty ? held : pages).map((page) => (
        <NavigationDestination key={page.key} value={page.key}>
          {page.view}
        </NavigationDestination>
      ))}
    </NavigationStack>
  );
}

/**
 * A page pushed over a split view's detail (`DetailStack`), such as an
 * agent's or a pull request's, under its own bar: its name or its path,
 * its main acts and its ⋯, with the stack's Back at its leading edge, where
 * the detail's root stands Mail's expand and compose. A screen draws the
 * same page here that a compact window's stack pushes over the list.
 */
export function DetailPage({
  bar,
  children,
  foot,
  asks,
}: {
  readonly bar: ColumnBar;
  readonly children: ReactNode;
  /** What stands at the page's foot under its content, such as an agent's composer (`ComposerFoot`). */
  readonly foot?: ReactNode | undefined;
  /** The system's alerts the page asks in, such as `ConfirmAsk`, which are React Native hosts of their own. */
  readonly asks?: ReactNode | undefined;
}) {
  const page =
    foot === undefined ? (
      children
    ) : (
      <VStack spacing={0}>
        {children}
        {foot}
      </VStack>
    );

  return (
    <Column
      view={
        asks === undefined ? (
          page
        ) : (
          <>
            {page}
            {/* Note that the alerts stand in a React Native host as small as they are, because each is a host of its own, drawn in React Native's tree. */}
            <RNHostView matchContents>
              <View>{asks}</View>
            </RNHostView>
          </>
        )
      }
      bar={bar}
      stacked
    />
  );
}

/**
 * React Native views filling a SwiftUI column, such as an agent's
 * transcript or a page's web view, which size themselves to the space they
 * stand in rather than to what they hold.
 */
export function HostedFill({ children }: { readonly children: ReactNode }) {
  return (
    <RNHostView>
      <View style={layers.fill}>{children}</View>
    </RNHostView>
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
  detailStack,
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
        {detailStack === undefined ? (
          <Column view={detail} bar={detailBar} />
        ) : (
          <DetailStackColumn stack={detailStack} root={detail} rootBar={detailBar} />
        )}
      </NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}
