/**
 * Every glyph the panel draws itself that no icon set draws as well: drawn
 * here rather than pulled from one, so they share one weight and one box and
 * are sized by the headings, labels, and controls they sit in. What Lucide
 * already draws is Lucide's, behind `icons/lucide-glyphs.tsx`; the door to
 * both is `icons/icons.ts`. They are ours, not
 * anyone's brand mark, so they inherit `currentColor` like any other text — a
 * provider's own mark lives in `marks/provider-mark.tsx` and keeps its brand color.
 * The one exception is the app's own mark, which is ours in both senses: it is a
 * brand mark, and it inherits `currentColor` like the rest.
 */

import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

function Glyph({
  children,
  className = "settings-icon",
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/**
 * The Model Context Protocol's mark, its three strokes redrawn in this
 * file's weight and box rather than shipped as the project's artwork: the
 * composer's button over the MCP servers an agent is handed.
 */
export function McpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M2.44 11.45l8.92-8.92c1.23-1.23 3.23-1.23 4.46 0 1.23 1.23 1.23 3.23 0 4.46l-6.73 6.73" />
      <path d="M9.18 13.63l6.64-6.64c1.23-1.23 3.23-1.23 4.46 0l.05.05c1.23 1.23 1.23 3.23 0 4.46l-8.06 8.06c-.41.41-.41 1.08 0 1.49l1.66 1.66" />
      <path d="M13.59 4.76 7 11.35c-1.23 1.23-1.23 3.23 0 4.46 1.23 1.23 3.23 1.23 4.46 0l6.59-6.59" />
    </Glyph>
  );
}

/** A board on its stand with a line drawn across it: a description's diagram. */
export function BoardIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.4" y="4" width="17.2" height="12" rx="1.8" />
      <path d="M12 16v4.2" />
      <path d="M8.6 20.2h6.8" />
      <path d="m7.4 12 2.8-3 2.6 2.2 3.8-3.6" />
    </Glyph>
  );
}
