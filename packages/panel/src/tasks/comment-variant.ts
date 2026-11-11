import { COMPOSER_LOOK, type ComposerLook } from "@repo/ui";

/**
 * comment-variant.ts -- how a comment's field stands, a description's, a page's, and a pull request's alike: as a thread's first comment, the card itself; as a reply under its comments; or as a comment's words edited in their place.
 *
 * The comment fields' styles (`.comment-field` and its `data-variant`) lay
 * each out, the message box's (`message-box.tsx`) and the Markdown editor's
 * (`comment-editor.tsx`) alike, so a comment written to GitHub stands as one
 * written to an agent does.
 */

export const REPLY_VARIANT = { FIRST: "first", REPLY: "reply", EDIT: "edit" } as const;

export type ReplyVariant = (typeof REPLY_VARIANT)[keyof typeof REPLY_VARIANT];

/** The frame each stands in: a reply in a card of its own, as every box in the window is; a first comment and an edit bare on the card around them. */
export const REPLY_LOOK: Record<ReplyVariant, ComposerLook> = {
  [REPLY_VARIANT.FIRST]: COMPOSER_LOOK.BARE,
  [REPLY_VARIANT.REPLY]: COMPOSER_LOOK.CARD,
  [REPLY_VARIANT.EDIT]: COMPOSER_LOOK.BARE,
};
