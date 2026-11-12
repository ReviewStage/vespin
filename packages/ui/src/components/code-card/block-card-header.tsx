import { Predicate } from "effect";
import type { ReactNode } from "react";
import { ChevronDownIcon } from "../../icons/lucide-glyphs.js";
import { OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";

/**
 * block-card-header.tsx -- the header a block's card wears, a code card's and a draft card's alike: a glyph and a title naming what the block is, and its actions, the one Copy among them.
 *
 * It is drawn on the hover fill over a hairline in the caption's type, its
 * title holding to one line and fading where the header cuts it
 * (`OneLine`), its actions flush with its right edge. Note that it is the
 * cards' own part and no export of the package, since only a card draws it.
 *
 * A title its owner lets be chosen (`picker`), a code block's language
 * while its text is edited, is a press over the same glyph and words, as a
 * Notion code block's language is: it stands where a title that cannot be
 * chosen stands, in the same ink, a chevron after it showing only under the
 * pointer, the keyboard, or while its menu is open, so a block reads the same
 * whether it is edited or drawn. The menu is its owner's, hung beside the
 * press.
 */

/** What a header's title is: a name, set in mono (a language or a file), or words, set as the window's own (a suggestion's "Suggested change"). */
export const CODE_CARD_TITLE = {
  NAME: "name",
  WORDS: "words",
} as const;

export type CodeCardTitle = (typeof CODE_CARD_TITLE)[keyof typeof CODE_CARD_TITLE];

/** A title chosen from a menu: what the press is for a reader, whether its menu stands open, the menu's id, the press, and the menu its owner draws. */
export interface CodeCardTitlePicker {
  /** The press's name for a reader, naming what it chooses: "Language: TypeScript". */
  label: string;
  open: boolean;
  menuId: string;
  onPress: () => void;
  /** The owner's menu, drawn beside the press while it stands. */
  menu: ReactNode;
}

/** Each title's face: a name in mono, words in the label's weight and the text's ink. */
const TITLE_CLASS = {
  [CODE_CARD_TITLE.NAME]: "ui-code-card-title flex min-w-0 items-center font-mono",
  [CODE_CARD_TITLE.WORDS]:
    "ui-code-card-title flex min-w-0 items-center font-label text-foreground",
} as const satisfies Record<CodeCardTitle, string>;

/** A glyph before the title, at an icon's size on the title's line. */
const GLYPH = "ui-code-card-glyph mr-icon-gap inline-flex flex-none [&>svg]:size-icon-16";

/**
 * The title as a press: no box of its own, so its glyph and words stand
 * where a title's do, its chevron showing only under the pointer, the
 * keyboard, or while the menu is open.
 */
const PICKER =
  "ui-code-card-picker group/picker flex min-w-0 items-center m-0 p-0 [border:0] rounded-ui-6 bg-transparent text-inherit [font:inherit] cursor-press transition-colors duration-(--ui-duration-hover) ease-plain hover:text-foreground focus-visible:text-foreground aria-expanded:text-foreground";

/** The chevron after a pickable title, kept in the line so showing it moves nothing. */
const PICKER_CHEVRON =
  "ui-code-card-picker-chevron ms-0.5 inline-flex flex-none opacity-0 transition-opacity duration-(--ui-duration-hover) ease-plain group-hover/picker:opacity-100 group-focus-visible/picker:opacity-100 group-aria-expanded/picker:opacity-100 [&>svg]:size-icon-12";

/** The glyph and the words a title shows. */
function TitleWords({ glyph, title }: { glyph: ReactNode; title: ReactNode }): ReactNode {
  return (
    <>
      {glyph === undefined ? null : <span className={GLYPH}>{glyph}</span>}
      {Predicate.isString(title) ? <OneLine hint={wholeWordsHint(title)}>{title}</OneLine> : title}
    </>
  );
}

/**
 * The header a block's card wears, a code card's and a draft card's alike:
 * a glyph and a title naming what the block is, on the hover fill over a
 * hairline, its actions, the one Copy among them, flush with its right edge.
 */
export function BlockCardHeader({
  glyph,
  title,
  titleIs = CODE_CARD_TITLE.NAME,
  picker,
  actions,
}: {
  glyph?: ReactNode;
  title: ReactNode;
  titleIs?: CodeCardTitle;
  /** The title as a press opening its owner's menu; a title that cannot be chosen without one. */
  picker?: CodeCardTitlePicker | undefined;
  actions: ReactNode;
}): React.JSX.Element {
  return (
    <figcaption className="ui-code-card-header flex min-w-0 items-center justify-between gap-control-gap border-b border-border bg-muted pl-list-inset text-caption text-muted-foreground">
      <span className={TITLE_CLASS[titleIs]} data-title={titleIs}>
        {picker === undefined ? (
          <TitleWords glyph={glyph} title={title} />
        ) : (
          <span className="relative flex min-w-0 items-center">
            <button
              type="button"
              className={PICKER}
              aria-label={picker.label}
              aria-haspopup="dialog"
              aria-expanded={picker.open}
              aria-controls={picker.open ? picker.menuId : undefined}
              onClick={picker.onPress}
            >
              <TitleWords glyph={glyph} title={title} />
              <span className={PICKER_CHEVRON} aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>
            {picker.menu}
          </span>
        )}
      </span>
      <span className="ui-code-card-actions ml-auto flex flex-none">{actions}</span>
    </figcaption>
  );
}
