// split-view.tsx -- a regular window's columns side by side, as SwiftUI's own NavigationSplitView: the app's sidebar, the list, and the detail, each column under a bar of its own.

import {
  Divider,
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
  accessibilityHidden,
  background,
  buttonStyle,
  containerBackground,
  disabled,
  frame,
  hidden,
  type ModifierConfig,
  menuIndicator,
  menuStyle,
  navigationSplitViewStyle,
  navigationTitle,
  searchable,
  toolbarTitleDisplayMode,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { type ReactElement, type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { BarContent } from "./bar-content.js";
import type { Scope } from "./button.js";
import { GLYPH, type Glyph } from "./glyph.js";
import { actContent, menuLabel } from "./glyph-label.js";
import { choiceColor, type MenuChoice } from "./list-row.js";
import { PathTitle } from "./thread-page.js";
import { useColors } from "./tokens/colors.js";

/** What the first column holds, so it is drawn afresh as that changes. */
const FIRST_COLUMN = { APP_SIDEBAR: "app-sidebar", LIST: "list" } as const;

/** Where the split view stands against the tabs' screens: over a tab's root, or behind the page a tab pushed over it. */
const LAYER = { FRONT: 1, BEHIND: 0 } as const;

/**
 * A tab root's stack options while the split view stands over it: no bar,
 * and no ground of its own, so the split view behind shows through it while
 * a pushed page slides in over it or is swiped back off it.
 */
export const UNDER_SPLIT_SCREEN = {
  headerShown: false,
  contentStyle: { backgroundColor: "transparent" },
} as const;

const layers = StyleSheet.create({
  stand: { flex: 1 },
  fill: { flex: 1 },
  tabs: { flex: 1 },
  split: { ...StyleSheet.absoluteFill },
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

/**
 * A bar's menu, as a list's View options: the choices one of which is on,
 * such as a list's scopes, checked as the system checks them, and the acts
 * under them, such as Mark all as read.
 */
export type BarMenu = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly choices: readonly MenuChoice[];
  readonly actions: readonly {
    readonly label: string;
    readonly symbol: Glyph;
    readonly disabled?: boolean | undefined;
    /** Whether the act takes something away for good, such as Permanently delete, which the system draws red. */
    readonly destructive?: boolean | undefined;
    readonly onPress: () => void;
  }[];
  /** Menus within it, after its acts, such as a task's Status. */
  readonly submenus?: readonly BarMenu[] | undefined;
  /** Acts after its menus, past a rule, such as an agent's Permanently delete, which stands last. */
  readonly last?: BarMenu["actions"] | undefined;
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
 * middle, its menu and its act at its trailing edge, such as a list's
 * New task, a search field over its list, and the acts at its foot, in its
 * bottom bar.
 */
export type ColumnBar = {
  readonly title?: string | undefined;
  /** A pushed page's name, small and inline in the ink, as a compact window's stack names an agent's page; never with a `title`. */
  readonly name?: string | undefined;
  readonly leading?: ReactNode | undefined;
  /** Glyph acts at the bar's leading edge, sharing one glass, as Mail's expand and compose stand over a message. */
  readonly lead?: readonly BarAction[] | undefined;
  readonly path?: BarPath | undefined;
  /** A page's main acts as glyphs before its ⋯, as Mail's Reply and Trash stand, sharing the bar's one glass. */
  readonly acts?: readonly BarAction[] | undefined;
  /** A list's scopes as Mail's filter button before its ⋯, where the column is too narrow for segments. */
  readonly filter?: BarMenu | undefined;
  readonly menu?: BarMenu | undefined;
  readonly action?: BarAction | undefined;
  readonly search?: BarSearch | undefined;
  readonly foot?: readonly BarAction[] | undefined;
};

type SplitViewProps = {
  /** The app's sidebar: its places, then Pinned and the member's sections, as a `RowList` in its sidebar look. */
  readonly sidebar: ReactNode;
  readonly sidebarBar?: ColumnBar | undefined;
  /** The list between the sidebar and the detail, such as the Inbox's threads; two columns where none is given. */
  readonly content?: ReactNode | undefined;
  readonly contentBar?: ColumnBar | undefined;
  /** The selected row's page, or an `EmptyState` before one is picked. */
  readonly detail: ReactNode;
  readonly detailBar?: ColumnBar | undefined;
  /** Names whose search the list's bar holds, such as the place the app sidebar picked, so the field takes that list's own query as it changes. */
  readonly searchKey?: string | undefined;
  /** Whether the sidebar stands beside the other columns; hidden, the system's own button in the next column's bar brings it back. */
  readonly sidebarShown: boolean;
  /** Called as a person shows or hides the sidebar, with the system's button, a swipe, or a drag. */
  readonly onSidebarShownChange: (shown: boolean) => void;
  /** Whether the detail stands alone across the window, as Mail's expand button stands a message; the other columns keep their own choice under it. */
  readonly detailOnly?: boolean | undefined;
  /** Called as the detail stops standing alone, such as when a person brings the columns back with the system's sidebar button. */
  readonly onDetailOnlyChange?: ((detailOnly: boolean) => void) | undefined;
  /** The pages pushed over the detail inside its own column, with a Back of its own, as Mail opens a message's related pages; the detail stands alone where none is given. */
  readonly detailStack?: DetailStack | undefined;
};

/** One page pushed over a split view's detail, by the key its stack's path names it by, drawn by its `DetailPage`. */
export type DetailStackPage = { readonly key: string; readonly view: ReactNode };

/**
 * The pages pushed over a split view's detail, oldest first: the path of
 * their keys, each page by its key, and what is called as the stack moves
 * by itself, with Back or a swipe back, with the path left standing.
 */
export type DetailStack = {
  readonly pages: readonly DetailStackPage[];
  readonly onPathChange: (path: readonly string[]) => void;
};

/** One act of a bar's menu as SwiftUI's button, red where it takes something away for good. */
function MenuAct({ action }: { readonly action: BarMenu["actions"][number] }) {
  return (
    <SwiftUIButton
      {...actContent(action.label, action.symbol)}
      onPress={action.onPress}
      modifiers={[disabled(action.disabled === true)]}
      {...(action.destructive === true ? { role: "destructive" } : {})}
    />
  );
}

/** A bar's menu as SwiftUI's: each choice a toggle the system checks, then a rule, then each act. */
export function BarMenuButton({
  menu,
  modifiers = [],
}: {
  readonly menu: BarMenu;
  /** How the menu's trigger is drawn where it stands, such as in a bar; a submenu takes none. */
  readonly modifiers?: readonly ModifierConfig[] | undefined;
}) {
  const colors = useColors();

  return (
    <Menu label={menuLabel(menu.label, menu.symbol)} modifiers={[...modifiers]}>
      {menu.choices.map((choice) => (
        <Toggle
          key={choice.label}
          {...actContent(choice.label, choice.symbol, undefined, choiceColor(choice, colors))}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
      {menu.actions.length === 0 ? null : <Divider />}
      {menu.actions.map((action) => (
        <MenuAct key={action.label} action={action} />
      ))}
      {(menu.submenus ?? []).map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
      {(menu.last ?? []).length === 0 ? null : <Divider />}
      {(menu.last ?? []).map((action) => (
        <MenuAct key={action.label} action={action} />
      ))}
    </Menu>
  );
}

/** A bar's menu standing in its bar, such as a column's ⋯, its glyph alone in the bar's glass. */
export function BarMenuItem({ menu }: { readonly menu: BarMenu }) {
  return <BarMenuButton menu={menu} modifiers={BAR_ITEM_MENU} />;
}

/** A bar act as SwiftUI's button, its symbol alone, heard by its words, or its words where it has no symbol, dimmed while it can't act. */
function BarActionButton({ action }: { readonly action: BarAction }) {
  return (
    <SwiftUIButton
      {...actContent(action.label, action.symbol)}
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
export function barActItems(acts: readonly BarAction[]): ReactElement[] {
  return acts.map((act) => (
    <ToolbarItem key={act.label} placement="topBarTrailing">
      <BarActionButton action={act} />
    </ToolbarItem>
  ));
}

/**
 * A list's scopes as Mail's filter menu: each scope a choice, checked where
 * it stands, with its count only where it has one worth reading, so an empty
 * scope reads as its name alone. Note that the glyph fills while any scope
 * but the first stands, as Mail's does while a filter is on, since the bar
 * keeps no other word of which scope is shown.
 */
export function scopeMenu(label: string, scopes: readonly Scope[]): BarMenu {
  const narrowed = scopes.findIndex((scope) => scope.selected) > 0;

  return {
    label,
    symbol: narrowed ? GLYPH.FILTERED : GLYPH.FILTER,
    choices: scopes.map((scope) => ({
      label:
        scope.count === undefined || scope.count === 0
          ? scope.label
          : `${scope.label} ${scope.count}`,
      on: scope.selected,
      onPress: scope.onPress,
    })),
    actions: [],
  };
}

/** A menu with the acts a bar already stands as glyphs left out, so ⋯ holds only the rest. */
export function menuWithout(menu: BarMenu, acts: readonly BarAction[]): BarMenu {
  const barred = new Set(acts.map((act) => act.label));

  return { ...menu, actions: menu.actions.filter((action) => !barred.has(action.label)) };
}

/**
 * A search field's words as the system's field holds them, started from the
 * query its list is filtered by. Note that the field is handed a query only
 * as its search changes hands or first arrives, so typing never fights its
 * own echo.
 */
function useSearchWords(search: BarSearch | undefined, searchKey: string | undefined) {
  const text = useNativeState(search?.text ?? "");
  const query = search?.text ?? "";
  const searching = search !== undefined;

  useEffect(() => {
    text.set(query);
  }, [searchKey, searching]);

  return text;
}

/** Whether a bar holds anything for the toolbar to draw. */
function barHolds(bar: ColumnBar): boolean {
  return (
    bar.leading !== undefined ||
    (bar.lead ?? []).length > 0 ||
    (bar.acts ?? []).length > 0 ||
    bar.filter !== undefined ||
    bar.path !== undefined ||
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
 * a scope picker over its list) never shows the system's own column color.
 * The app's sidebar paints nothing, so it stands on the system's floating
 * glass pane, as Mail's and Notes' do; a list standing first in two columns,
 * as a portrait iPad's, paints its ground, as Mail's message list stands
 * solid beside the message.
 */
function Column({
  view,
  bar = {},
  sidebar = false,
  clear = false,
  searchKey,
  stacked: inStack = false,
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
  /** Whether it is the sidebar, whose search the system stands in the sidebar's own place. */
  readonly sidebar?: boolean | undefined;
  /** Whether it paints nothing, so it stands on the system's floating glass pane, as the app's own sidebar does. */
  readonly clear?: boolean | undefined;
  /** Names whose search the bar holds; the field takes that one's query as it changes, and keeps what is typed otherwise. */
  readonly searchKey?: string | undefined;
  /** Whether it stands inside the detail's own navigation stack, as its root or a page pushed over it, whose ground the stack paints too. */
  readonly stacked?: boolean | undefined;
}) {
  const colors = useColors();
  const text = useSearchWords(bar.search, searchKey);

  const stacked = (
    <ZStack
      modifiers={[
        // Note that the column paints its ground itself, filling it under its bar too, because the shots showed `containerBackground` leaving a dark column at the system's black beside the list's ground, where Mail paints its columns one ground.
        ...(clear
          ? []
          : [
              frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
              background(colors.GROUND),
            ]),
        // Note that a page in the detail's own stack paints the stack's ground too, because a navigation stack stands the system's own color behind each of its pages.
        ...(inStack ? [containerBackground(colors.GROUND, "navigation")] : []),
        // Note that a list beside the app sidebar names itself bold at its bar's leading edge, as Mail names the mailbox over its list; a list standing first, as a portrait iPad's, keeps its title small in the middle, because its 320 pt bar also holds the switcher, compose, ⋯ and the sidebar button, and a leading title folds them into an overflow. A page pushed over the detail names itself small and inline, as a stack's page does. A column with no title, such as a page under its path, keeps its bar inline too, because iPadOS 26 otherwise holds an empty large-title band under it.
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
      {view}
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
        {bar.filter === undefined ? null : (
          <ToolbarItem placement="topBarTrailing">
            <BarMenuItem menu={bar.filter} />
          </ToolbarItem>
        )}
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
        {(bar.foot ?? []).map((action) => (
          <ToolbarItem key={action.label} placement="bottomBar">
            <BarActionButton action={action} />
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

  return (
    <NavigationStack path={pages.map((page) => page.key)} onPathChange={onPathChange}>
      <Column view={root} bar={rootBar} stacked />
      {pages.map((page) => (
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
  /** The system's alerts the page asks in, such as `ConfirmAsk` and `RenameAsk`, which are React Native hosts of their own. */
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
 * The app's columns for a regular-width window, such as an iPad's or the
 * unfolded iPhone Duo's, as Mail and Files stand theirs: the app's sidebar,
 * the list it picked, and the selected row's page, or the sidebar and one
 * page where no list stands between them. The split view draws each
 * column's navigation bar itself, so the screen around it shows no header
 * of its own. Whether the sidebar stands is the caller's, so a window too
 * narrow for three columns can keep it behind the system's button, a menu
 * bar's command can toggle it, and a person's choice holds as the tabs
 * change; hidden, the list and the page share the window.
 */
export function SplitView({
  sidebar,
  sidebarBar,
  content,
  contentBar,
  detail,
  detailBar,
  searchKey,
  sidebarShown,
  onSidebarShownChange,
  detailOnly = false,
  onDetailOnlyChange,
  detailStack,
}: SplitViewProps) {
  const hidden = content === undefined ? "detailOnly" : "doubleColumn";

  return (
    <NavigationSplitView
      columnVisibility={detailOnly ? "detailOnly" : sidebarShown ? "all" : hidden}
      onColumnVisibilityChange={(visibility) => {
        // Note that a two-column split view names both columns standing "doubleColumn", which is its "all".
        if (visibility === "automatic") return;

        // Note that the detail standing alone leaves the sidebar's own choice as it was, and columns brought back by the system's button end it.
        if (detailOnly) {
          if (visibility !== "detailOnly") onDetailOnlyChange?.(false);

          return;
        }

        onSidebarShownChange(
          visibility === "all" || (content === undefined && visibility === "doubleColumn"),
        );
      }}
      modifiers={[navigationSplitViewStyle("balanced")]}
    >
      <NavigationSplitView.Sidebar>
        {/* Note that the sidebar column is drawn afresh as it changes from the app's sidebar to the list or back, so its search field starts from the list's query rather than keeping what the other held. */}
        <Column
          key={content === undefined ? FIRST_COLUMN.LIST : FIRST_COLUMN.APP_SIDEBAR}
          view={sidebar}
          bar={sidebarBar}
          sidebar
          clear={content !== undefined}
        />
      </NavigationSplitView.Sidebar>
      {content === undefined ? null : (
        <NavigationSplitView.Content>
          <Column view={content} bar={contentBar} searchKey={searchKey} />
        </NavigationSplitView.Content>
      )}
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

/** One of the views a column keeps, by the name it is shown under. */
export type KeptView = { readonly key: string; readonly view: ReactNode };

/**
 * A column's views, one shown and the rest kept drawn behind it, hidden and
 * out of VoiceOver's reach, as the iPad's Mail keeps each mailbox's list
 * scrolled where it was left: so the list a person comes back to stands as
 * they left it, scrolled, its rows folded or not, rather than drawn anew.
 */
export function KeptColumns({
  shown,
  views,
}: {
  readonly shown: string;
  readonly views: readonly KeptView[];
}) {
  return (
    <ZStack>
      {views.map(({ key, view }) => (
        <ZStack key={key} modifiers={[hidden(key !== shown), accessibilityHidden(key !== shown)]}>
          {view}
        </ZStack>
      ))}
    </ZStack>
  );
}

/**
 * The tabs' screens with one split view standing over them, as a window
 * wide enough for three columns stands its app sidebar, so a tab's switch
 * changes only the list and the detail beside a sidebar that stays where it
 * is. The split view stands in front while a tab's root stands, and behind
 * the tabs while a tab has pushed a page over its root, which slides in over
 * the split view, since the root under it draws nothing of its own; behind,
 * it takes no touch and VoiceOver passes over it. With no
 * split view, the tabs stand alone in the same place, so a rotation across
 * the line keeps every tab's stack.
 */
export function SplitOverTabs({
  tabs,
  split,
  front,
}: {
  readonly tabs: ReactNode;
  readonly split?: ReactNode | undefined;
  readonly front: boolean;
}) {
  const layer = front ? LAYER.FRONT : LAYER.BEHIND;

  return (
    <View style={layers.stand}>
      <View style={[layers.tabs, { zIndex: LAYER.FRONT - layer }]}>{tabs}</View>
      {split === undefined ? null : (
        <View
          style={[layers.split, { zIndex: layer }]}
          pointerEvents={front ? "auto" : "none"}
          accessibilityElementsHidden={!front}
        >
          {split}
        </View>
      )}
    </View>
  );
}
