// row-menu-model.ts -- a row's acts as the plain tree the app's native module builds SwiftUI's own long press menu and swipes from, as they're asked for, and the press a place in that tree names.

import type { IntegrationProvider } from "@repo/features/integration-wire";
import { type Glyph, glyphImage, type MarkLayer } from "./glyph.js";
import { INTEGRATION_MARK_ASSET } from "./integration-marks.js";
import { MARK_SIZE } from "./tokens/space.js";
import type { StatusTone } from "./tokens/status-tone.js";

/**
 * What a row's act means, which sets the color its swipe stands on: one
 * that marks a row read or unread, sets a reminder, finishes something
 * (Resolve, Mark done), pins, archives, or deletes, and the rest. In a long
 * press menu only a destructive act, a delete, reads apart, in the system's
 * red; the rest stand in the menu's ink. Copper is kept for what wants the
 * reader, so no act is drawn in it.
 */
export const ROW_ACTION_TONE = {
  NEUTRAL: "neutral",
  DESTRUCTIVE: "destructive",
  READ: "read",
  REMIND: "remind",
  DONE: "done",
  PIN: "pin",
  ARCHIVE: "archive",
} as const;

export type RowActionTone = (typeof ROW_ACTION_TONE)[keyof typeof ROW_ACTION_TONE];

export type RowAction = {
  /** The act's name, as the panel's menu names it: Mark done, Mark unread. */
  readonly label: string;
  /** Its glyph; none for an act that stands as words alone, such as a reminder's time. */
  readonly symbol?: Glyph | undefined;
  /** What a menu says under its words, such as when a reminder's time comes due. */
  readonly detail?: string | undefined;
  readonly tone: RowActionTone;
  readonly onPress: () => void;
  /** Whether it stands dimmed and takes no press, its `detail` saying why, as the panel's Unfollow stands for the assignee. */
  readonly disabled?: boolean | undefined;
  /** What VoiceOver's Actions call it where its words lean on the menu it stands in, such as Remind me's "Tomorrow" heard as "Remind me tomorrow"; its menu's name before its label where none is given (`menuTree`'s `heard`). */
  readonly heard?: string | undefined;
};

/** A choice of a menu, checked where it stands, beside its glyph where it has one, such as a status's mark, in its tone where it has one. */
export type MenuChoice = {
  readonly label: string;
  /** What tells the choice apart where two may share a label, such as two tasks of one name; the label where none is given. */
  readonly id?: string | undefined;
  readonly symbol?: Glyph | undefined;
  /** The tone the glyph is drawn in, as a status's mark is in the panel's menu; the menu's own ink where none is given. */
  readonly tone?: StatusTone | undefined;
  /** A glyph drawn faint under its own in the same tone, as a priority's lit bars stand over every bar it can light (`MarkLayers`); none where its glyph stands alone. */
  readonly under?: MarkLayer | undefined;
  /** A person's photo, as a file on this device, drawn round in the glyph's place, as the panel's assignee menu leads each member with their face. */
  readonly photo?: string | undefined;
  /** The integration whose mark leads it in the glyph's place, as the panel's MCP server rows lead with their provider's mark. */
  readonly mark?: IntegrationProvider | undefined;
  /** An emoji drawn as its image in the glyph's place, as a section the member gave an emoji leads with it in the panel's Move to, so its words line up with its glyphs' choices. */
  readonly emoji?: string | undefined;
  /** What the menu says under its words, such as a member's email, or You for the reader, as the panel's people menus say it. */
  readonly detail?: string | undefined;
  readonly on: boolean;
  readonly onPress: () => void;
  /** What VoiceOver's Actions call it, such as a status heard as "Set status: Backlog"; its menu's name before its label where none is given (`menuTree`'s `heard`). */
  readonly heard?: string | undefined;
};

