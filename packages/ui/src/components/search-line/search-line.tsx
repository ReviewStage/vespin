import type { ReactNode } from "react";

/**
 * search-line.tsx -- a list's search line: its search field taking the room the controls beside it leave, as Memory and Cloud environment's Variables draw theirs over their lists.
 *
 * The field comes first and grows; the controls after it, a Filter, View
 * options, or an Add, stand at their own widths at the line's end, a
 * control's gap apart.
 */
export function SearchLine({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-search-line flex items-center gap-control-gap [&>:first-child]:min-w-0 [&>:first-child]:flex-1">
      {children}
    </div>
  );
}
