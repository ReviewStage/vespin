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
  /** The unread dot, in the row's margin: the strongest mark a row carries, as Mail's is. */
  UNREAD: 9,
  /** A row's end dot, such as a task's thread that needs you. */
  DOT: 6,
  /** A row's leading mark, a status ring or an ask's glyph, and a chip's, sized to stand beside the body style's words. */
  GLYPH: 16,
  /** The column a row's leading mark stands centered in. */
  LEAD: 20,
  /** A writer's face or tile beside a message's name. */
  WRITER: 20,
  /** An avatar on its own, such as a person's on their page. */
  AVATAR: 28,
  /** A teammate's face among a row's end marks, and on a chip. */
  FACE: 16,
  /** A person's photo in a system menu's glyph place, as the glyphs beside it stand. */
  MENU_PHOTO: 20,
  /** The account's photo in a bar, inside the round glass the bar's other buttons stand in. */
  BAR_FACE: 32,
  /**
   * The same in a split view's column bar, such as a portrait iPad's list
   * column. Note that it is smaller, because iPadOS pads a column bar's items
   * more than the iPhone's bar does, so the bar's face there stood a fifth
   * wider than the ⋯ beside it.
   */
  COLUMN_BAR_FACE: 26,
} as const;

/** The least a press stands as, in points, as Apple's guidelines ask of a target, whatever size its mark is drawn at. */
export const PRESS_SIZE = 44;

/** How round the bordered pieces stand: a card, such as an ask's or a pull request's, and a tag. */
export const RADIUS = {
  CARD: 14,
  TAG: 6,
  /** A selected row's fill, set in from its column's edges, as Mail's selected mailbox and message stand. */
  SIDEBAR_ROW: 10,
  /** A block set into words: a code block, a table, a picture, a video, a draft. */
  BLOCK: 8,
  /** A tile a press stands on: a file's chip, a choice's media, an attached picture. */
  TILE: 12,
  /** A message's bubble, as Messages rounds one. */
  BUBBLE: 18,
} as const;

/**
 * The system's layout margins, in points: where a list row's content starts
 * and ends, as UIKit's `systemMinimumLayoutMargins` stand them, 16 pt in an
 * iPhone's narrow window and 20 pt in a Plus or Pro Max's, an iPhone on its
 * side, and every iPad window, its split view's columns included. Apple's
 * `contentMargins(for: .container)` reads them "from 16 to 20 points on
 * iPhone"; `layout-margin.ts` picks between them by the window's width.
 */
export const LAYOUT_MARGIN = {
  NARROW: 16,
  WIDE: 20,
  /** The least window width, in points, that takes the wide margin: the iPhone Plus's 414, where the 402 pt iPhone Pro keeps the narrow one. */
  WIDE_MIN_WIDTH: 414,
} as const;

/**
 * A row's layout across the screen, measured from Mail's Inbox (Apple's iOS
 * 18 Mail screenshot, 393 pt wide): the unread dot in the margin, its
 * trailing edge on the layout margin and its center 11.5 pt in, the leading
 * mark past an 8 pt gutter after it (Mail's photo starts at 24 pt on a
 * 16 pt margin), and the words, where the row's hairline starts, so every
 * row's text and rule line up whatever its mark. Each is counted from the
 * layout margin (`useRowInset`), never from the screen's edge.
 */
export const ROW_INSET = {
  /** Between the unread dot, whose trailing edge stands on the layout margin, and the leading mark: Mail's gutter, UIKit's standard 8 pt between siblings. */
  GUTTER: 8,
  /** A row's top and bottom, so a row of one line in the body style stands 44 pt tall, as iOS's own list rows stand. */
  VERTICAL: 11,
  /** An Inbox thread's top and bottom, as Mail's message rows stand: its sender, subject and preview (17, 15 and 15 pt, ours too) in a 78 pt row, 8 pt over and under their lines. */
  THREAD_VERTICAL: 8,
  /** Between an Inbox thread's title and the line under it, as Mail's subject sits under its sender. */
  THREAD_LINE_GAP: 3,
  /** Between an Inbox thread's title and its preview where its task leads it, as the panel's description stands 2 px under its title, the task's line and the title standing flush. */
  THREAD_PREVIEW_GAP: 2,
  /**
   * Between the column's edge and a selected row's rounded fill, so the fill
   * stands set in, as Mail's selected message does. Note that it stays under
   * the dot's leading inset, the layout margin less the dot, which the row
   * pads by that less `FILL` inside the fill, so the unread dot always stands
   * inside it, whatever size the dot is drawn at.
   */
  FILL: SPACE.TIGHT / 2,
} as const;
