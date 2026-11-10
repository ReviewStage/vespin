import { ImageIcon } from "../../icons/lucide-glyphs.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { INLINE_REF_LOOK, INLINE_REF_NAME, InlineRef } from "../inline-ref/inline-ref.js";
import { INLINE_REF_FIT } from "../inline-ref/inline-ref-fit.js";

/**
 * picture-ref.tsx -- a picture named inside a line of words, "Picture 1": its thumbnail and its name as one pill that hangs the picture larger and opens it.
 *
 * A picture written into a message stands where it was written, so "this
 * Picture 1 next to this Picture 2" says which is which. It is a mention's
 * pill (`InlineRef`), its thumbnail in the glyph's place and its name kept
 * whole, wrapping with the words around it as a mention does. While the
 * pointer rests on it, it hangs a card of the picture at a preview's size
 * under its name; a press opens it, as its caller opens pictures. A picture
 * whose bytes are not here, still read or not kept, wears a picture's glyph
 * in place of its thumbnail and hangs its name alone.
 *
 * A pill is a token in its caller's words, so it takes no class or style.
 */

/** The thumbnail on the line: the picture cropped to a square a hair taller than the words' glyphs. */
const THUMB = "ui-picture-ref-thumb size-picture-ref-thumb rounded-ui-6 object-cover";

/** The preview the card hangs, at the picture's own shape inside a preview's bound. */
const PREVIEW =
  "ui-picture-ref-preview block h-auto max-h-picture-ref-preview w-auto max-w-picture-ref-preview rounded-ui-6";

/** A picture named in words: its thumbnail and name as a pill, the picture hung larger in its card, and its open. */
export function PictureRef({
  name,
  image,
  onOpen,
}: {
  /** The picture's name, "Picture 1", which the pill says. */
  name: string;
  /** The address of the picture's bytes, where they are here to draw. */
  image?: string | undefined;
  /** Opens the picture; a pill without it presses nothing. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const card =
    image === undefined ? undefined : (
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
      kind="picture"
      label={name}
      glyph={image === undefined ? <ImageIcon /> : <img className={THUMB} src={image} alt="" />}
      card={card}
      onPress={onOpen}
      pressLabel={onOpen === undefined ? undefined : `Open ${name}`}
    />
  );
}
