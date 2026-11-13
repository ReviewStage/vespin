import type { ReactNode } from "react";
import { ImageIcon } from "../../icons/lucide-glyphs.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { INLINE_REF_LOOK, INLINE_REF_NAME, InlineRef } from "../inline-ref/inline-ref.js";
import { INLINE_REF_FIT } from "../inline-ref/inline-ref-fit.js";
import { SpinnerRing } from "../spinner/spinner.js";
import {
  UPLOAD_COVER_SIZE,
  UPLOAD_COVER_STATE,
  UploadCover,
} from "../upload-cover/upload-cover.js";

/**
 * attachment-ref.tsx -- a file named inside a line of words, "Picture 1" or "spec.pdf": a picture's thumbnail or another file's type, and its name, as one pill that opens it.
 *
 * A file written into a message stands where it was written, so "this
 * Picture 1 next to spec.pdf" says which is which. It is a mention's pill
 * (`InlineRef`), its name kept whole, wrapping with the words around it as a
 * mention does. A picture wears its thumbnail in the glyph's place and,
 * while the pointer rests on it, hangs a card of the picture at a preview's
 * size under its name; a picture whose bytes are not here, still read or not
 * kept, wears a picture's glyph in a box the thumbnail's size, so the pill
 * keeps its width as the bytes land, and hangs its name alone. Any other file
 * wears its type's glyph, which the caller draws as its file tree does. A
 * press opens it, as its caller opens files. In a row that is itself a
 * press and hangs its own card, it is an inert pill that hangs nothing
 * (`hint` off), as a time in such a row hangs none.
 *
 * A file named in a line still going up wears the upload's cover
 * (`UploadCover`) on its thumbnail, a picture under the veil with the
 * spinner on it and any other file the spinner in its type's place, and
 * opens nothing until it is up; the line it stands in says the rest.
 *
 * A pill is a token in its caller's words, so it takes no class or style.
 */

/** The thumbnail on the line: the picture cropped to a square a hair taller than the words' glyphs. */
const THUMB = "ui-attachment-ref-thumb size-attachment-ref-thumb rounded-ui-6 object-cover";

/** A picture's glyph while its bytes are not here, centered in the thumbnail's box, so the thumbnail takes its place without moving the name. */
const THUMB_WAITING =
  "ui-attachment-ref-thumb-waiting inline-flex size-attachment-ref-thumb items-center justify-center [&>svg]:size-[1em]";

/** A thumbnail the upload's cover is laid over, placed for it. */
const THUMB_COVERED = "relative inline-flex size-attachment-ref-thumb";

/** The preview the card hangs, at the picture's own shape inside a preview's bound. */
const PREVIEW =
  "ui-attachment-ref-preview block h-auto max-h-attachment-ref-preview w-auto max-w-attachment-ref-preview rounded-ui-6";

/** What a pill leads with: a picture's thumbnail, the file's type, or a picture's glyph while its bytes are not here, each under the upload's cover while it goes up. */
function pillGlyph({
  image,
  glyph,
  uploading,
}: {
  image: string | undefined;
  glyph: ReactNode;
  uploading: boolean;
}): ReactNode {
  if (image !== undefined) {
    const thumb = <img className={THUMB} src={image} alt="" />;

    if (!uploading) return thumb;

    return (
      <span className={`${THUMB_COVERED} rounded-ui-6`}>
        {thumb}
        <UploadCover size={UPLOAD_COVER_SIZE.PILL} state={UPLOAD_COVER_STATE.UPLOADING} />
      </span>
    );
  }

  if (uploading) {
    return (
      <span className={THUMB_WAITING} aria-hidden="true">
        <span className="inline-flex size-[0.85em]">
          <SpinnerRing />
        </span>
      </span>
    );
  }

  return (
    glyph ?? (
      <span className={THUMB_WAITING}>
        <ImageIcon />
      </span>
    )
  );
}

/** A file named in words: a picture's thumbnail or another file's type, and its name, as a pill, a picture hung larger in its card, and its open. */
export function AttachmentRef({
  name,
  image,
  glyph,
  onOpen,
  hint = true,
  uploading = false,
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
  /** Whether the file is on its way up with the line that names it, opening nothing until it is up. */
  uploading?: boolean | undefined;
}): React.JSX.Element {
  const card =
    image === undefined || !hint || uploading ? undefined : (
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
      glyph={pillGlyph({ image, glyph, uploading })}
      card={card}
      hint={hint ? undefined : false}
      onPress={uploading ? undefined : onOpen}
      pressLabel={onOpen === undefined || uploading ? undefined : `Open ${name}`}
    />
  );
}
