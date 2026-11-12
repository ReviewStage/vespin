import type { ReactNode } from "react";
import { ImageIcon } from "../../icons/lucide-glyphs.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { INLINE_REF_LOOK, INLINE_REF_NAME, InlineRef } from "../inline-ref/inline-ref.js";
import { INLINE_REF_FIT } from "../inline-ref/inline-ref-fit.js";

/**
 * attachment-ref.tsx -- a file named inside a line of words, "Picture 1" or "spec.pdf": a picture's thumbnail or another file's type, and its name, as one pill that opens it.
 *
 * A file written into a message stands where it was written, so "this
 * Picture 1 next to spec.pdf" says which is which. It is a mention's pill
 * (`InlineRef`), its name kept whole, wrapping with the words around it as a
 * mention does. A picture wears its thumbnail in the glyph's place and,
 * while the pointer rests on it, hangs a card of the picture at a preview's
 * size under its name; a picture whose bytes are not here, still read or not
 * kept, wears a picture's glyph and hangs its name alone. Any other file
 * wears its type's glyph, which the caller draws as its file tree does. A
 * press opens it, as its caller opens files. In a row that is itself a
 * press and hangs its own card, it is an inert pill that hangs nothing
 * (`hint` off), as a time in such a row hangs none.
 *
 * A pill is a token in its caller's words, so it takes no class or style.
 */

/** The thumbnail on the line: the picture cropped to a square a hair taller than the words' glyphs. */
const THUMB = "ui-attachment-ref-thumb size-attachment-ref-thumb rounded-ui-6 object-cover";

/** The preview the card hangs, at the picture's own shape inside a preview's bound. */
const PREVIEW =
  "ui-attachment-ref-preview block h-auto max-h-attachment-ref-preview w-auto max-w-attachment-ref-preview rounded-ui-6";

/** A file named in words: a picture's thumbnail or another file's type, and its name, as a pill, a picture hung larger in its card, and its open. */
export function AttachmentRef({
  name,
  image,
  glyph,
  onOpen,
  hint = true,
}: {
  /** The file's name, "Picture 1" or "spec.pdf", which the pill says. */
  name: string;
  /** The address of a picture's bytes, where they are here to draw. */
  image?: string | undefined;
  /** The type of a file that is no picture, as the caller draws it; none for a picture. */
  glyph?: ReactNode;
  /** Opens the file; a pill without it presses nothing. */
  onOpen?: (() => void) | undefined;
  /** Whether it hangs its card, or its name, while the pointer rests on it; off in a row that hangs its own. */
  hint?: boolean | undefined;
}): React.JSX.Element {
  const card =
    image === undefined || !hint ? undefined : (
      <HoverCard data-picture-card="">
        <HoverCardHead name={name} />
        <img className={PREVIEW} src={image} alt={name} />
      </HoverCard>
    );

  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      fit={INLINE_REF_FIT.FLOW}
      name={INLINE_REF_NAME.WHOLE}
      kind={glyph === undefined ? "picture" : "file"}
      label={name}
      glyph={
        image === undefined ? (
          (glyph ?? <ImageIcon />)
        ) : (
          <img className={THUMB} src={image} alt="" />
        )
      }
      card={card}
      hint={hint ? undefined : false}
      onPress={onOpen}
      pressLabel={onOpen === undefined ? undefined : `Open ${name}`}
    />
  );
}
