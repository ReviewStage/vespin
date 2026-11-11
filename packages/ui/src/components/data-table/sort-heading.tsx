import type { ReactNode } from "react";
import { pulseOnPress } from "../../press-pulse.js";
import type { SortDirection } from "../../sort-direction.js";
import { SORT_DIRECTION } from "../../sort-direction.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * sort-heading.tsx -- a table column's heading that sorts it: its words as a button in the heading's own type, ink muted until the column is the one sorted, and the arrow of the order chosen.
 *
 * Every sortable table heading draws through this, `DataTable`'s and the
 * Resources popover's alike, so a reader meets one press and one arrow. The
 * cell around it carries `aria-sort`, which its table sets from the same
 * direction.
 */

/** A sortable heading's press: its words alone, in the heading's own type and ink, its ring a little off them. */
const SORT_BUTTON =
  "m-0 inline-flex items-baseline border-0 bg-transparent p-0 text-inherit [font:inherit] cursor-press outline-offset-2";

export function SortHeading({
  direction,
  onPress,
  children,
}: {
  /** The order the column is sorted in; none where another column is the one sorted. */
  direction: SortDirection | undefined;
  onPress: ((event: React.MouseEvent<HTMLButtonElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button type="button" className={SORT_BUTTON} onClick={pulseOnPress(onPress)}>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.LABEL}
        tone={direction === undefined ? TEXT_TONE.MUTED : TEXT_TONE.DEFAULT}
      >
        {children}
        {direction ? (
          <span aria-hidden="true">{direction === SORT_DIRECTION.ASCENDING ? " ▲" : " ▼"}</span>
        ) : null}
      </Text>
    </button>
  );
}