/** A menu within a row's long press menu, such as a task's Status: its choices, each checked where it stands, as the system checks them, and the acts under them, such as a task's Remove from section. */
export type RowSubmenu = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly choices: readonly MenuChoice[];
  /** Menus one level further down, after its choices, such as a task's repository inside More. */
  readonly submenus?: readonly RowSubmenu[] | undefined;
  readonly actions?: readonly RowAction[] | undefined;
  /** What it means as a swipe, which sets the color it stands on, such as Remind me's purple; a plain act's gray where none is given. */
  readonly tone?: RowActionTone | undefined;
};

/** What a swipe reveals: an act, or a menu of choices, such as a task's Status, which opens where the act would run. */
export type RowSwipe = RowAction | RowSubmenu;

/** A group of a row's long press menu, set apart from the groups around it by a divider, as Mail's and Reminders' row menus group their acts: its menus, then its acts. */
export type RowMenuGroup = {
  readonly submenus?: readonly RowSubmenu[] | undefined;
  readonly actions?: readonly RowAction[] | undefined;
};

/** One group of a long press menu, in the menu's order: its acts and the menus within it. */
export type LongPressGroup = readonly RowSwipe[];

/** What a node of a row's menu tree is: an act, a choice the system checks, or a menu of more nodes. */
export const MENU_NODE = {
  ACT: "act",
  CHOICE: "choice",
  MENU: "menu",
} as const;

/** How a node's icon is drawn: a glyph, a person's photo from a file on this device, or an integration's own mark. */
export const MENU_ICON = {
  GLYPH: "glyph",
  PHOTO: "photo",
  MARK: "mark",
  EMOJI: "emoji",
} as const;

/**
 * A node's icon as the native module draws it in a system menu: a glyph by
 * the asset catalog's name or an SF Symbol's, in `color` where the menu
 * keeps one, such as a status's tone, with a faint glyph under it where it
 * has one; a photo, drawn round; or an integration's mark from the catalog,
 * in its own colors.
 */
export type MenuIcon =
  | {
      readonly kind: typeof MENU_ICON.GLYPH;
      readonly asset?: string | undefined;
      readonly system?: string | undefined;
      readonly color?: string | undefined;
      readonly under?: { readonly asset: string; readonly opacity: number } | undefined;
    }
  | { readonly kind: typeof MENU_ICON.PHOTO; readonly photo: string; readonly size: number }
  | { readonly kind: typeof MENU_ICON.MARK; readonly asset: string }
  | { readonly kind: typeof MENU_ICON.EMOJI; readonly emoji: string; readonly size: number };

/**
 * One node of a row's menu tree, a field it lacks standing `undefined`,
 * which its JSON leaves out: an act's button, red through the system's
 * destructive role where `destructive`, otherwise in its `tint`; a choice,
 * a toggle the system checks; or a menu, whose nodes are its choices, then
 * its menus within, then its acts. Each says what a system menu shows: its
 * words, what it says under them, and its icon.
 */
export type MenuNode =
  | {
      readonly kind: typeof MENU_NODE.ACT;
      readonly label: string;
      readonly detail?: string | undefined;
      readonly icon?: MenuIcon | undefined;
      readonly destructive: boolean;
      readonly disabled: boolean;
      readonly tint?: string | undefined;
      /** What VoiceOver's Actions call it (`heard`). */
      readonly heard: string;
    }
  | {
      readonly kind: typeof MENU_NODE.CHOICE;
      readonly label: string;
      readonly detail?: string | undefined;
      readonly icon?: MenuIcon | undefined;
      readonly on: boolean;
      /** What VoiceOver's Actions call it (`heard`). */
      readonly heard: string;
    }
  | {
      readonly kind: typeof MENU_NODE.MENU;
      readonly label: string;
      readonly icon?: MenuIcon | undefined;
      readonly tint?: string | undefined;
      readonly nodes: readonly MenuNode[];
    };

/** The inks a menu's nodes stand in: an act's and a menu's own, the muted ink a menu's glyph takes, and a choice's glyph's for its tone. */
export type MenuInks = {
  readonly act: string;
  readonly tone: (tone: StatusTone) => string;
};

/** The swipes from one edge as the native module stands them: their nodes, and whether a full swipe runs the first. */
export type SwipeEdgeTree = { readonly full: boolean; readonly nodes: readonly MenuNode[] };

