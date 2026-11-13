// space.ts -- the few distances the components lay out with, beside the system's own list and form metrics.

/** Gaps between the pieces of a row or a block, in points. */
export const SPACE = {
  /** Between a mark and the words it leads. */
  TIGHT: 4,
  /** Between a row's columns. */
  ROW: 10,
  /** A screen's edge: where a row's mark, a page's words, and a pill row start. */
  EDGE: 16,
  /** Around a block of words on a page. */
  PAGE: 20,
} as const;

/**
 * The widest a column of words reads well at, in points, near the readable
 * width iOS's own apps keep: a transcript in an iPad's or an unfolded Duo's
 * wide window centers its rows in it rather than running a line across the
 * whole screen.
 */
export const READING_WIDTH = 720;

/** The sizes the marks are drawn at, in points. */
export const MARK_SIZE = {
  /** The unread dot, in the row's margin. */
  DOT: 6,
  /** A row's leading mark, a status ring or an ask's glyph, and a chip's. */
  GLYPH: 14,
  /** The column a row's leading mark stands centered in. */
  LEAD: 18,
  /** A writer's face or tile beside a message's name. */
  WRITER: 20,
  /** An avatar on its own, such as a person's on their page. */
  AVATAR: 28,
  /** A teammate's face among a row's end marks, and on a chip. */
  FACE: 16,
  /** The account's photo in a bar, inside the round glass the bar's other buttons stand in. */
  BAR_FACE: 32,
  /**
   * The same in a split view's column bar, such as a portrait iPad's list
   * column. Note that it is smaller, because iPadOS pads a column bar's items
   * more than the iPhone's bar does, so the bar's face there stood a fifth
   * wider than the ⋯ beside it.
   */
  COLUMN_BAR_FACE: 26,
  /** The column a sidebar row's glyph stands centered in, as wide as Mail's mailbox glyphs, so every place's name starts at one edge. */
  SIDEBAR_LEAD: 28,
} as const;

/** The least a press stands as, in points, as Apple's guidelines ask of a target, whatever size its mark is drawn at. */
export const PRESS_SIZE = 44;

/** How round the bordered pieces stand: a card, such as an ask's or a pull request's, and a tag. */
export const RADIUS = {
  CARD: 14,
  TAG: 6,
  /** A sidebar row's selection, a rounded fill set in from the sidebar's edges, as Mail's selected mailbox stands. */
  SIDEBAR_ROW: 10,
} as const;

/**
 * A sidebar row's measures, as Mail's mailboxes stand on iPadOS 26: about
 * 38 pt tall at the standard size, its selection's fill set in from the
 * sidebar's edges, and its glyph and words padded inside that fill.
 */
export const SIDEBAR_ROW = {
  /** Between the sidebar's edge and the row's selection fill. */
  EDGE: 10,
  /** Between the selection fill's side and the glyph or the count. */
  SIDE: 10,
  /** The row's top and bottom inside its fill. */
  VERTICAL: 8,
} as const;

/**
 * A row's layout across the screen: the unread dot in the margin, the
 * leading mark's column, and the words, where the row's hairline starts, so
 * every row's text and rule line up whatever its mark.
 */
export const ROW_INSET = {
  /** The row's own leading inset, the dot's margin. */
  LEADING: SPACE.EDGE - MARK_SIZE.DOT - SPACE.TIGHT,
  /** Where the words, and the hairline under them, start from the screen's edge. */
  TEXT: SPACE.EDGE + MARK_SIZE.LEAD + SPACE.ROW,
  /** A row's top and bottom. */
  VERTICAL: 9,
  /** An Inbox thread's top and bottom, roomier than a task's, as Mail's message rows stand. */
  THREAD_VERTICAL: 11,
  /** Between an Inbox thread's title and the line under it, as Mail's subject sits under its sender. */
  THREAD_LINE_GAP: 3,
} as const;
