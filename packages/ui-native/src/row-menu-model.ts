// row-menu-model.ts -- a row's acts as the plain tree the app's native module builds SwiftUI's own long press menu and swipes from, as they're asked for, and the press a place in that tree names.

import type { IntegrationProvider } from "@repo/features/integration-wire";
import type { ModelProvider } from "@repo/features/models-wire";
import {
  TASK_PRIORITY_WORDS,
  TASK_STATUS_TONE,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import { TASK_STATUS, type TaskPriority, type TaskStatus } from "@repo/features/task-wire";
import { GLYPH, type Glyph, glyphImage, type MarkLayer, UNASSIGNED_UNDER } from "./glyph.js";
import { INTEGRATION_MARK_ASSET } from "./integration-marks.js";
import { HARNESS_MARK_ASSET, REPOSITORY_CORNER } from "./mark-look.js";
import {
  PRIORITY_MARK_SYMBOL,
  PRIORITY_MARK_TONE,
  priorityMarkUnder,
  STATUS_MARK_SYMBOL,
} from "./status-mark-model.js";
import { MARK_SIZE } from "./tokens/space.js";
import { STATUS_TONE, type StatusTone } from "./tokens/status-tone.js";

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

/** What marks a photo's address as a file on this device, which only `menuPhotoFile` mints. */
declare const MENU_PHOTO_FILE: unique symbol;

/**
 * A person's or a workspace's photo as a file on this device, the one kind
 * of photo a system menu can draw, since it reads its images at once and
 * never from the network: an address that names a picture on the web drew
 * no icon at all. Minted only by `menuPhotoFile`, so a picture's web address
 * can't be handed to a menu.
 */
export type MenuPhotoFile = string & { readonly [MENU_PHOTO_FILE]: true };

/** A photo's address as a menu's photo where it names a file on this device; none for any other address, such as a picture on the web. */
export function menuPhotoFile(address: string): MenuPhotoFile | undefined {
  if (!address.startsWith("file://")) return undefined;

  // SAFETY: the address names a file on this device, which is all the brand claims.
  return address as MenuPhotoFile;
}

/** What an entity's choice is led by, each drawn as its rows draw it: a task's status, a task's priority, a person, no one, a section's emoji, or an integration. */
export const CHOICE_MARK = {
  STATUS: "status",
  PRIORITY: "priority",
  PERSON: "person",
  UNASSIGNED: "unassigned",
  EMOJI: "emoji",
  INTEGRATION: "integration",
  MANAGER: "manager",
  HARNESS: "harness",
  REPOSITORY: "repository",
} as const;

/**
 * An entity's own mark at the head of its choice, which every menu draws as
 * the entity's rows draw it (`choiceLook`): a status's ring in its tone, a
 * priority's bars over the bars it can light, a person's photo, read from a
 * file on this device, or their glyph where they have none, no one's dashed
 * ring, a section's emoji, or an integration's own mark. Note that a choice
 * names its entity rather than a glyph and a tone, so no menu can draw it
 * as a bare glyph.
 */
export type ChoiceMark =
  | { readonly kind: typeof CHOICE_MARK.STATUS; readonly status: TaskStatus }
  | { readonly kind: typeof CHOICE_MARK.PRIORITY; readonly priority: TaskPriority }
  | { readonly kind: typeof CHOICE_MARK.PERSON; readonly photo: MenuPhotoFile | undefined }
  | { readonly kind: typeof CHOICE_MARK.UNASSIGNED }
  | { readonly kind: typeof CHOICE_MARK.EMOJI; readonly emoji: string }
  | { readonly kind: typeof CHOICE_MARK.INTEGRATION; readonly provider: IntegrationProvider }
  | {
      readonly kind: typeof CHOICE_MARK.MANAGER;
      /** Its face's picture in the asset catalog (`managerFaceAsset`), drawn in its own colors. */
      readonly asset: string;
    }
  | { readonly kind: typeof CHOICE_MARK.HARNESS; readonly provider: ModelProvider }
  | {
      readonly kind: typeof CHOICE_MARK.REPOSITORY;
      /** Its `owner/name`, which a row draws its owner's picture from. */
      readonly repository: string;
      /** Its owner's picture as a file on this device, which a menu draws; none while it isn't read. */
      readonly picture: MenuPhotoFile | undefined;
    };

/**
 * A choice of a menu, checked where it stands: led by its entity's own mark
 * (`mark`), such as a status or a person, or by a plain glyph (`symbol`),
 * such as Group by's, never both.
 */
export type MenuChoice = {
  readonly label: string;
  /** What tells the choice apart where two may share a label, such as two tasks of one name; the label where none is given. */
  readonly id?: string | undefined;
  /** What the menu says under its words, such as a member's email, or You for the reader, as the panel's people menus say it. */
  readonly detail?: string | undefined;
  readonly on: boolean;
  readonly onPress: () => void;
  /** What VoiceOver's Actions call it, such as a status heard as "Set status: Backlog"; its menu's name before its label where none is given (`menuTree`'s `heard`). */
  readonly heard?: string | undefined;
} & (
  | { readonly mark: ChoiceMark; readonly symbol?: undefined }
  | { readonly symbol?: Glyph | undefined; readonly mark?: undefined }
);

/**
 * How a choice's head is drawn, as every menu draws it: a glyph, in a tone
 * where it has one, with a faint glyph under it where it has one; a photo
 * from a file on this device; an emoji; or an integration's mark; nothing
 * for a choice of words alone.
 */
export type ChoiceLook =
  | {
      readonly kind: typeof MENU_ICON.GLYPH;
      readonly glyph: Glyph;
      readonly tone?: StatusTone | undefined;
      readonly under?: MarkLayer | undefined;
    }
  | {
      readonly kind: typeof MENU_ICON.PHOTO;
      readonly photo: MenuPhotoFile;
      /** Its corners' radius, of its side, as a repository's owner picture stands on a rounded square; a circle where none is given. */
      readonly corner?: number | undefined;
      /** The glyph that stands in its place until its photo is drawn, where a menu can't wait for it. */
      readonly fallback: Glyph;
    }
  | { readonly kind: typeof MENU_ICON.EMOJI; readonly emoji: string }
  | {
      readonly kind: typeof MENU_ICON.MARK;
      readonly asset: string;
      /** Whether it is drawn fit in a glyph's square, as a harness's mark is, rather than at its own size, as an integration's is drawn for menus. */
      readonly sized: boolean;
    };

/** An entity's mark as its choice's head, as its rows draw it. */
export function markLook(mark: ChoiceMark): ChoiceLook {
  switch (mark.kind) {
    case CHOICE_MARK.STATUS:
      return {
        kind: MENU_ICON.GLYPH,
        glyph: STATUS_MARK_SYMBOL[mark.status],
        tone: TASK_STATUS_TONE[mark.status],
      };
    case CHOICE_MARK.PRIORITY:
      return {
        kind: MENU_ICON.GLYPH,
        glyph: PRIORITY_MARK_SYMBOL[mark.priority],
        tone: PRIORITY_MARK_TONE[mark.priority],
        under: priorityMarkUnder(mark.priority),
      };
    case CHOICE_MARK.PERSON:
      return mark.photo === undefined
        ? { kind: MENU_ICON.GLYPH, glyph: GLYPH.PERSON }
        : { kind: MENU_ICON.PHOTO, photo: mark.photo, fallback: GLYPH.PERSON };
    // Note that no one's ring stands in the muted ink the chip draws it in, which also lays its faint seat under it.
    case CHOICE_MARK.UNASSIGNED:
      return {
        kind: MENU_ICON.GLYPH,
        glyph: GLYPH.UNASSIGNED,
        tone: STATUS_TONE.NEUTRAL,
        under: UNASSIGNED_UNDER,
      };
    case CHOICE_MARK.EMOJI:
      return { kind: MENU_ICON.EMOJI, emoji: mark.emoji };
    case CHOICE_MARK.INTEGRATION:
      return { kind: MENU_ICON.MARK, asset: INTEGRATION_MARK_ASSET[mark.provider], sized: false };
    case CHOICE_MARK.HARNESS:
      return { kind: MENU_ICON.MARK, asset: HARNESS_MARK_ASSET[mark.provider], sized: true };
    case CHOICE_MARK.REPOSITORY:
      return mark.picture === undefined
        ? { kind: MENU_ICON.GLYPH, glyph: GLYPH.REPOSITORY }
        : {
            kind: MENU_ICON.PHOTO,
            photo: mark.picture,
            corner: REPOSITORY_CORNER,
            fallback: GLYPH.REPOSITORY,
          };
    case CHOICE_MARK.MANAGER:
      return { kind: MENU_ICON.MARK, asset: mark.asset, sized: false };
  }
}

/** How a choice's head is drawn: its entity's mark, as its rows draw it, or its plain glyph; none for a choice of words alone. */
export function choiceLook(choice: MenuChoice): ChoiceLook | undefined {
  if (choice.mark !== undefined) return markLook(choice.mark);

  return choice.symbol === undefined ? undefined : { kind: MENU_ICON.GLYPH, glyph: choice.symbol };
}

/** What every entity's choice takes beside its mark: whether it is on, what a press does, and, where it needs them, what tells it apart, what it says under its words, and what VoiceOver calls it. */
type ChoicePress = Pick<MenuChoice, "on" | "onPress" | "id" | "detail" | "heard">;

/** A status's choice, named and drawn as the panel's Status menu offers it: its ring in its tone. */
export function statusChoice(status: TaskStatus, press: ChoicePress): MenuChoice {
  return { label: TASK_STATUS_WORDS[status], mark: { kind: CHOICE_MARK.STATUS, status }, ...press };
}

/** A priority's choice, named and drawn as the panel's Priority menu offers it: its bars over every bar it can light, urgent's square in the attention ink. */
export function priorityChoice(priority: TaskPriority, press: ChoicePress): MenuChoice {
  return {
    label: TASK_PRIORITY_WORDS[priority],
    mark: { kind: CHOICE_MARK.PRIORITY, priority },
    ...press,
  };
}

/** A person's choice: their name beside their photo, read from a file on this device (`menuPhotoFile`), or the person glyph where they have none, as the panel's people menus lead each member with their face. */
export function personChoice(
  name: string,
  photo: MenuPhotoFile | undefined,
  press: ChoicePress,
): MenuChoice {
  return { label: name, mark: { kind: CHOICE_MARK.PERSON, photo }, ...press };
}

/** A task's choice: its name beside its status's ring in its tone, as the panel's task pickers lead each task; a task with no status yet stands as to do. */
export function taskChoice(
  name: string,
  status: TaskStatus | undefined,
  press: ChoicePress,
): MenuChoice {
  return {
    label: name,
    mark: { kind: CHOICE_MARK.STATUS, status: status ?? TASK_STATUS.TODO },
    ...press,
  };
}

/** A repository's choice: its `owner/name` beside its owner's picture on a tile's rounded square, read from a file on this device, or the repository glyph where it has none, as the panel's repository pickers lead each. */
export function repositoryChoice(
  repository: string,
  picture: MenuPhotoFile | undefined,
  press: ChoicePress,
): MenuChoice {
  return {
    label: repository,
    mark: { kind: CHOICE_MARK.REPOSITORY, repository, picture },
    ...press,
  };
}

/** No one's choice, as the panel's Assignee menu offers it first: its words beside no one's dashed ring. */
export function unassignedChoice(label: string, press: ChoicePress): MenuChoice {
  return { label, mark: { kind: CHOICE_MARK.UNASSIGNED }, ...press };
}

/** A menu within a row's long press menu, such as a task's Status: its choices, each checked where it stands, as the system checks them, and the acts under them, such as a task's Remove from section. */
export type RowSubmenu = {
  readonly label: string;
  readonly symbol: Glyph;
  /** A picture of the asset catalog drawn in its own colors in its glyph's place, such as a Manager's character in Change face; its glyph where none is given. */
  readonly picture?: string | undefined;
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
 * has one; a photo, drawn round; or a picture of the catalog in its own
 * colors, an integration's mark or a Manager's face.
 */
type MenuIcon =
  | {
      readonly kind: typeof MENU_ICON.GLYPH;
      readonly asset?: string | undefined;
      readonly system?: string | undefined;
      readonly color?: string | undefined;
      readonly under?: { readonly asset: string; readonly opacity: number } | undefined;
    }
  | {
      readonly kind: typeof MENU_ICON.PHOTO;
      readonly photo: MenuPhotoFile;
      readonly size: number;
      readonly corner?: number | undefined;
    }
  | {
      readonly kind: typeof MENU_ICON.MARK;
      readonly asset: string;
      readonly size?: number | undefined;
    }
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
function isSubmenu(swipe: RowSwipe): swipe is RowSubmenu {
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

/** Whether a choice says what it says under its words: not one led by an integration's mark or an emoji, as `markContent` and `emojiContent` draw it. */
export function saysUnder(choice: MenuChoice): boolean {
  const kind = choiceLook(choice)?.kind;

  return kind !== MENU_ICON.MARK && kind !== MENU_ICON.EMOJI;
}

/** A choice's icon: its entity's mark or its plain glyph, as `choiceLook` draws it, a glyph in its tone's ink; none for a choice of words alone. */
function choiceIcon(choice: MenuChoice, inks: MenuInks): MenuIcon | undefined {
  const look = choiceLook(choice);

  switch (look?.kind) {
    case undefined:
      return undefined;
    case MENU_ICON.MARK:
      return {
        kind: MENU_ICON.MARK,
        asset: look.asset,
        size: look.sized ? MARK_SIZE.MENU_PHOTO : undefined,
      };
    case MENU_ICON.EMOJI:
      return { kind: MENU_ICON.EMOJI, emoji: look.emoji, size: MARK_SIZE.MENU_PHOTO };
    case MENU_ICON.PHOTO:
      return {
        kind: MENU_ICON.PHOTO,
        photo: look.photo,
        size: MARK_SIZE.MENU_PHOTO,
        corner: look.corner,
      };
    // Note that a choice saying more under its words draws its glyph alone, as `menuActContent` drew it, with no faint glyph under it.
    case MENU_ICON.GLYPH:
      return glyphIcon(
        look.glyph,
        look.tone === undefined ? undefined : inks.tone(look.tone),
        choice.detail === undefined ? look.under : undefined,
      );
  }
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
    icon: action.symbol === undefined ? undefined : glyphIcon(action.symbol),
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
    icon:
      submenu.picture === undefined
        ? glyphIcon(submenu.symbol)
        : { kind: MENU_ICON.MARK, asset: submenu.picture },
    tint: ink,
    nodes: [
      ...submenu.choices.map(
        (choice): MenuNode => ({
          kind: MENU_NODE.CHOICE,
          label: choice.label,
          // Note that a choice led by an integration's mark or an emoji says nothing under its words, as `markContent` and `emojiContent` drew it.
          detail: saysUnder(choice) ? choice.detail : undefined,
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
