import { createPortal } from "react-dom";
import { cssCustomProperties } from "../../css.js";

/**
 * drop-line.tsx -- where files carried over a document would land: a line in the focus ring's ink across the block they go below.
 *
 * A document that takes a drag of files draws one under the pointer while
 * they are carried, at the boundary between the block they would land below
 * and the next, across that block's width, as a document editor's drop
 * caret stands. It is drawn over the window rather than in the document's
 * flow, so it moves nothing, and is hidden from assistive technology, since
 * a drag is the pointer's alone.
 */

/** Where the line stands in the window: its middle's height, its start, and its length. */
export interface DropLineAt {
  readonly top: number;
  readonly left: number;
  readonly width: number;
}

/** The line where carried files would land. */
export function DropLine({ at }: { at: DropLineAt }): React.JSX.Element {
  const place = cssCustomProperties({
    "--ui-drop-line-top": `${at.top}px`,
    "--ui-drop-line-left": `${at.left}px`,
    "--ui-drop-line-width": `${at.width}px`,
  });

  return createPortal(
    <div className="ui-drop-line" style={place} aria-hidden="true" />,
    document.body,
  );
}
