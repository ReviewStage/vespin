import {
  GAP,
  Inline,
  SCROLL_AXIS,
  SCROLL_GUTTER,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  type ScrollAxis,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * scroll-area.tsx -- a short list as tall as it holds and a long one
 * shrinking to the room; a short page keeping its scroll bar's room beside a
 * long one; a row of columns that scrolls sideways; a table that scrolls both
 * ways; and a pane's body under a pinned bar that holds a swipe past its end
 * beside one that hands it on to the page. Each room is a fixed size so the
 * area has something to scroll.
 */

const ROWS = Array.from({ length: 24 }, (_, index) => `Review pull request #${3600 + index}`);

const COLUMNS = ["Backlog", "Todo", "In progress", "In review", "Done", "Canceled", "Duplicate"];

/** The area's rows, each on a line of its own, inside the caller's padded element. */
function Rows({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="catalog-scroll-body">
      <Stack gap={GAP.TIGHT}>
        {ROWS.slice(0, count).map((row) => (
          <Text key={row} variant={TEXT_VARIANT.BODY}>
            {row}
          </Text>
        ))}
      </Stack>
    </div>
  );
}

/** A row of columns, or a grid of cells, wider than its room, scrolling on `axis`. */
function Board({ axis }: { axis: ScrollAxis }): React.JSX.Element {
  return (
    <div className="catalog-scroll-room catalog-scroll-room-wide">
      <ScrollArea axis={axis}>
        <div className="catalog-scroll-board">
          {COLUMNS.map((column) => (
            <div key={column} className="catalog-scroll-column">
              <Text variant={TEXT_VARIANT.LABEL}>{column}</Text>
              {axis === SCROLL_AXIS.BOTH ? <Rows count={ROWS.length} /> : <Rows count={3} />}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ScrollAreas(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="scroll-area-content" title="As tall as it holds, shrinking to the room">
        <Inline gap={GAP.SECTION}>
          <div className="catalog-scroll-room">
            <ScrollArea size={SCROLL_SIZE.CONTENT}>
              <Rows count={3} />
            </ScrollArea>
          </div>
          <div className="catalog-scroll-room">
            <ScrollArea size={SCROLL_SIZE.CONTENT}>
              <Rows count={ROWS.length} />
            </ScrollArea>
          </div>
        </Inline>
      </CatalogSection>
      <CatalogSection id="scroll-area-gutter" title="A stable gutter, short and long">
        <Inline gap={GAP.SECTION}>
          {[3, ROWS.length].map((count) => (
            <div key={count} className="catalog-scroll-room">
              <ScrollArea gutter={SCROLL_GUTTER.STABLE}>
                <Rows count={count} />
              </ScrollArea>
            </div>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="scroll-area-sideways" title="Sideways">
        <Board axis={SCROLL_AXIS.HORIZONTAL} />
      </CatalogSection>
      <CatalogSection id="scroll-area-both" title="Both ways">
        <Board axis={SCROLL_AXIS.BOTH} />
      </CatalogSection>
      <CatalogSection
        id="scroll-area-overscroll"
        title="A swipe past the end, held or handed on to the page"
      >
        <Inline gap={GAP.SECTION}>
          {Object.values(SCROLL_OVERSCROLL).map((overscroll) => (
            <div key={overscroll} className="catalog-scroll-room">
              <div className="catalog-scroll-bar">
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {overscroll}
                </Text>
              </div>
              <ScrollArea overscroll={overscroll}>
                <Rows count={ROWS.length} />
              </ScrollArea>
            </div>
          ))}
        </Inline>
      </CatalogSection>
    </>
  );
}

export const SCROLL_AREA_EXAMPLE: Example = {
  id: "scroll-area",
  title: "Scroll area",
  Render: ScrollAreas,
};