/** The tones of acts that ask before they run, which a full swipe never runs, so they wait for their button's tap. */
const ASKS_FIRST: ReadonlySet<RowActionTone> = new Set([
  ROW_ACTION_TONE.DESTRUCTIVE,
  ROW_ACTION_TONE.ARCHIVE,
]);

/** Whether a swipe's piece is a menu of choices rather than one act. */
export function isSubmenu(swipe: RowSwipe): swipe is RowSubmenu {
  return "choices" in swipe;
}

/** What a menu holds, in the order it shows them: its choices, then its menus within, then its acts. */
function submenuItems(submenu: RowSubmenu): readonly (MenuChoice | RowSwipe)[] {
  return [...submenu.choices, ...(submenu.submenus ?? []), ...(submenu.actions ?? [])];
}

/** A glyph as a menu's icon, in the color the menu keeps where one is given, with a faint glyph under it where one is given. */
function glyphIcon(glyph: Glyph, color?: string, under?: MarkLayer): MenuIcon {
  const image = glyphImage(glyph);

  return {
    kind: MENU_ICON.GLYPH,
    ...("assetName" in image ? { asset: image.assetName } : { system: image.systemName }),
    color,
    under: under === undefined ? undefined : { asset: under.glyph, opacity: under.opacity },
  };
}

/** A choice's icon: its integration's mark, its photo, or its glyph in its tone's ink; none for a choice of words alone. */
function choiceIcon(choice: MenuChoice, inks: MenuInks): MenuIcon | undefined {
  if (choice.mark !== undefined)
    return { kind: MENU_ICON.MARK, asset: INTEGRATION_MARK_ASSET[choice.mark] };

  if (choice.emoji !== undefined)
    return { kind: MENU_ICON.EMOJI, emoji: choice.emoji, size: MARK_SIZE.MENU_PHOTO };

  if (choice.photo !== undefined)
    return { kind: MENU_ICON.PHOTO, photo: choice.photo, size: MARK_SIZE.MENU_PHOTO };

  if (choice.symbol === undefined) return undefined;

  // Note that a choice saying more under its words draws its glyph alone, as `menuActContent` drew it, with no faint glyph under it.
  return glyphIcon(
    choice.symbol,
    choice.tone === undefined ? undefined : inks.tone(choice.tone),
    choice.detail === undefined ? choice.under : undefined,
  );
}

/** How VoiceOver's Actions name an item within the menus `path` names: its own `heard`, or its menus' names before its words, so "Backlog" in Status reads "Status: Backlog". */
function heard(item: RowAction | MenuChoice, path: readonly string[]): string {
  return item.heard ?? [...path, item.label].join(": ");
}

/** An act as a node, within the menus `path` names: red through the destructive role where `roled` and it takes something away, and otherwise in `ink`. */
function actNode(
  action: RowAction,
  ink: string,
  roled: boolean,
  path: readonly string[] = [],
): MenuNode {
  const destructive = roled && action.tone === ROW_ACTION_TONE.DESTRUCTIVE;

  return {
    kind: MENU_NODE.ACT,
    label: action.label,
    detail: action.detail,
    // Note that a destructive act's glyph is drawn in `ink` itself, as the menu's other glyphs stand, beside its red words, because the destructive role reddens a template glyph too, where `@expo/ui`'s menu left it in the menu's ink.
    icon:
      action.symbol === undefined
        ? undefined
        : glyphIcon(action.symbol, destructive ? ink : undefined),
    destructive,
    disabled: action.disabled === true,
    tint: destructive ? undefined : ink,
    heard: heard(action, path),
  };
}

