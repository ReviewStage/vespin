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

/** Starts a run: the triangle every transport draws for play. */
export function PlayIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M8 5.6v12.8l10-6.4z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Holds what is playing: the two bars every transport draws for pause, at the triangle's weight. */
export function PauseIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="6.4" y="5.6" width="4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.6" y="5.6" width="4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Steps a paused video back one frame: a bar and the play triangle turned toward it, at the triangle's weight. */
export function PreviousFrameIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="5.6" y="6.4" width="2.4" height="11.2" rx="1" fill="currentColor" stroke="none" />
      <path d="M18 6.4v11.2l-8.8-5.6z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Steps a paused video on one frame: the play triangle and a bar it stops at, at the triangle's weight. */
export function NextFrameIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M6 6.4v11.2l8.8-5.6z" fill="currentColor" stroke="none" />
      <rect x="16" y="6.4" width="2.4" height="11.2" rx="1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A video sent back a few seconds: the two triangles every transport draws for rewind, at the play triangle's weight. */
export function RewindIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M11.6 6.4v11.2L3.2 12z" fill="currentColor" stroke="none" />
      <path d="M20.4 6.4v11.2L12 12z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A video sent on a few seconds: the mirror of `RewindIcon`, every transport's fast-forward. */
export function FastForwardIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M3.6 6.4v11.2L12 12z" fill="currentColor" stroke="none" />
      <path d="M12.4 6.4v11.2l8.4-5.6z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Stops what is playing: the square every transport draws for stop, at the triangle's weight. */
export function StopIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="6" y="6" width="12" height="12" rx="1.8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}
