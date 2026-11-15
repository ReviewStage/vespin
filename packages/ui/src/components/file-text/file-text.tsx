import {
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
} from "../card/card.js";

/**
 * file-text.tsx -- a file's words as they are written: monospaced, kept line for line, on the code's ground, a peek of its head or the whole of it scrolling in place.
 *
 * What an agent will read is shown as it stands, before anyone trusts it: a
 * skill's `SKILL.md` opened under its card, or the text a member pasted.
 * Nothing is parsed or drawn as Markdown, because the words an agent reads
 * are the raw ones. A peek (`FILE_TEXT_EXTENT.PEEK`) holds its first lines
 * and fades out over its last, its words still selectable but nothing to
 * scroll; the whole (`FILE_TEXT_EXTENT.WHOLE`) stands up to a reading
 * height and scrolls inside itself past it, taking the keyboard so a reader
 * scrolls it from the keys too, and a brief one (`FILE_TEXT_EXTENT.BRIEF`)
 * does the same within a peek's height, for a card the text must not fill. Long lines wrap rather than run sideways.
 * It is a region named for a reader by `label`, the file it shows. Alone it
 * stands in a code card's edge and corner of its own; as a code card's body
 * (`FILE_TEXT_FRAME.CARD_BODY`), as a command asked to run is, it draws
 * none, so the card's edge is the only one.
 */

/** How much of the file stands: its head, faded, or the whole of it in a scroller of a reading height or a peek's. */
export const FILE_TEXT_EXTENT = {
  PEEK: "peek",
  WHOLE: "whole",
  BRIEF: "brief",
} as const;

export type FileTextExtent = (typeof FILE_TEXT_EXTENT)[keyof typeof FILE_TEXT_EXTENT];

/** Whose edge the text stands in: a code card's of its own, or the code card it is the body of. */
export const FILE_TEXT_FRAME = {
  OWN: "own",
  CARD_BODY: "card-body",
} as const;

export type FileTextFrame = (typeof FILE_TEXT_FRAME)[keyof typeof FILE_TEXT_FRAME];

/** The room around the words, the same inside a frame of its own or a card's. */
const FILE_TEXT_CLASS = "ui-file-text py-row-inset px-list-inset";

/** A file's text, as written, at the extent asked. */
export function FileText({
  text,
  label,
  extent = FILE_TEXT_EXTENT.WHOLE,
  frame = FILE_TEXT_FRAME.OWN,
}: {
  text: string;
  /** What the file is, for a reader: "grill-me's SKILL.md". */
  label: string;
  extent?: FileTextExtent;
  /** Whose edge it stands in; its own where none is named. */
  frame?: FileTextFrame;
}): React.JSX.Element {
  const scrolls = extent !== FILE_TEXT_EXTENT.PEEK;

  // Note that a card's body draws no edge, ground, or corner of its own, so it never rings a second corner inside the card's.
  if (frame === FILE_TEXT_FRAME.CARD_BODY) {
    return (
      <section
        className={FILE_TEXT_CLASS}
        data-extent={extent}
        aria-label={label}
        tabIndex={scrolls ? 0 : undefined}
      >
        <pre className="ui-file-text-words">{text}</pre>
      </section>
    );
  }

  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.CODE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.NONE}
      className={FILE_TEXT_CLASS}
      data-extent={extent}
      aria-label={label}
      // Note that only a peek does not scroll, so every other extent takes a place in the Tab order.
      tabIndex={scrolls ? 0 : undefined}
    >
      <pre className="ui-file-text-words">{text}</pre>
    </Card>
  );
}
