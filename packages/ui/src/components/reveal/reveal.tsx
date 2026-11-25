/**
 * reveal.tsx -- what a setting brings with it: rows standing only while a switch is on or a choice is picked, at once as they arrive and go.
 *
 * A switch that turns on a setting's own settings, or a choice whose every
 * value has rows of its own, draws them inside a `Reveal`. The rows stand on
 * the commit that shows them and go on the one that hides them, and what
 * stands under them moves at once, as a list's rows do.
 *
 * Its rows stand in a box of their own, laid out as the rows around it are
 * (reveal.css): a column, its rows ruled one from the next as a card's are
 * (settings-section.css), the box itself ruled from the row above.
 */

import type { ReactNode } from "react";

/** The box a reveal's rows stand in, or nothing where it shows none. */
function RevealedRows({ rows }: { rows: ReactNode }): React.JSX.Element | null {
  if (rows === null || rows === undefined || rows === false) return null;

  return <div className="ui-reveal">{rows}</div>;
}

/** `children`, the rows a setting brings, while `shown`. */
export function Reveal({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): React.JSX.Element | null {
  return <RevealedRows rows={shown ? children : null} />;
}

/**
 * The rows `children` draws for `value`, a choice whose values each bring
 * rows of their own, or none where it draws none. Note that the box is keyed
 * by the value, so the rows of the one left never hand their state to those
 * of the one picked.
 */
export function RevealChoice<Value extends string>({
  value,
  children,
}: {
  value: Value;
  children: (value: Value) => ReactNode;
}): React.JSX.Element | null {
  return <RevealedRows key={value} rows={children(value)} />;
}
