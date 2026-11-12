import { isUnread } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LINK_DESTINATION, type LinkDestination } from "@repo/features/link-grammar";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import { useLinkItems, useOpenInTab } from "../copy-link-item.js";
import type { MenuAction, MenuEntry } from "../desktop/action-menu.js";
import {
  SHORTCUT_SUBJECT,
  type ShortcutSubject,
  shortcutSubject,
  useShortcutTargetOn,
} from "../shortcut-target.js";
import { type InboxResolver, resolveAction } from "./inbox-close.js";
import { type RemindDoors, remindEntries } from "./inbox-remind.js";
import { markReadItem } from "./task-menu-items.js";

/**
 * inbox-item-actions.tsx -- the acts every menu of one Inbox item offers, wherever the item is drawn: its row in the Inbox's list and the ⋯ on its thread's bar.
 *
 * Each menu offers the same groups in the same order: Copy link, the
 * item's link under the task or the agent that holds it; Mark as read or
 * unread, naming U where U reaches the item, and Remind me beside it, naming H
 * there too (`inbox-remind.tsx`), and Resolve while the item is open, naming E
 * there too, at once with Undo (`inbox-close.tsx`): on the chosen item,
 * which the Inbox says its keys act on (`INBOX_ITEM_KEYS`). A surface hands
 * down only the doors it has, and a group whose door is missing stands
 * nowhere.
 */

/** The keys the Inbox offers on its chosen item, which that item's menus print. */
export const INBOX_ITEM_KEYS: readonly KeyedCommand[] = [
  APP_COMMAND.TOGGLE_READ,
  APP_COMMAND.REMIND_ME,
  APP_COMMAND.RESOLVE,
];

/** An Inbox item, as a menu of it names what it acts on. */
export function inboxItemSubject(itemId: string): ShortcutSubject {
  return shortcutSubject(SHORTCUT_SUBJECT.INBOX_ITEM, itemId);
}

/** What an item's acts are offered with: the doors the surface hands down. */
interface InboxItemDoors {
  /** Marks the item read or unread; none where the surface offers no mark. */
  readonly onMark: ((item: InboxItem, unread: boolean) => void) | undefined;
  /** Resolves open items without an answer; none where the surface offers no resolve. */
  readonly onResolve: InboxResolver | undefined;
  /** Sets the item's reminder, and opens the date picker for a time of the reader's own where the surface holds one; none where it offers no reminder. */
  readonly remind?: RemindDoors | undefined;
}

/** An item's acts as a menu draws them. */
interface InboxItemActions {
  /** The menu's groups, with `lead` over the item's own: a phone's, standing for what its bar draws. */
  readonly groups: (lead?: readonly MenuAction[][]) => MenuEntry[][];
  /** Opens the item in a tab of its own, which a middle-click on its row takes; none where the window opens no tabs. */
  readonly openInTab: (() => void) | undefined;
}

/** The place an item is linked by: its id alone, whose agent and task its reader asks the service for. */
function inboxItemPlace(item: InboxItem): LinkDestination {
  return { kind: LINK_DESTINATION.INBOX_ITEM, itemId: item.id };
}

/** One item's acts. */
export function useInboxItemActions(item: InboxItem, doors: InboxItemDoors): InboxItemActions {
  const { onMark, onResolve, remind } = doors;
  const subject = inboxItemSubject(item.id);
  // Note that a row builds its menu on its draw, so it is drawn again as the keys acting on its item change.
  useShortcutTargetOn(subject);

  const read =
    onMark === undefined
      ? undefined
      : markReadItem({ unread: isUnread(item), onMark: (unread) => onMark(item, unread) }, subject);

  const links = useLinkItems()(inboxItemPlace(item));
  const openInTab = useOpenInTab()(inboxItemPlace(item));
  const resolve = resolveAction([item], onResolve, subject);

  const groups = (lead: readonly MenuAction[][] = []) =>
    [
      ...lead,
      links,
      [
        ...(read === undefined ? [] : [read]),
        ...(remind === undefined ? [] : remindEntries(item, remind, subject)),
        ...(resolve === undefined ? [] : [resolve]),
      ],
    ].filter((group) => group.length > 0);

  return { groups, openInTab };
}
