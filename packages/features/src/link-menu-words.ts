/**
 * link-menu-words.ts -- what the menu a link opens on says, on every client: the panel's right-click on a link or a chip, and the phone's long press on a chip.
 */

/** The link menu's acts. */
export const LINK_MENU_WORDS = {
  /** Opens the link where a press on it would. */
  OPEN: "Open link",
  /** Copies the link's address as written. */
  COPY: "Copy link",
  /** What a copy that went says, where a client says one. */
  COPIED: "Link copied",
} as const;
