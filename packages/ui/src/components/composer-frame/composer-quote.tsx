import type { ReactNode } from "react";
import { GLYPH } from "../../icons/icons.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * composer-quote.tsx -- words quoted in a message box, as a reply holds what it answers: the words drawn as they will read once sent, on a well of their own, and the press that takes them out.
 *
 * A reply quotes what it answers above the words that answer it, as Slack's
 * and iMessage's replies stand in their boxes: a quiet card in the box, its
 * quote's bar down its side as the sent quote wears it
 * (`quote-face.ts`), so the words under it read as the answer and the
 * quote as what they answer. The words are the owner's, drawn as Markdown,
 * their marks and chips as the message will draw them once sent, cut to
 * three lines, since the box quotes to say which words it answers rather
 * than to show them again whole. Its press keeps the caret where it stands,
 * so the words around the quote stay where they were, and is off while the
 * box takes no change. It takes no selection, since the quote is laid in
 * whole and taken out whole. It is drawn in Tailwind utilities over the
 * theme; shadcn/ui has no quote.
 */

/** The card: on the well, its words beside the press, the press at the first line. */
const CARD =
  "ui-composer-quote my-tight-gap flex select-none items-start gap-ui-4 rounded-ui-8 bg-well py-ui-4 pr-ui-4 pl-ui-8";

/** The words: behind the sent quote's bar, in the caption's muted ink, three lines at most. */
const WORDS =
  "ui-composer-quote-words my-ui-2 min-w-0 flex-auto border-l-3 border-border-strong pl-ui-8 text-caption leading-body text-muted-foreground wrap-anywhere line-clamp-3";

/** Words quoted in a message box, `children`, drawn as they will read once sent, beside the press that takes them out. */
export function ComposerQuote({
  removeLabel,
  onRemove,
  disabled = false,
  children,
}: {
  /** What the press is called, which is its hint. */
  removeLabel: string;
  onRemove: () => void;
  /** Whether the box takes no change, which turns the press off. */
  disabled?: boolean | undefined;
  /** The words quoted, drawn by the owner. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={CARD}>
      <div className={WORDS}>{children}</div>
      <Tooltip label={removeLabel}>
        <IconButton
          icon={<GLYPH.CLOSE aria-hidden="true" />}
          label={removeLabel}
          size={BUTTON_SIZE.COMPACT}
          disabled={disabled}
          keepFocus
          onClick={onRemove}
        />
      </Tooltip>
    </div>
  );
}
