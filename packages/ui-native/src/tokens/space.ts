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
  DOT: 7,
  /** A status mark or a preview's glyph beside a row's words. */
  GLYPH: 15,
  /** An avatar on its own, such as a person's on their page. */
  AVATAR: 28,
  /** A teammate's face among a row's end marks. */
  FACE: 18,
} as const;
