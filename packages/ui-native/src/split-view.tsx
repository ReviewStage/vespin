// split-view.tsx -- a regular window's list and detail side by side, as SwiftUI's own NavigationSplitView, the sidebar's bar holding its acts, its menu, and its search, and the detail's its path and menu.

import {
  Divider,
  Menu,
  NavigationSplitView,
  type NavigationSplitViewVisibility,
  Button as SwiftUIButton,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
} from "@expo/ui/swift-ui";
import { navigationSplitViewStyle, searchable } from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { type ReactNode, useState } from "react";
import type { SfSymbol } from "./sf-symbol.js";
import { PathTitle } from "./thread-page.js";

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
    readonly onPress: () => void;
  }[];
  /** Menus within it, after its acts, such as a task's Status. */
  readonly submenus?: readonly BarMenu[] | undefined;
};

/** A list's search, the system's field in the sidebar: what it says before anything is typed, and what is called with each change. */
export type BarSearch = {
  readonly placeholder: string;
  readonly onChange: (text: string) => void;
};

type SplitViewProps = {
  /** The list, drawn as the sidebar column: a `RowList` in its sidebar look. */
  readonly sidebar: ReactNode;
  /** The selected row's page, or an `EmptyState` before one is picked. */
  readonly detail: ReactNode;
  /** An act in the sidebar's bar, by its symbol alone, such as Settings: what a compact window's header holds. */
  readonly sidebarAction?: BarAction | undefined;
  /** A menu in the sidebar's bar, such as the Inbox's View options. */
  readonly sidebarMenu?: BarMenu | undefined;
  /** A search field over the sidebar's list. */
  readonly sidebarSearch?: BarSearch | undefined;
  /**
   * A middle column between the sidebar and the detail, such as the tasks of
   * the group the sidebar picked, for a window wide enough to stand three
   * columns; two columns where none is given.
   */
  readonly content?: ReactNode | undefined;
  /** A menu in the detail's bar, such as a task's ⋯. */
  readonly detailMenu?: BarMenu | undefined;
  /** The detail's path, small and muted in its bar's middle, after its task's ring, as a pushed page's bar names it. */
  readonly detailPath?:
    | { readonly path: readonly string[]; readonly status?: TaskStatus | undefined }
    | undefined;
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
          {...(action.disabled === true ? { disabled: true } : {})}
        />
      ))}
      {(menu.submenus ?? []).map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
    </Menu>
  );
}

/** The sidebar's column: its list under the bar's acts and menu, and its search where it has one. */
function SidebarColumn({
  sidebar,
  sidebarAction,
  sidebarMenu,
  sidebarSearch,
}: Omit<SplitViewProps, "detail" | "content" | "detailMenu" | "detailPath">) {
  const text = useNativeState("");
  const bar =
    sidebarAction === undefined && sidebarMenu === undefined ? (
      sidebar
    ) : (
      <Toolbar>
        {sidebar}
        <Toolbar.Content>
          {sidebarMenu === undefined ? null : (
            <ToolbarItem placement="topBarTrailing">
              <BarMenuButton menu={sidebarMenu} />
            </ToolbarItem>
          )}
          {sidebarAction === undefined ? null : (
            <ToolbarItem placement="topBarTrailing">
              <SwiftUIButton
                label={sidebarAction.label}
                systemImage={sidebarAction.symbol}
                onPress={sidebarAction.onPress}
              />
            </ToolbarItem>
          )}
        </Toolbar.Content>
      </Toolbar>
    );
  if (sidebarSearch === undefined) return bar;
  return (
    <Toolbar
      modifiers={[
        searchable(text, {
          placement: "sidebar",
          prompt: sidebarSearch.placeholder,
          onChange: sidebarSearch.onChange,
        }),
      ]}
    >
      {bar}
    </Toolbar>
  );
}

/**
 * The list beside its detail, for a regular-width window such as an iPad's
 * or the unfolded iPhone Duo's. The split view draws each column's
 * navigation bar itself, so the screen around it shows no header of its own.
 * A window wide enough stands a middle column between them (`content`).
 * Note that the columns start out all shown and balanced, because SwiftUI's
 * automatic style hides the sidebar of a portrait iPad until it is asked
 * for, and the list is what the window is wide enough to keep beside the
 * detail; a person may still hide it, which the split view reports back.
 */
export function SplitView({ detail, content, detailMenu, detailPath, ...sidebar }: SplitViewProps) {
  const [columns, setColumns] = useState<NavigationSplitViewVisibility>("all");
  return (
    <NavigationSplitView
      columnVisibility={columns}
      onColumnVisibilityChange={setColumns}
      modifiers={[navigationSplitViewStyle("balanced")]}
    >
      <NavigationSplitView.Sidebar>
        <SidebarColumn {...sidebar} />
      </NavigationSplitView.Sidebar>
      {content === undefined ? null : (
        <NavigationSplitView.Content>{content}</NavigationSplitView.Content>
      )}
      <NavigationSplitView.Detail>
        {detailMenu === undefined && detailPath === undefined ? (
          detail
        ) : (
          <Toolbar>
            {detail}
            <Toolbar.Content>
              {detailPath === undefined ? null : (
                <ToolbarItem placement="principal">
                  <PathTitle path={detailPath.path} status={detailPath.status} />
                </ToolbarItem>
              )}
              {detailMenu === undefined ? null : (
                <ToolbarItem placement="topBarTrailing">
                  <BarMenuButton menu={detailMenu} />
                </ToolbarItem>
              )}
            </Toolbar.Content>
          </Toolbar>
        )}
      </NavigationSplitView.Detail>
    </NavigationSplitView>
  );
}
