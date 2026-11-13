// split-view.tsx -- a regular window's columns side by side, as SwiftUI's own NavigationSplitView: the app's sidebar, the list, and the detail, each column under a bar of its own.

import {
  Divider,
  Menu,
  NavigationSplitView,
  Button as SwiftUIButton,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  buttonStyle,
  containerBackground,
  disabled,
  hidden,
  type ModifierConfig,
  menuIndicator,
  menuStyle,
  navigationSplitViewStyle,
  navigationTitle,
  searchable,
  searchToolbarBehavior,
  toolbarTitleDisplayMode,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { BarContent } from "./bar-content.js";
import type { Glyph } from "./glyph.js";
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
  readonly leading?: ReactNode | undefined;
  readonly path?: BarPath | undefined;
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
};

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
        <SwiftUIButton
          key={action.label}
          {...actContent(action.label, action.symbol)}
          onPress={action.onPress}
          modifiers={[disabled(action.disabled === true)]}
          {...(action.destructive === true ? { role: "destructive" } : {})}
        />
      ))}
      {(menu.submenus ?? []).map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
    </Menu>
  );
}

/** A bar's menu standing in its bar, such as a column's ⋯, its glyph alone in the bar's glass. */
export function BarMenuItem({ menu }: { readonly menu: BarMenu }) {
  return <BarMenuButton menu={menu} modifiers={BAR_ITEM_MENU} />;
}

/** A bar act as SwiftUI's button, its symbol alone, heard by its words, or its words where it has no symbol. */
function BarActionButton({ action }: { readonly action: BarAction }) {
  return <SwiftUIButton {...actContent(action.label, action.symbol)} onPress={action.onPress} />;
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
 * The sidebar paints nothing, so it stands on the system's floating glass
 * pane, as Mail's and Notes' do.
 */
function Column({
  view,
  bar = {},
  sidebar = false,
  searchKey,
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
  /** Whether it is the sidebar, whose search the system stands in the sidebar's own place. */
  readonly sidebar?: boolean | undefined;
  /** Names whose search the bar holds; the field takes that one's query as it changes, and keeps what is typed otherwise. */
  readonly searchKey?: string | undefined;
}) {
  const colors = useColors();
  const text = useSearchWords(bar.search, searchKey);

  const stacked = (
    <ZStack
      modifiers={[
        ...(sidebar ? [] : [containerBackground(colors.GROUND, "navigationSplitView")]),
        // Note that a list beside the app sidebar names itself bold at its bar's leading edge, as Mail names the mailbox over its list; a list standing first, as a portrait iPad's, keeps its title small in the middle, because its 320 pt bar also holds the switcher, compose, ⋯ and the sidebar button, and a leading title folds them into an overflow.
        ...(bar.title === undefined
          ? []
          : [
              navigationTitle(bar.title),
              toolbarTitleDisplayMode(sidebar ? "inline" : "inlineLarge"),
            ]),
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
        {bar.path === undefined ? null : (
          <ToolbarItem placement="principal">
            <PathTitle path={bar.path.path} status={bar.path.status} />
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
          placement: sidebar ? "sidebar" : "automatic",
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
}: SplitViewProps) {
  const hidden = content === undefined ? "detailOnly" : "doubleColumn";
  // Note that with three columns the list's search stands in the window's toolbar, a button at its trailing edge, as Mail's does on iPadOS 26, rather than as a field under the list's title.
  const windowSearch = content === undefined ? undefined : contentBar?.search;
  const searchWords = useSearchWords(windowSearch, searchKey);
  const listBar = contentBar === undefined ? undefined : { ...contentBar, search: undefined };

  return (
    <NavigationSplitView
      columnVisibility={sidebarShown ? "all" : hidden}
      onColumnVisibilityChange={(visibility) => {
        // Note that a two-column split view names both columns standing "doubleColumn", which is its "all".
        if (visibility === "automatic") return;
        onSidebarShownChange(
          visibility === "all" || (content === undefined && visibility === "doubleColumn"),
        );
      }}
      modifiers={[
        navigationSplitViewStyle("balanced"),
        ...(windowSearch === undefined
          ? []
          : [
              searchable(searchWords, {
                placement: "toolbar",
                prompt: windowSearch.placeholder,
                onChange: windowSearch.onChange,
              }),
              searchToolbarBehavior("minimize"),
            ]),
      ]}
    >
      <NavigationSplitView.Sidebar>
        {/* Note that the sidebar column is drawn afresh as it changes from the app's sidebar to the list or back, so its search field starts from the list's query rather than keeping what the other held. */}
        <Column
          key={content === undefined ? FIRST_COLUMN.LIST : FIRST_COLUMN.APP_SIDEBAR}
          view={sidebar}
          bar={sidebarBar}
          sidebar
        />
      </NavigationSplitView.Sidebar>
      {content === undefined ? null : (
        <NavigationSplitView.Content>
          <Column view={content} bar={listBar} searchKey={searchKey} />
        </NavigationSplitView.Content>
      )}
      <NavigationSplitView.Detail>
        <Column view={detail} bar={detailBar} />
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
