// type.ts -- the type scale, iOS's standard text styles: each role's Dynamic Type text style for SwiftUI, and the sizes React Native draws words at, both scaling with the reader's setting.

/**
 * iOS's standard scale, as Mail, Settings and Messages read (the developer,
 * Nov 18, 2026), each role by the system's text style, so Dynamic Type
 * scales it and no piece sets a size of its own: a row's title in the body
 * style over a muted subheadline line, or a headline leading a subheadline
 * subject, as Mail's sender leads its subject; its time and a group's
 * header in the footnote style; a screen's title in the headline style; and
 * a page's heading in title 3.
 */
export const TYPE_ROLE = {
  /** A line that leads a row, such as an Inbox thread's first line, its task's name: the row's largest words, in the headline style, 17 pt semibold, as Mail names a message's sender over its subject. */
  ROW_LEAD: "headline",
  /** A row's title under the line that leads it, such as an Inbox thread's under its task's name: the subheadline style, 15 pt, in the ink, as Mail's subject stands under its sender. */
  ROW_SUBJECT: "subheadline",
  /** A row's title, a Settings row's words, and a message's words: the body style, 17 pt at the default size. */
  ROW_TITLE: "body",
  /** The muted line under a row's title, a card's detail, and a chip's words: the subheadline style, 15 pt. */
  ROW_LINE: "subheadline",
  /** A row's time, a tag, and a page's path: the footnote style, 13 pt. */
  TIME: "footnote",
  /** A list's group header: the footnote style, 13 pt. */
  GROUP_HEADER: "footnote",
  /** A screen's own title, inline in its bar. */
  SCREEN_TITLE: "headline",
  /** A page's heading under its bar: a thread's or a task's title. */
  PAGE_HEADING: "title3",
  /** A wide window's sidebar row's name, in the body style, as Mail names its mailboxes. */
  SIDEBAR_TITLE: "body",
} as const;

/** The face code is drawn in where React Native draws it, Geist Mono, which the app embeds (`apps/mobile/app.config.ts`). */
export const MONOSPACE_FONT = "Geist Mono";

/** The face words are drawn in where React Native draws them, Geist, the face SwiftUI sets them in (`font.ts`). */
export const TEXT_FONT = "Geist";

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

/** The size a message's words are drawn at in React Native: the body style's, as Messages draws a message. */
export const PROSE_SIZE = TEXT_SIZE.BODY;

/**
 * The sizes React Native draws each role's words at, at the default Dynamic
 * Type size, for words SwiftUI does not draw, such as a transcript's rows:
 * the same text styles as `TYPE_ROLE`, which React Native scales by the
 * reader's setting.
 */
export const ROLE_SIZE = {
  ROW_TITLE: TEXT_SIZE.BODY,
  ROW_LINE: TEXT_SIZE.SUBHEADLINE,
  TIME: TEXT_SIZE.FOOTNOTE,
} as const;

/**
 * The navigation bar's words, which the system draws at a fixed size whatever
 * the reader's setting, as its own titles stand: a screen's name at 17
 * semibold, and a pushed page's path small and muted over its heading.
 */
export const BAR_TITLE = {
  SCREEN: { fontFamily: TEXT_FONT, fontSize: TEXT_SIZE.HEADLINE, fontWeight: "600" },
  PATH: { fontFamily: TEXT_FONT, fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "500" },
} as const;

/**
 * The reader's text scale past which they read at an accessibility size, the
 * largest of the standard sizes being 23 pt over the body's 17, where a row
 * gives its words more lines rather than cut them to a word or two.
 */
export const ACCESSIBILITY_SCALE = 1.4;
