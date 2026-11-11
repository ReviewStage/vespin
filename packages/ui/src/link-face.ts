/**
 * link-face.ts -- what a plain link's words say: its label, or, where its words are its own address, the whole address without its scheme.
 *
 * A link the window draws as words rather than a chip (the desktop's
 * `text-link.tsx`) says its label. Where its words are its address, as a
 * bare `https://…` written into a reply or a description autolinks to itself, it
 * says the whole address but for its scheme and a trailing slash, its steps
 * decoded, and wraps where it runs long rather than folding any of it away,
 * since the steps a fold would hide are the ones that tell two addresses on
 * one site apart. A page a call's row in a transcript names by its website
 * chip says its site alone (`siteName`). Nothing here draws: both of the
 * desktop's Markdown renderers read the same face.
 */

import { TEXT_LINK_MARK_CLASS } from "./components/text-link/text-link.js";
import { TEXT_LINK_LOOK } from "./components/text-link/text-link-look.js";

/**
 * What a link an engine draws without React wears, an editor's link mark:
 * an underlined TextLink's own classes, so it looks as one does.
 */
export const TEXT_LINK_MARK_ATTRIBUTES = {
  class: TEXT_LINK_MARK_CLASS,
  "data-look": TEXT_LINK_LOOK.UNDERLINED,
} as const;

/**
 * What a link mark to an address no place opens wears, a `mailto:` one
 * say: its words alone, in the words' own ink and the caret's cursor, as
 * the read view draws such a link.
 */
const INERT_LINK_MARK_ATTRIBUTES = {
  class: "text-inherit no-underline cursor-text",
} as const;

/** A link's face: the words it says, and whether they are its address said bare. */
export interface LinkFace {
  readonly words: string;
  readonly bare: boolean;
}

/** The schemes a link's words may spell its address with. */
const WEB_SCHEME = /^https?:\/\//iu;

/** What a link mark to `href` wears in an editor: a web page's the underlined link, any other address its words alone. */
export function linkMarkAttributes(
  href: string,
): typeof TEXT_LINK_MARK_ATTRIBUTES | typeof INERT_LINK_MARK_ATTRIBUTES {
  return WEB_SCHEME.test(href) ? TEXT_LINK_MARK_ATTRIBUTES : INERT_LINK_MARK_ATTRIBUTES;
}

/** An address as a reader compares it with words: no scheme, no trailing slash. */
function bareAddress(address: string): string {
  return address.trim().replace(WEB_SCHEME, "").replace(/\/$/u, "");
}

/**
 * A web address as a reader says it: whole but for its scheme and a
 * trailing slash, decoded where it decodes; nothing for an address that is
 * not the web's. Note that `decodeURI` leaves an escaped `/`, `?`, or `#`
 * as it is, so the words still name the same steps the address does.
 */
function bareUrl(href: string): string | undefined {
  if (!WEB_SCHEME.test(href) || !URL.canParse(href)) return undefined;
  const bare = bareAddress(href);
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
}

/** Whether a link's words are its own address, spelled with or without its scheme and trailing slash. */
function saysOwnAddress(href: string, words: string): boolean {
  return bareAddress(words) === bareAddress(href);
}

/** What a link to `href` labeled `words` says: its address said bare where the words are the address, its label otherwise. */
export function linkFace(href: string, words: string): LinkFace {
  const bare = saysOwnAddress(href, words) ? bareUrl(href) : undefined;
  return bare === undefined ? { words, bare: false } : { words: bare, bare: true };
}