/** A menu as a node, within the menus `path` names: its choices, then its menus within, in `ink`, then its acts in the menu's own ink. */
function submenuNode(
  submenu: RowSubmenu,
  inks: MenuInks,
  ink: string,
  path: readonly string[] = [],
): MenuNode {
  const within = [...path, submenu.label];

  return {
    kind: MENU_NODE.MENU,
    label: submenu.label,
    icon: glyphIcon(submenu.symbol),
    tint: ink,
    nodes: [
      ...submenu.choices.map(
        (choice): MenuNode => ({
          kind: MENU_NODE.CHOICE,
          label: choice.label,
          // Note that a choice led by an integration's mark or an emoji says nothing under its words, as `markContent` and `emojiContent` drew it.
          detail:
            choice.mark === undefined && choice.emoji === undefined ? choice.detail : undefined,
          icon: choiceIcon(choice, inks),
          on: choice.on,
          heard: heard(choice, within),
        }),
      ),
      ...(submenu.submenus ?? []).map((inner) => submenuNode(inner, inks, ink, within)),
      ...(submenu.actions ?? []).map((action) => actNode(action, inks.act, true, within)),
    ],
  };
}

/** The groups a long press menu draws, those holding something, in its order; a press's place counts among these alone. */
export function filledGroups(groups: readonly LongPressGroup[]): readonly LongPressGroup[] {
  return groups.filter((group) => group.length > 0);
}

/**
 * A long press menu as the native module builds it: each group that holds
 * something, set apart from the next by a divider, its acts in the menu's
 * muted ink and red where they take something away, its menus in the same
 * ink, as `LongPressMenu` draws one.
 */
export function menuTree(
  groups: readonly LongPressGroup[],
  inks: MenuInks,
): readonly (readonly MenuNode[])[] {
  return filledGroups(groups).map((group) =>
    group.map((item) =>
      isSubmenu(item) ? submenuNode(item, inks, inks.act) : actNode(item, inks.act, true),
    ),
  );
}

/**
 * The swipes from one edge as the native module stands them: each filled
 * with the system color its meaning takes (`fill`), a menu's own nodes
 * within it in that fill too, and a delete red without the destructive role,
 * since SwiftUI takes a row out of its list the moment a destructive swipe is
 * pressed, before an act that asks first hears its answer. A full swipe runs
 * the first, unless it asks first, such as Archive or a delete, or is a menu.
 */
export function swipeTree(
  swipes: readonly RowSwipe[],
  fill: (tone: RowActionTone) => string,
  inks: MenuInks,
): SwipeEdgeTree {
  const first = swipes[0];

  return {
    full: first !== undefined && !isSubmenu(first) && !ASKS_FIRST.has(first.tone),
    nodes: swipes.map((swipe) => {
      const ink = fill(swipe.tone ?? ROW_ACTION_TONE.NEUTRAL);

      return isSubmenu(swipe) ? submenuNode(swipe, inks, ink) : actNode(swipe, ink, false);
    }),
  };
}

/** The press of the item at `path` among `items`, each step a place among a menu's items in the order it shows them; none where the path names nothing that takes a press, such as a menu itself. */
function itemPressAt(
  items: readonly (MenuChoice | RowSwipe)[],
  path: readonly number[],
): (() => void) | undefined {
  const [at, ...rest] = path;
  const item = at === undefined ? undefined : items[at];

  if (item === undefined) return undefined;

  if ("choices" in item)
    return rest.length === 0 ? undefined : itemPressAt(submenuItems(item), rest);

  return rest.length === 0 ? item.onPress : undefined;
}

/**
 * The press a place in a row's tree names, as the native module sends it:
 * first which of `lists` it stands in, a menu's group or a swipe's edge, then
 * its place in that and in each menu within. Note that a place is sent rather
 * than a key, so no key is built from identifiers, and the handlers stay here.
 */
export function pressAt(
  lists: readonly (readonly RowSwipe[])[],
  path: readonly number[],
): (() => void) | undefined {
  const [list, ...rest] = path;
  const items = list === undefined ? undefined : lists[list];

  return items === undefined ? undefined : itemPressAt(items, rest);
}

/** The press a place in a long press menu names, its group counted among those holding something, as `menuTree` stands them. */
export function menuPressAt(
  groups: readonly LongPressGroup[],
  path: readonly number[],
): (() => void) | undefined {
  return pressAt(filledGroups(groups), path);
}
