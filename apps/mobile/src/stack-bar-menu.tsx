// stack-bar-menu.tsx -- a `BarMenu` as a compact window's stack bar draws it: the system's menu, its submenus, its acts, and each of its groups set apart by a rule.

import {
  type BarMenu,
  type BarMenuAction,
  type BarMenuGroup,
  glyphSymbol,
  groupKey,
} from "@repo/ui-native";
import { Stack } from "expo-router";
import { type ReactElement, useEffect, useState } from "react";

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

/** A choice a bar's menu holds, checked where it stands. */
type BarChoice = BarMenu["choices"][number];

/** Where a kept menu reads the newest draw's menu at a press: a holder the page's effect writes, read only by a press. */
type LatestMenu = { current: BarMenu | undefined };

/** Whether two lists stand alike, item by item, by `alike`. */
function listsAlike<Item>(
  one: readonly Item[] | undefined,
  other: readonly Item[] | undefined,
  alike: (item: Item, against: Item) => boolean,
): boolean {
  if (one === undefined || other === undefined) return one === other;

  return (
    one.length === other.length &&
    one.every((item, at) => {
      const against = other[at];

      return against !== undefined && alike(item, against);
    })
  );
}

/** Whether two choices stand alike but for what their presses do. */
function choicesAlike(one: BarChoice, other: BarChoice): boolean {
  return (
    one.label === other.label &&
    one.id === other.id &&
    one.symbol === other.symbol &&
    one.tone === other.tone &&
    one.photo === other.photo &&
    one.on === other.on
  );
}

/** Whether two acts stand alike but for what their presses do. */
function actionsAlike(one: BarMenuAction, other: BarMenuAction): boolean {
  return (
    one.label === other.label &&
    one.symbol === other.symbol &&
    one.detail === other.detail &&
    one.disabled === other.disabled &&
    one.destructive === other.destructive
  );
}

/** Whether two groups stand alike but for what their presses do. */
function groupsAlike(one: BarMenuGroup, other: BarMenuGroup): boolean {
  return (
    listsAlike(one.actions, other.actions, actionsAlike) &&
    listsAlike(one.submenus, other.submenus, menusAlike)
  );
}

/** Whether two menus stand alike but for what their presses do: their words, glyphs, checks and order. */
function menusAlike(one: BarMenu, other: BarMenu): boolean {
  return (
    one.label === other.label &&
    one.symbol === other.symbol &&
    one.disabled === other.disabled &&
    listsAlike(one.choices, other.choices, choicesAlike) &&
    listsAlike(one.actions, other.actions, actionsAlike) &&
    listsAlike(one.submenus, other.submenus, menusAlike) &&
    listsAlike(one.groups, other.groups, groupsAlike)
  );
}

/** The menu `latest` holds now, read where `at` finds it, at a press rather than a draw. */
type MenuAt = (latest: BarMenu | undefined) => BarMenu | undefined;

/** A menu whose presses each call the press at the same place of the menu `latest` holds when pressed, so a menu kept across draws does what the newest draw says. */
function steady(menu: BarMenu, latest: LatestMenu, at: MenuAt): BarMenu {
  const now = () => at(latest.current);

  return {
    ...menu,
    choices: menu.choices.map((choice, place) => ({
      ...choice,
      onPress: () => now()?.choices[place]?.onPress(),
    })),
    actions: menu.actions.map((action, place) => ({
      ...action,
      onPress: () => now()?.actions[place]?.onPress(),
    })),
    submenus: menu.submenus?.map((submenu, place) =>
      steady(submenu, latest, (held) => at(held)?.submenus?.[place]),
    ),
    groups: menu.groups?.map((group, which) => ({
      actions: group.actions.map((action, place) => ({
        ...action,
        onPress: () => now()?.groups?.[which]?.actions[place]?.onPress(),
      })),
      submenus: group.submenus?.map((submenu, place) =>
        steady(submenu, latest, (held) => at(held)?.groups?.[which]?.submenus?.[place]),
      ),
    })),
  };
}

/** The menu itself, where a kept menu's presses read it. */
const WHOLE: MenuAt = (held) => held;

/**
 * The menu a stack bar stands, kept the same across draws while it stands
 * alike: its presses reach the newest draw's, and a new menu is handed on
 * only once its words, glyphs, checks or order change. Note that a page's
 * menu is built afresh on every draw, and a draw that landed after the bar
 * stood, such as a task's read mark moving its row, handed the system's
 * menu new items under the old, whose presses then did nothing.
 */
export function useSteadyBarMenu(menu: BarMenu | undefined): BarMenu | undefined {
  const [latest] = useState<LatestMenu>(() => ({ current: menu }));

  const [kept, setKept] = useState(() =>
    menu === undefined ? undefined : { drawn: menu, steady: steady(menu, latest, WHOLE) },
  );

  useEffect(() => {
    latest.current = menu;
  });

  if (menu === undefined) return undefined;

  if (kept !== undefined && menusAlike(kept.drawn, menu)) return kept.steady;

  const next = { drawn: menu, steady: steady(menu, latest, WHOLE) };
  setKept(next);

  return next.steady;
}
