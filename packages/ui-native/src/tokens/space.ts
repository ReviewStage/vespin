// space.ts -- the few distances the components lay out with, beside the system's own list and form metrics.

/** Gaps between the pieces of a row or a block, in points. */
export const SPACE = {
  /** Between a mark and the words it leads. */
  TIGHT: 4,
  /** Between a row's columns. */
  ROW: 10,
  /** Around a block of words on a page. */
  PAGE: 20,
} as const;

/** The sizes the marks are drawn at, in points. */
export const MARK_SIZE = {
  /** The unread dot. */
  DOT: 8,
  /** A status mark or a preview's glyph beside a row's words. */
  GLYPH: 15,
  /** A row's avatar. */
  AVATAR: 28,
} as const;
