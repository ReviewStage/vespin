import type { ReactNode } from "react";
import { OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";

/**
 * block-card-header.tsx -- the header a block's card wears, a code card's and a draft card's alike: a glyph and a title naming what the block is, and its actions, the one Copy among them.
 *
 * It is drawn on the hover fill over a hairline in the caption's type, its
 * title holding to one line and fading where the header cuts it
 * (`OneLine`), its actions flush with its right edge. Note that it is the
 * cards' own part and no export of the package, since only a card draws it.
 */

/** What a header's title is: a name, set in mono (a language or a file), or words, set as the window's own (a suggestion's "Suggested change"). */
export const CODE_CARD_TITLE = {
  NAME: "name",
  WORDS: "words",
} as const;

export type CodeCardTitle = (typeof CODE_CARD_TITLE)[keyof typeof CODE_CARD_TITLE];

/** Each title's face: a name in mono, words in the label's weight and the text's ink. */
const TITLE_CLASS = {
  [CODE_CARD_TITLE.NAME]: "ui-code-card-title flex min-w-0 items-center font-mono",
  [CODE_CARD_TITLE.WORDS]:
    "ui-code-card-title flex min-w-0 items-center font-label text-foreground",
} as const satisfies Record<CodeCardTitle, string>;

/** A glyph before the title, at an icon's size on the title's line. */
const GLYPH = "ui-code-card-glyph mr-icon-gap inline-flex flex-none [&>svg]:size-icon-16";

/**
 * The header a block's card wears, a code card's and a draft card's alike:
 * a glyph and a title naming what the block is, on the hover fill over a
 * hairline, its actions, the one Copy among them, flush with its right edge.
 */
export function BlockCardHeader({
  glyph,
  title,
  titleIs = CODE_CARD_TITLE.NAME,
  actions,
}: {
  glyph?: ReactNode;
  title: ReactNode;
  titleIs?: CodeCardTitle;
  actions: ReactNode;
}): React.JSX.Element {
  return (
    <figcaption className="ui-code-card-header flex min-w-0 items-center justify-between gap-control-gap border-b border-border bg-muted pl-list-inset text-caption text-muted-foreground">
      <span className={TITLE_CLASS[titleIs]} data-title={titleIs}>
        {glyph === undefined ? null : <span className={GLYPH}>{glyph}</span>}
        {typeof title === "string" ? (
          <OneLine hint={wholeWordsHint(title)}>{title}</OneLine>
        ) : (
          title
        )}
      </span>
      <span className="ui-code-card-actions ml-auto flex flex-none">{actions}</span>
    </figcaption>
  );
}
