import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "../skeleton/skeleton.js";
import { PDF_PAGE_RATIO, PdfColumn, PdfSheet } from "./pdf-sheet.js";

/**
 * pdf-pages-skeleton.tsx -- a PDF standing as one blank page while pdf.js loads and opens it, drawn through the column and the sheet its pages are drawn in (`./pdf-sheet.tsx`).
 *
 * It stands in the barrel, outside pdf.js's own subpath (`@repo/ui/pdf-pages`),
 * so a viewer draws it while the bundle carrying pdf.js is still on its way.
 */

/** What the placeholder says to a reader while a PDF opens. */
const OPENING_LABEL = "Opening PDF";

/** A PDF standing as one blank page while it opens, in the column and the sheet its pages are drawn in. */
export function PdfPagesSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <PdfColumn label={label}>
      <SkeletonRegion label={OPENING_LABEL}>
        <PdfSheet ratio={PDF_PAGE_RATIO}>
          <Skeleton shape={SKELETON_SHAPE.BLOCK} />
        </PdfSheet>
      </SkeletonRegion>
    </PdfColumn>
  );
}
