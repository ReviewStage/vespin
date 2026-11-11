import type { ReactNode, Ref } from "react";
import { cssCustomProperties } from "../../css.js";
import { REPLAY_LEFT_OUT } from "../../session-replay-marks.js";

/**
 * pdf-sheet.tsx -- a PDF's pages as the file viewer stands them, before pdf.js is loaded: the column they scroll in and one page's sheet, which the placeholder a PDF stands as while it opens draws through too (`./pdf-pages-skeleton.tsx`).
 *
 * pdf.js is too large for the bundle every window parses, so what draws a
 * page into its sheet (`./pdf-pages.tsx`, `@repo/ui/pdf-pages`) is loaded the
 * first time a PDF is opened. What stands before it, and what it draws in,
 * lives here, so the placeholder and the pages it stands for are drawn
 * through the same column and sheet. The column fills the room its holder
 * gives it, scrolls up and down, and stands each sheet at a file's reading
 * width, as a text file stands, or the room's where it is narrower. A sheet
 * holds its page's shape before the page is drawn, so the column never
 * moves under the reader as pages come in.
 *
 * A PDF's pages are a person's own, so the column is left out of the screen
 * recording whole (`REPLAY_LEFT_OUT`), its canvases and its words with it.
 */

/** The shape a page stands in before its own is read, width over height: a US Letter page's. */
export const PDF_PAGE_RATIO = 8.5 / 11;

/** The column a PDF's pages scroll in, named for the file to a reader. */
export function PdfColumn({
  label,
  children,
}: {
  /** What the column is named to a reader: the file's name. */
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="document"
      aria-label={label}
      className={`ui-pdf-column ${REPLAY_LEFT_OUT} min-h-0 flex-auto overflow-y-auto bg-well`}
    >
      <div className="mx-auto flex w-viewer-text flex-col gap-block-gap p-card">{children}</div>
    </div>
  );
}

/** One page's sheet, standing at its page's shape, whatever is drawn in it. */
export function PdfSheet({
  ratio,
  sheetRef,
  label,
  children,
}: {
  /** The page's width over its height. */
  ratio: number;
  /** The sheet itself, which its page measures and draws into. */
  sheetRef?: Ref<HTMLElement> | undefined;
  /** What the page is named to a reader, such as "Page 3"; none for the placeholder's. */
  label?: string | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <figure
      ref={sheetRef}
      aria-label={label}
      className="ui-pdf-sheet relative m-0 w-full flex-none aspect-[var(--ui-pdf-ratio)] overflow-hidden bg-surface shadow-card-lift"
      style={cssCustomProperties({ "--ui-pdf-ratio": String(ratio) })}
    >
      {children}
    </figure>
  );
}
