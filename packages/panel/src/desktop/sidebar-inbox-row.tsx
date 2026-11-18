import { ENTITY_KIND } from "@repo/features/entity-kind";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { commandKeyshortcuts, NAV_CURRENT, type NavCount, NavItem, Shortcut } from "@repo/ui";
import { EntityGlyph } from "../entities/entity-glyph.js";

/**
 * sidebar-inbox-row.tsx -- the sidebar's Inbox row.
 */

/**
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and at its end how many items the view the Inbox
 * shows lists, Questions what waits on the developer and Open what they are
 * not done with (`useInboxViewCount`), in even figures, read with that
 * view's words and drawn in its tone, as the phone's bar counts it
 * (`mobile-bar.tsx`), and nothing at none. Its chord takes the count's place
 * while the row is hovered or reached from the keyboard, as New task's and
 * Search's show theirs. A press opens the window's Inbox
 * (`desktop-inbox.tsx`), and a middle-click opens it in a tab of its own
 * where the window opens tabs; the row is the place shown while it stands.
 * Note that it opens no menu: Mark all as read stands on the Inbox's own
 * head, where its reader looks for it.
 */
export function SidebarInboxRow({
  count,
  current,
  disabled,
  onOpen,
  onOpenInTab,
}: {
  /** What the Inbox's chosen view lists (`useInboxViewCount`). */
  count: NavCount;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
  /** Opens the Inbox in a tab of its own, which a middle-click does; none where the window opens no tabs. */
  onOpenInTab: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<EntityGlyph kind={ENTITY_KIND.INBOX} />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={count}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.INBOX)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.INBOX].chord} />}
      disabled={disabled}
      onClick={onOpen}
      onOpenInTab={onOpenInTab}
    >
      Inbox
    </NavItem>
  );
}
