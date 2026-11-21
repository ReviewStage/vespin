// row-heard-acts.ts -- a row's VoiceOver Actions, read once from the menu its long press opens, each worded as the verb it does.

import type { LongPressGroup, MenuChoice, RowAction, RowSubmenu } from "./list-row.js";

/** One of a row's VoiceOver Actions: what it is heard as, and what it does. */
export type HeardAct = {
  readonly name: string;
  readonly onPress: () => void;
};

/** How VoiceOver names an item of a menu within the row's menu: its own `heard`, or its menu's name before it, so "Backlog" reads "Status: Backlog". */
function nested(path: readonly string[], item: RowAction | MenuChoice): string {
  return item.heard ?? [...path, item.label].join(": ");
}

/** A menu's items, its choices, then its menus within, then its acts, as the menu lists them, each named under the menus it stands in. */
function submenuActs(submenu: RowSubmenu, path: readonly string[]): readonly HeardAct[] {
  const within = [...path, submenu.label];

  return [
    ...submenu.choices.map((choice) => ({ name: nested(within, choice), onPress: choice.onPress })),
    ...(submenu.submenus ?? []).flatMap((inner) => submenuActs(inner, within)),
    ...(submenu.actions ?? [])
      .filter((action) => action.disabled !== true)
      .map((action) => ({ name: nested(within, action), onPress: action.onPress })),
  ];
}

/**
 * A row's VoiceOver Actions, as Mail lists a message's: every act its long
 * press menu offers, in the menu's order, each once. A menu's items are named
 * with the menu they stand in, or their own `heard` words where those say
 * the verb better ("Remind me tomorrow"); a dimmed act is left out, since it
 * takes no press. Note that the menu already holds each swipe's act, so the
 * swipes add none, and that a name standing twice, such as an act the menu
 * offers in two groups, is heard once, at its first place.
 */
export function heardActs(groups: readonly LongPressGroup[]): readonly HeardAct[] {
  const all = groups.flatMap((group) =>
    group.flatMap((item): readonly HeardAct[] =>
      "choices" in item
        ? submenuActs(item, [])
        : item.disabled === true
          ? []
          : [{ name: item.heard ?? item.label, onPress: item.onPress }],
    ),
  );

  const named = new Set<string>();

  return all.filter((act) => {
    if (named.has(act.name)) return false;
    named.add(act.name);

    return true;
  });
}
