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
  containerBackground,
  disabled,
  navigationBarTitleDisplayMode,
  navigationSplitViewStyle,
  navigationTitle,
  searchable,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import type { ReactNode } from "react";
import type { SfSymbol } from "./sf-symbol.js";
import { PathTitle } from "./thread-page.js";
import { useColors } from "./tokens/colors.js";

/** What the first column holds, so it is drawn afresh as that changes. */
const FIRST_COLUMN = { APP_SIDEBAR: "app-sidebar", LIST: "list" } as const;

/** An act a bar holds by its symbol alone, such as Settings. */
export type BarAction = {
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly onPress: () => void;
};

/**
 * A bar's menu, as a list's View options: the choices one of which is on,
 * such as a list's scopes, checked as the system checks them, and the acts
 * under them, such as Mark all as read.
 */
export type BarMenu = {
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly choices: readonly {
    readonly label: string;
    readonly on: boolean;
    readonly onPress: () => void;
  }[];
  readonly actions: readonly {
    readonly label: string;
    readonly symbol: SfSymbol;
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
 * middle, its menu and its act at its trailing edge, a search field
 * over its list, and the acts at its foot, as an iPad's sidebar stands
 * Settings in its bottom bar.
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
  /** Whether the sidebar stands beside the other columns; hidden, the system's own button in the next column's bar brings it back. */
  readonly sidebarShown: boolean;
  /** Called as a person shows or hides the sidebar, with the system's button, a swipe, or a drag. */
  readonly onSidebarShownChange: (shown: boolean) => void;
};

/** A bar's menu as SwiftUI's: each choice a toggle the system checks, then a rule, then each act. */
export function BarMenuButton({ menu }: { readonly menu: BarMenu }) {
  return (
    <Menu label={menu.label} systemImage={menu.symbol}>
      {menu.choices.map((choice) => (
        <Toggle
          key={choice.label}
          label={choice.label}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
      {menu.actions.length === 0 ? null : <Divider />}
      {menu.actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          label={action.label}
          systemImage={action.symbol}
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

/** A bar act as SwiftUI's button, its symbol alone, heard by its words. */
function BarActionButton({ action }: { readonly action: BarAction }) {
  return (
    <SwiftUIButton label={action.label} systemImage={action.symbol} onPress={action.onPress} />
  );
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
}: {
  readonly view: ReactNode;
  readonly bar?: ColumnBar | undefined;
  /** Whether it is the sidebar, whose search the system stands in the sidebar's own place. */
  readonly sidebar?: boolean | undefined;
}) {
  const colors = useColors();
  const text = useNativeState(bar.search?.text ?? "");

  const stacked = (
    <ZStack
      modifiers={[
        ...(sidebar ? [] : [containerBackground(colors.GROUND, "navigationSplitView")]),
        ...(bar.title === undefined
          ? []
          : [navigationTitle(bar.title), navigationBarTitleDisplayMode("inline")]),
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
      <Toolbar.Content>
        {bar.leading === undefined ? null : (
          <ToolbarItem placement="topBarLeading">{bar.leading}</ToolbarItem>
        )}
        {bar.path === undefined ? null : (
          <ToolbarItem placement="principal">
            <PathTitle path={bar.path.path} status={bar.path.status} />
          </ToolbarItem>
        )}
        {bar.menu === undefined ? null : (
          <ToolbarItem placement="topBarTrailing">
            <BarMenuButton menu={bar.menu} />
          </ToolbarItem>
        )}
        {bar.action === undefined ? null : (
          <ToolbarItem placement="topBarTrailing">
            <BarActionButton action={bar.action} />
          </ToolbarItem>
        )}
        {(bar.foot ?? []).map((action) => (
          <ToolbarItem key={action.label} placement="bottomBar">
            <BarActionButton action={action} />
          </ToolbarItem>
        ))}
      </Toolbar.Content>
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
  sidebarShown,
  onSidebarShownChange,
}: SplitViewProps) {
  const hidden = content === undefined ? "detailOnly" : "doubleColumn";

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
      modifiers={[navigationSplitViewStyle("balanced")]}
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
          <Column view={content} bar={contentBar} />
        </NavigationSplitView.Content>
      )}
      <NavigationSplitView.Detail>
        <Column view={detail} bar={detailBar} />
      </NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}
