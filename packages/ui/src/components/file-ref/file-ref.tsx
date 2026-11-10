import type { ReactNode } from "react";
import { DocumentIcon } from "../../icons/lucide-glyphs.js";
import { INLINE_REF_LOOK, INLINE_REF_NAME, InlineRef } from "../inline-ref/inline-ref.js";
import { INLINE_REF_FIT } from "../inline-ref/inline-ref-fit.js";

/**
 * file-ref.tsx -- a file named inside a line of words, "spec.pdf": its type's glyph and its name as one pill that opens it.
 *
 * A file written into a message stands where it was written, as a picture
 * does (`picture-ref.tsx`), so "read spec.pdf before notes.txt" says which
 * is which. It is a mention's pill (`InlineRef`), its type's glyph, which
 * the caller draws as its file tree does, in the glyph's place and its name
 * kept whole, wrapping with the words around it as a mention does; a press
 * opens it, as its caller opens files. A file whose bytes are not here
 * presses nothing.
 *
 * A pill is a token in its caller's words, so it takes no class or style.
 */

/** A file named in words: its type's glyph and its name as a pill, and its open. */
export function FileRef({
  name,
  glyph,
  onOpen,
}: {
  /** The file's name, "spec.pdf", which the pill says. */
  name: string;
  /** The file's type as the caller draws it; a page's glyph where none is given. */
  glyph?: ReactNode;
  /** Opens the file; a pill without it presses nothing. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      fit={INLINE_REF_FIT.FLOW}
      name={INLINE_REF_NAME.WHOLE}
      kind="file"
      label={name}
      glyph={glyph ?? <DocumentIcon />}
      onPress={onOpen}
      pressLabel={onOpen === undefined ? undefined : `Open ${name}`}
    />
  );
}
