import { ENTITY_KIND } from "@repo/features/entity-kind";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  commandKeyshortcuts,
  NAV_CURRENT,
  type NavCount,
  NavItem,
  type NavItemVariant,
  Shortcut,
} from "@repo/ui";
import { EntityGlyph } from "../entities/entity-glyph.js";

/**
 * sidebar-inbox-row.tsx -- the sidebar's Inbox row.
 */

/**
 * The Inbox's row, after Home's. At its end it counts what the Inbox's chosen
 * view lists, Questions what waits on the developer and Open what they are
 * not done with (`useInboxViewCount`), in that view's tone, as the phone's
 * bar counts it (`mobile-bar.tsx`). A press opens the window's Inbox
 * (`desktop-inbox.tsx`). Note that it opens no menu: Mark all as read stands
 * on the Inbox's own head, where its reader looks for it.
 */
export function SidebarInboxRow({
  variant,
  count,
  current,
  disabled,
  onOpen,
  onOpenInTab,
}: {
  /** Whether it stands as a row or as a tile in the rail. */
  variant: NavItemVariant;
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
      variant={variant}
      hint="Inbox"
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
