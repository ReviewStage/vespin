import {
  AlertIcon,
  BlockedMark,
  DraftMark,
  NotDeliveredMark,
  ROW_MARK,
  RowMark,
  Tooltip,
  UnreadMark,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * row-marks.tsx -- the marks a row or a tab wears beside its words: a
 * failure in the danger color, with its hint, a message not delivered in
 * the same, a waiting draft in the muted ink, a task waiting on another's work in the same ink, and the unread dot in the gutter before a row's words, which
 * stands empty once read.
 */

function RowMarks(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="row-mark-failed" title="Failed">
        <div className="catalog-frame">
          <Tooltip label="Failed">
            <RowMark kind={ROW_MARK.FAILED} label="Failed" glyph={<AlertIcon />} />
          </Tooltip>
        </div>
      </CatalogSection>
      <CatalogSection id="row-mark-draft" title="Draft">
        <div className="catalog-frame">
          <DraftMark />
        </div>
      </CatalogSection>
      <CatalogSection id="row-mark-not-delivered" title="Not delivered">
        <div className="catalog-frame">
          <NotDeliveredMark />
        </div>
      </CatalogSection>
      <CatalogSection id="row-mark-blocked" title="Blocked">
        <div className="catalog-frame">
          <BlockedMark />
        </div>
      </CatalogSection>
      <CatalogSection id="row-mark-unread" title="Unread, and read">
        <div className="catalog-frame flex gap-ui-12">
          <UnreadMark unread />
          <UnreadMark unread={false} />
        </div>
      </CatalogSection>
    </>
  );
}

export const ROW_MARKS_EXAMPLE: Example = {
  id: "row-marks",
  title: "Row marks",
  Render: RowMarks,
};
