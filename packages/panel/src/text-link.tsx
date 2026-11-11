import { TextLink as SharedTextLink, TEXT_LINK_LOOK, type TextLinkLook, Tooltip } from "@repo/ui";
import { linkFace } from "@repo/ui/link-face";
import type { ReactNode } from "react";
import { LinkPreviewCard } from "./tasks/link-preview-card.js";
import { opensAsLink } from "./tasks/use-open-link.js";

/**
 * text-link.tsx -- a plain link in written words, drawn one way in every place that draws words: its label underlined quietly in the words' own ink, a bare address whole but for its scheme, the whole address in the window's hint.
 *
 * A link the window knows better, a mention, is drawn as its chip
 * (`tasks/mention-chip.tsx`) before it ever reaches here; what is left
 * is a page the window has no chip for. Both Markdown renderers draw it
 * through this one element, a transcript's (`tasks/transcript-blocks.tsx`)
 * and a description's (`markdown-message.tsx`), and the description's editor gives its
 * link mark the same classes, so a link reads alike wherever it is written.
 * Where words are their own address (`@repo/ui/link-face`), they say it
 * whole but for its scheme, wrapping where it runs long. Note that it wears
 * no ↗, because every link that is no chip leaves the window, so the arrow
 * would say nothing the underline does not. What it looks like is `@repo/ui`'s underlined
 * TextLink; what is the window's own is here: the face, the hint, and the
 * press that opens the address through the app rather than the page.
 *
 * A place that opens links hands `onOpen`, and the link is pressed where the
 * window opens its address at all (`opensAsLink`); a press goes no further
 * than the link, so a section's block under it opens no editor. A place
 * that opens none, or an address the window refuses, draws the same words
 * going nowhere. A label that is more than words, one an edit or a
 * version's change marks inside, is drawn as it is, its scheme kept, so
 * its caret and its marks stay where they stand.
 *
 * A link the window opens hangs the page's own card in its hint's place
 * (`tasks/link-preview-card.tsx`), what the page says of itself as the
 * service reads it, so a reader sees where a link goes before pressing
 * it, as a chip's card says what the chip names; the whole address stays
 * the hint's words, said of the link, and the card says it too on a line
 * of its own. A link going nowhere hangs none, since the window would
 * open nothing the card previews.
 */

/**
 * The most characters of an address the hint says. Note that an address
 * past it, thousands of characters long, is cut, because a hint taller than
 * the window would stand mostly off it and scrolls nowhere.
 */
const HINT_MAX_CHARS = 500;

/** The address as the hint says it: whole, or cut at the bound and marked. */
function hintOf(href: string): string {
  return href.length <= HINT_MAX_CHARS ? href : `${href.slice(0, HINT_MAX_CHARS - 1)}…`;
}

/** A plain link to `href`: its label as `children`, and its label's words, which say whether it is its own address; no words for a label that is more than words. */
export function TextLink({
  href,
  words,
  children,
  onOpen,
  look = TEXT_LINK_LOOK.UNDERLINED,
}: {
  href: string;
  words: string | undefined;
  children: ReactNode;
  /** Opens the link; without one, the link is words going nowhere. */
  onOpen?: ((href: string) => void) | undefined;
  /** How it looks: underlined in a line of words, or as the inline code that is its label (`TEXT_LINK_LOOK.CODE`). */
  look?: TextLinkLook;
}): React.JSX.Element {
  const face = words === undefined ? undefined : linkFace(href, words);
  const opens = onOpen !== undefined && opensAsLink(href);
  return (
    <Tooltip label={hintOf(href)} card={opens ? <LinkPreviewCard href={href} /> : undefined}>
      <SharedTextLink
        href={opens ? href : undefined}
        look={look}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen?.(href);
        }}
      >
        {face?.bare === true ? face.words : children}
      </SharedTextLink>
    </Tooltip>
  );
}
