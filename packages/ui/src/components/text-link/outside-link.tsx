import type { ReactNode } from "react";
import { TEXT_LINK_LOOK, TextLink } from "./text-link.js";

/**
 * outside-link.tsx -- a link to a page outside the app, in written words or a step: where an API key or a token is made, a code is entered, or a plan's usage is managed.
 *
 * It is the underlined link with its ↗ (`TextLink`'s `external`), so every
 * page that sends a reader out of the app to do something says so the same
 * way. The press never follows the address itself: it hands it to the
 * caller's `open`, the window's own door to the browser, so a refused
 * address is answered there and the app's window stays where it is; the
 * link stays an `<a href>`, so a right-click still offers its link menu.
 * `onOpened` hears the press after, as a step that checks off once its page
 * is open does.
 */

/** Words that open `href` outside the app through `open`. */
export function OutsideLink({
  href,
  open,
  onOpened,
  children,
}: {
  href: string;
  /** Opens the address outside the app, the window's own link door. */
  open: (href: string) => void;
  /** Hears that the page was opened, as a step that checks off does. */
  onOpened?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <TextLink
      look={TEXT_LINK_LOOK.UNDERLINED}
      href={href}
      external
      onClick={(event) => {
        event.preventDefault();
        open(href);
        onOpened?.();
      }}
    >
      {children}
    </TextLink>
  );
}
