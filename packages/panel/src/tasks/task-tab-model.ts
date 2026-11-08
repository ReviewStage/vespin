/**
 * task-tab-model.ts -- the words a task's column and its side panel name their own tabs by and the panel's widths, which their hooks and the fixtures that stage them both read.
 */

/**
 * The column's own tabs, named by a word: the task's Overview, holding its
 * description, which leads the strip on every task. Note that it is not
 * spelled `plan`, the word a retired tab was kept under below.
 */
export const MAIN_TAB = {
  OVERVIEW: "overview",
} as const;

/** The panel's kinds of tab, the fixed three. A kind is one entry here, one row below, and one case where the panel draws it. */
export const SIDE_PANEL_TAB = {
  /**
   * The task's description, which the column's Overview holds now
   * (`use-main-tabs.ts`). Note that it is kept here, drawn and offered
   * nowhere (`DRAWN_KINDS`), because what an earlier version kept and pinned
   * names it, and a pin or a link naming it opens Overview instead. Its value
   * is the name the description had then, which is what was kept.
   */
  DESCRIPTION: "plan",
  /**
   * The task's Inbox, whose threads open in the window's Inbox narrowed to
   * the task now. Note that it is kept here, drawn and offered nowhere
   * (`DRAWN_KINDS`), because what an earlier version kept and pinned names
   * it, and a pin naming it opens the window's Inbox instead.
   */
  INBOX: "inbox",
  /**
   * The description's comment threads, which the description lists in its margin's place
   * now (`description-comments.tsx`'s `DescriptionCommentList`). Note that it is kept
   * here, drawn and offered nowhere (`DRAWN_KINDS`), because what an earlier
   * version kept and pinned names it.
   */
  COMMENTS: "comments",
} as const;

export type FixedSidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

/** Every kind of tab, in the order the "+" offers them and a task whose order holds none of them stands them in. */
export const SIDE_PANEL_TABS: readonly FixedSidePanelTab[] = Object.values(SIDE_PANEL_TAB);

/** Which of an agent's Pull request tab's tabs it shows under its fixed header: the description and conversation, the checks, the chapters, or the changed files. */
export const PULL_REQUEST_VIEW = {
  CONVERSATION: "conversation",
  CHECKS: "checks",
  CHAPTERS: "chapters",
  FILES: "files",
} as const;

export type PullRequestView = (typeof PULL_REQUEST_VIEW)[keyof typeof PULL_REQUEST_VIEW];

/**
 * How narrow the panel may be dragged, in CSS pixels, and where it starts. It
 * has no greatest width of its own: it is dragged as wide as the document
 * beside it leaves room for (side-panel.tsx), as an editor's secondary side
 * bar is.
 */
export const SIDE_PANEL_WIDTH = {
  MIN: 280,
  DEFAULT: 400,
} as const;
