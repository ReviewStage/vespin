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

/** Stands down without choosing: the cancel a control becomes mid-action. */
export function CloseIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5.2 5.2 18.8 18.8" />
      <path d="M18.8 5.2 5.2 18.8" />
    </Glyph>
  );
}

/** Three dots in a row: more actions on the thing it sits beside, in a menu. */
export function EllipsisIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Points back out of one: the control that returns to the front page. */
export function BackIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m14.6 5.8-6.2 6.2 6.2 6.2" />
    </Glyph>
  );
}

/** Points on, the mirror of `BackIcon`: a calendar's next month. */
export function ForwardIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

/** An arrow pointing left: back to the place the window stood on before. */
export function ArrowLeftIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M19 12H5" />
      <path d="m11.6 5.4-6.6 6.6 6.6 6.6" />
    </Glyph>
  );
}

/** An arrow pointing right: forward again to where back came from. */
export function ArrowRightIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5 12h14" />
      <path d="m12.4 5.4 6.6 6.6-6.6 6.6" />
    </Glyph>
  );
}

/** An arrow pointing up: a row moved one place up its list. */
export function ArrowUpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 19V5" />
      <path d="m5.4 11.6 6.6-6.6 6.6 6.6" />
    </Glyph>
  );
}

/** An arrow pointing down: a row moved one place down its list. */
export function ArrowDownIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 5v14" />
      <path d="m5.4 12.4 6.6 6.6 6.6-6.6" />
    </Glyph>
  );
}

/** An arrow up and to the right, set after a link's words: a press leaves the place for another. */
export function ArrowUpRightIcon(): React.JSX.Element {
  return (
    // Note that the ↗ follows its link's words' size, faint until the link lights; the pointer lights it only where there is a hover, because iOS plays a first tap as a hover, which a change it draws spends.
    <Glyph className="ui-text-link-out ms-[0.12em] inline-block size-[0.78em] align-[-0.02em] opacity-55 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-hover/text-link:opacity-100 group-focus-visible/text-link:opacity-100">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </Glyph>
  );
}

/**
 * Takes one attachment back off the note. Its own element rather than a
 * `Glyph`: at the eight pixels it is drawn at, the shared 1.9 stroke thins to
 * nothing and the X reads as a dot, so this one carries the weight it needs.
 */
export function RemoveIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.6 5.6 18.4 18.4" />
      <path d="M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

/** A plus: a workspace or an agent that did not exist before the action. */
export function PlusIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 5.4v13.2" />
      <path d="M5.4 12h13.2" />
    </Glyph>
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

/** A lit bulb: what our agents remember for the workspace. */
export function MemoryIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 3.6a5.4 5.4 0 0 0-3.2 9.8c.7.5 1.1 1.3 1.1 2.1v1.5h4.2v-1.5c0-.8.4-1.6 1.1-2.1A5.4 5.4 0 0 0 12 3.6Z" />
      <path d="M9.9 19.6h4.2" />
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

/** Points down into a menu: the half of a split button that opens its choices. */
export function ChevronDownIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m5.8 9.4 6.2 6.2 6.2-6.2" />
    </Glyph>
  );
}

/** Points at a fold's body, turned down by its stylesheet while the fold is open. */
export function FoldChevronIcon(): React.JSX.Element {
  return (
    <Glyph className="ui-disclosure-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

/** Points into a submenu beside a menu row, in the chevron's own stroke. */
export function ChevronRightIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}
