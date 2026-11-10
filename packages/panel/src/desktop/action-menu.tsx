import { APP_SHORTCUTS, type KeyedCommand, shortcutMatches } from "@repo/settings/shortcuts";
import {
  type DrawnMenu,
  type ListRowMenu,
  Menu,
  type MenuKeyMatch,
  type MenuPanel,
  type MenuSubject,
  type MenuAction as SharedMenuAction,
  type MenuEntry as SharedMenuEntry,
  Shortcut,
} from "@repo/ui";
import { type ShortcutSubject, shortcutActsOn, useShortcutTargets } from "../shortcut-target.js";

/**
 * action-menu.tsx -- the window's own drop-down menu: a task's actions, a repository's, a side panel tab's, and the account's.
 *
 * The one menu the task's ⋯ and right-click, a repository header's ⋯ and
 * right-click, a tab's right-click, and the sidebar's account row draw, whose
 * items the empty side panel also lists as buttons of their own. It is
 * drawn rather than asked of the system so that every door draws it the same
 * way and an action can be drawn red. The menu itself, how it hangs, its
 * keys, submenus, the panels an item opens beside it, and exit, is
 * `@repo/ui`'s `Menu`, opened through
 * `useMenu`; what is the window's own is an item's shortcut, named by the
 * command it takes and printed as the menu bar prints its chord, which
 * chooses the item while the menu stands, so a row's menu's P pins that
 * row's task rather than the one the window has open. An item names what
 * its command acts on (`subject`), and prints and hears its chord only
 * while the chord acts on that now (`shortcut-target.ts`).
 */

/** One of the window's menu items: the shared item, its shortcut named by the command that takes the same action. */
export interface MenuAction extends Omit<SharedMenuAction, "hint" | "pressedBy"> {
  /** The shortcut that takes the same action, printed muted at the item's end. */
  command?: KeyedCommand;
  /** What the item acts on, which the shortcut must act on now for the item to print it; none where it always does. */
  subject?: ShortcutSubject | undefined;
}

/** An item that opens a menu of the window's own items beside it rather than acting. */
export interface MenuSubmenu {
  label: string;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
  /** The shortcut that opens it, printed muted before its chevron. */
  command?: KeyedCommand;
  /** What it acts on, which the shortcut must act on now for it to print it; none where it always does. */
  subject?: ShortcutSubject | undefined;
}

/** One line of a menu: an action, a submenu of them, or a panel its owner draws beside it as its submenu (`@repo/ui`'s `MenuPanel`). */
export type MenuEntry = MenuAction | MenuSubmenu | MenuPanel;

/** What a menu draws beyond its items: what it acts on, which heads it as a phone's sheet, and a foot under the items, as a task's menu says who created and last edited it. */
export interface MenuEnds {
  readonly subject?: MenuSubject | undefined;
  readonly footer?: React.ReactNode;
}

/** A command's chord as a shared item prints it and hears it: muted at its end, and choosing it while the menu stands. */
function keyedBy(command: KeyedCommand): { hint: React.ReactNode; pressedBy: MenuKeyMatch } {
  const { chord } = APP_SHORTCUTS[command];
  return { hint: <Shortcut chord={chord} />, pressedBy: (event) => shortcutMatches(chord, event) };
}

/** The chord an item prints now: its command's, where the command acts on what the item does, or where it names nothing it acts on. */
export function actingCommand(entry: {
  readonly command?: KeyedCommand | undefined;
  readonly subject?: ShortcutSubject | undefined;
}): KeyedCommand | undefined {
  const { command, subject } = entry;
  if (command === undefined) return undefined;
  return subject === undefined || shortcutActsOn(command, subject) ? command : undefined;
}

/** The shared item for one of the window's, its command's chord as its hint. */
function sharedAction({ command, subject, ...action }: MenuAction): SharedMenuAction {
  const acting = actingCommand({ command, subject });
  if (acting === undefined) return action;
  return { ...action, ...keyedBy(acting) };
}

function sharedEntry(entry: MenuEntry): SharedMenuEntry {
  if ("panel" in entry) return entry;
  if (!("items" in entry)) return sharedAction(entry);
  const { command, subject, ...submenu } = entry;
  const items = submenu.items.map(sharedAction);
  const acting = actingCommand({ command, subject });
  return acting === undefined ? { ...submenu, items } : { ...submenu, items, ...keyedBy(acting) };
}

/** A row's menu (`ListRow`'s `menu`) of the window's items, each item's chord at its end; `thing` is what the row is, which names its ⋯ and the menu, `shown` whether the surface the row stands on is, which the menu does not outlive, and `replayUnmasked` whether its items' words are the app's own, which a screen recording shows as they read. */
export function rowMenu(
  thing: string,
  groups: readonly (readonly MenuEntry[])[],
  shown?: boolean,
  replayUnmasked?: boolean,
): ListRowMenu {
  return { thing, groups: groups.map((group) => group.map(sharedEntry)), shown, replayUnmasked };
}

/** The window's menu, drawn by the shared one with each item's chord at its end. */
export function ActionMenu({
  groups,
  ...props
}: MenuEnds & {
  label: string;
  /** Where it hangs, and whether it is on its way out (`useMenu`'s `drawn`). */
  menu: DrawnMenu;
  heading?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
  /** Whether its items' words are the app's own, which a screen recording shows as they read, but for an item that is `replayMasked` (`Menu`'s `replayUnmasked`). */
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  // Note that a menu standing open is drawn again as the keys' targets change, so it never prints a chord that no longer acts on its items.
  useShortcutTargets();
  return <Menu {...props} groups={groups.map((group) => group.map(sharedEntry))} />;
}
