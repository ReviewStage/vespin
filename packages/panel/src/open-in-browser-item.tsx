import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  readLink,
} from "@repo/features/link-grammar";
import { stayingOnWeb } from "@repo/features/link-open";
import { VERB } from "@repo/features/words";
import { GLYPH } from "@repo/ui/icons";
import { appPlatform } from "./app-platform.js";
import type { MenuAction } from "./desktop/action-menu.js";

/**
 * open-in-browser-item.tsx -- Open in browser as a page's menus offer it: the page's own app link opened in the browser, flagged to stay there.
 *
 * A page is framed from an address only a frame may load (the
 * desktop's `app-page:` scheme, the web's sandbox site, which answers
 * nothing else), so its Open in browser opens the page's app link, the
 * web app's own address for it, where the page opens in its tab. The link
 * is written from the page's place and the workspace (`linkOf`), never from
 * the address the frame is drawn from, and carries the flag that keeps the
 * web from handing it straight back to the Mac app (`stayingOnWeb`). The
 * shell opens it outside the window (`openWeb`): the Mac app in the
 * default browser, a browser tab in a tab of its own.
 */

/** A page's place, as a link names it. */
type PageLinkDestination = Extract<LinkDestination, { kind: typeof LINK_DESTINATION.PAGE }>;

/** Open in browser for a page, by its place and the workspace its link is written under. */
export function openPageInBrowserItem(place: PageLinkDestination, workspace: string): MenuAction {
  return {
    label: VERB.OPEN_IN_BROWSER,
    icon: <GLYPH.OPEN_EXTERNALLY />,
    onSelect: () => appPlatform().openWeb(stayingOnWeb(linkOf(place, workspace))),
  };
}

/** Open in browser for the page an app link names; none for a link to anything else. */
export function linkedPageInBrowserItem(href: string): MenuAction | undefined {
  const read = readLink(href);

  return read?.place.kind === LINK_DESTINATION.PAGE
    ? openPageInBrowserItem(read.place, read.workspace)
    : undefined;
}
