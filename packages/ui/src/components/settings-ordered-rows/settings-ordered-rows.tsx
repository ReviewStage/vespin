import type { PointerEventHandler, ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";

/**
 * settings-ordered-rows.tsx -- a run of settings rows in an order the reader keeps, each led by a grip it is dragged up and down the run by, as the account's subscriptions are tried top to bottom.
 *
 * It stands in a section's card as one of its rows, ruled from the row
 * above it, and rules its own rows from each other as the card does. Each
 * row is a list item, so a list drag (the panel's `useRowDrag`) finds its
 * rows as the list's own items; the run takes that drag's press
 * (`onPointerDown`), and a press starts one only on a row's grip
 * (`SETTINGS_ORDER_HANDLE`), so every press on a row's own controls stays a
 * press. A row's grip names nothing and is hidden from assistive
 * technology, since a drag is the pointer's alone: a row's own menu moves
 * it up or down from the keyboard. A run of one row draws no grip, since it
 * has nowhere to go; it keeps the grips' gutter where asked (`gutter`), so a
 * page of several runs lines every card's marks up in one column.
 *
 * Each row slides aside on its own `transform` while another is dragged
 * past it, timed from the motion tokens (`settings-ordered-rows.css`), so
 * reduced motion and a capture run hold it still.
 */

/** What a press must land in to start a row's drag, for the drag's `handle`. */
export const SETTINGS_ORDER_HANDLE = "[data-settings-order-handle]";

/** One row of the run: the settings row it holds, led by its grip. */
export interface SettingsOrderedRow {
  /** What tells the row apart among the run's, kept across a reorder. */
  readonly key: string;
  readonly row: ReactNode;
}

/** A run of settings rows in an order the reader keeps, dragged by their grips. */
export function SettingsOrderedRows({
  label,
  rows,
  onPointerDown,
  gutter = false,
}: {
  /** What the run is, said to a reader as the list's name: "ChatGPT plans". */
  label: string;
  rows: readonly SettingsOrderedRow[];
  /** The drag's press, heard on the run so it measures the rows together; none where the run is not reordered. */
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  /** Whether its card keeps the grips' gutter though the run draws none, so its marks line up with a run beside it that does. */
  gutter?: boolean | undefined;
}): React.JSX.Element {
  const movable = onPointerDown !== undefined && rows.length > 1;
  return (
    <ol
      className="ui-settings-ordered-rows"
      aria-label={label}
      data-movable={movable}
      data-gutter={movable || gutter}
      onPointerDown={movable ? onPointerDown : undefined}
    >
      {rows.map(({ key, row }) => (
        <li key={key} className="ui-settings-ordered-row">
          {movable ? (
            <span className="ui-settings-ordered-grip" data-settings-order-handle="" aria-hidden>
              <GLYPH.DRAG_HANDLE />
            </span>
          ) : null}
          <div className="ui-settings-ordered-body">{row}</div>
        </li>
      ))}
    </ol>
  );
}
