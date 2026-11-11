// type.ts -- the type scale: each role's Dynamic Type text style for SwiftUI, and the sizes React Native draws words at, both scaling with the reader's setting.

/**
 * The denser scale every screen reads in, each role by the system's text
 * style whose Large size it is drawn at, so Dynamic Type scales it and no
 * piece sets a size of its own: a row's title at 15 pt over a 13 pt muted
 * line, its time at 12, a group's header at 13, a screen's title at 17
 * semibold, and a page's heading at 20 semibold, the style nearest 21.
 */
export const TYPE_ROLE = {
  /** A row's title, and a message's words. */
  ROW_TITLE: "subheadline",
  /** The muted line under a row's title, a card's detail, and a chip's words. */
  ROW_LINE: "footnote",
  /** A row's time, a tag, and a page's path. */
  TIME: "caption",
  /** A list's group header. */
  GROUP_HEADER: "footnote",
  /** A screen's own title, inline in its bar. */
  SCREEN_TITLE: "headline",
  /** A page's heading under its bar: a thread's or a task's title. */
  PAGE_HEADING: "title3",
} as const;

/** The system's text styles, in points at the Large Dynamic Type size; React Native scales each by the reader's setting. */
export const TEXT_SIZE = {
  TITLE_2: 22,
  TITLE_3: 20,
  HEADLINE: 17,
  BODY: 17,
  CALLOUT: 16,
  SUBHEADLINE: 15,
  FOOTNOTE: 13,
  CAPTION: 12,
} as const;

/** The size a message's words are drawn at in React Native: the row title's, as the denser scale reads. */
export const PROSE_SIZE = TEXT_SIZE.SUBHEADLINE;

/**
 * The navigation bar's words, which the system draws at a fixed size whatever
 * the reader's setting, as its own titles stand: a screen's name at 17
 * semibold, and a pushed page's path small and muted over its heading.
 */
export const BAR_TITLE = {
  SCREEN: { fontSize: TEXT_SIZE.HEADLINE, fontWeight: "600" },
  PATH: { fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "500" },
} as const;

/**
 * The reader's text scale past which they read at an accessibility size, the
 * largest of the standard sizes being 23 pt over the body's 17, where a row
 * gives its words more lines rather than cut them to a word or two.
 */
export const ACCESSIBILITY_SCALE = 1.4;

/** The system's monospaced face, which code is drawn in. */
export const MONOSPACE_FONT = "Menlo";
