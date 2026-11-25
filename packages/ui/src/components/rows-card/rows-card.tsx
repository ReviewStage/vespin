import type { ReactNode } from "react";
import { CARD_CORNER, CARD_PADDING, Card } from "../card/card.js";

/**
 * rows-card.tsx -- one bordered card of rows, each ruled from the row above it: a phone's ask's steps or a form's fields, as a grouped choice list stands its options.
 *
 * The card is the one every card wears, at a control's corner, as a grouped
 * `ChoiceList`'s is, so the two read as one kind of card. Note that it clips
 * nothing, unlike that card, because its rows fill nothing to their edges and
 * a field in one opens its `@` and `/` menus past the card's edge. Each row holds what the
 * caller hands it in a list's inset, a hairline between it and the row
 * above it. The rows are a list where what they hold is one, as an ask's
 * steps are, named by `label`, and a group of boxes where they are not, as
 * a form's fields are. The rows never reorder while the card stands, so
 * each is keyed by its place.
 */

/** What the card's rows are to a reader: a list of items, or a plain group of boxes. */
export const ROWS_CARD_ELEMENT = {
  LIST: "list",
  GROUP: "group",
} as const;

export type RowsCardElement = (typeof ROWS_CARD_ELEMENT)[keyof typeof ROWS_CARD_ELEMENT];

/** A row's box: the list's inset, ruled from the row above it. */
const ROW = "ui-rows-card-row min-w-0 px-list-inset py-row-inset not-first:border-t border-border";

/** `rows` in one bordered card, each ruled from the one above it. */
export function RowsCard({
  as = ROWS_CARD_ELEMENT.GROUP,
  label,
  rows,
}: {
  as?: RowsCardElement | undefined;
  /** A list's accessible name, which a sighted reader has from what stands over it; a group of boxes is named by none. */
  label?: string | undefined;
  rows: readonly ReactNode[];
}): React.JSX.Element {
  const list = as === ROWS_CARD_ELEMENT.LIST;
  const Rows = list ? "ul" : "div";
  const Row = list ? "li" : "div";

  return (
    <Card corner={CARD_CORNER.CONTROL} padding={CARD_PADDING.NONE} className="ui-rows-card">
      <Rows
        aria-label={list ? label : undefined}
        className="ui-rows-card-rows m-0 flex min-w-0 list-none flex-col p-0"
      >
        {rows.map((row, place) => (
          // Note that the rows are keyed by their place, since they never reorder while the card stands.
          <Row key={place} className={ROW}>
            {row}
          </Row>
        ))}
      </Rows>
    </Card>
  );
}
