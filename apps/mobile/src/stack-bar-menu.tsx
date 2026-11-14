// stack-bar-menu.tsx -- a `BarMenu` as a compact window's stack bar draws it: the system's menu, its submenus, its acts, and each of its groups set apart by a rule.

import { type BarMenu, type BarMenuGroup, glyphSymbol, groupKey } from "@repo/ui-native";
import { Stack } from "expo-router";
import type { ReactElement } from "react";

/** A menu's acts, then the menus within it, as the stack bar's menu items. */
function groupItems(group: BarMenuGroup): ReactElement[] {
  return [
    ...group.actions.map((action) => (
      <Stack.Toolbar.MenuAction
        key={action.label}
        {...(action.symbol === undefined ? {} : { icon: glyphSymbol(action.symbol) })}
        {...(action.detail === undefined ? {} : { subtitle: action.detail })}
        disabled={action.disabled === true}
        destructive={action.destructive === true}
        onPress={action.onPress}
      >
        {action.label}
      </Stack.Toolbar.MenuAction>
    )),
    ...(group.submenus ?? []).map((submenu) => (
      <Stack.Toolbar.Menu
        key={submenu.label}
        title={submenu.label}
        icon={glyphSymbol(submenu.symbol)}
      >
        {stackMenuItems(submenu)}
      </Stack.Toolbar.Menu>
    )),
  ];
}

/**
 * What a menu holds in a stack bar's `Stack.Toolbar.Menu`: each choice,
 * checked as the system checks it, then its acts and its menus, then each of
 * its groups as an inline menu, which the system sets apart with a rule, as
 * `BarMenuButton` draws the same menu in a split view's bar. Note that it
 * answers the items themselves rather than a component of its own, since the
 * bar reads its menu's children by their type.
 */
export function stackMenuItems(menu: BarMenu): ReactElement[] {
  return [
    ...menu.choices.map((choice) => (
      <Stack.Toolbar.MenuAction
        key={choice.label}
        {...(choice.symbol === undefined ? {} : { icon: glyphSymbol(choice.symbol) })}
        isOn={choice.on}
        onPress={choice.onPress}
      >
        {choice.label}
      </Stack.Toolbar.MenuAction>
    )),
    ...groupItems(menu),
    ...(menu.groups ?? []).map((group) => (
      <Stack.Toolbar.Menu key={groupKey(group)} inline>
        {groupItems(group)}
      </Stack.Toolbar.Menu>
    )),
  ];
}
