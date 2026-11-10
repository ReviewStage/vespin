import type { ReactNode } from "react";

/**
 * facts.tsx -- a column of facts, each a muted name and its value at the line's end, as a description list.
 *
 * A fact is a name and a value, not a row a reader presses or a setting
 * they change: how much of an agent's context the last step used, and
 * when. The list is a `dl`, each fact a `dt` and a `dd` on one line, the
 * name muted and taking the room, led by its glyph where it has one, as a
 * sandbox's CPU and Memory are, the value in figures that line up down the
 * column. A list set under what stands over it, as a popover's facts
 * stand under its legend, is `ruled`: a hairline over it and a block's
 * step under that.
 */

/** Facts one under another, an item's step apart. */
export function Facts({
  ruled = false,
  children,
}: {
  /** Whether a hairline sets it off from what stands over it. */
  ruled?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <dl className="ui-facts" data-ruled={ruled ? "true" : undefined}>
      {children}
    </dl>
  );
}

/** One fact: its glyph where it has one, its name, then its value at the line's end. */
export function Fact({
  icon,
  label,
  children,
}: {
  /** The fact's glyph, drawn before its name in the name's muted ink; none where it has none. */
  icon?: ReactNode;
  label: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-fact">
      <dt className="ui-fact-label">
        {icon === undefined ? null : (
          <span className="ui-fact-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {label}
      </dt>
      <dd className="ui-fact-value">{children}</dd>
    </div>
  );
}
