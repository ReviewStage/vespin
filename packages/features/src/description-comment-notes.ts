/**
 * description-comment-notes.ts -- what a write to a description's comment thread that did not land says: the panel's thread and the iOS app's alike.
 */

import {
  DESCRIPTION_COMMENT_REFUSAL,
  type DescriptionCommentRefusal,
} from "./description-comment-wire.js";

/** What a write to a thread did not do, said on the thread. */
export const COMMENT_NOTE = {
  NOT_POSTED: "The comment could not be posted.",
  NOT_CHANGED: "The comment could not be changed.",
  TOO_MANY: "This thread holds as many comments as it can.",
  NO_WORDS: "The words this comment was on are no longer in the description.",
  NOT_YOURS: "Only its writer can change this comment.",
  GONE: "This comment is no longer in the thread.",
  TOO_MANY_FILES: "A comment can't carry that many files.",
  AGENT_AWAY: "That agent isn't running, so it couldn't take the thread.",
} as const;

/** The words a refusal is said in on its thread. */
export function commentRefusalNote(refusal: DescriptionCommentRefusal): string {
  switch (refusal) {
    case DESCRIPTION_COMMENT_REFUSAL.TOO_MANY:
      return COMMENT_NOTE.TOO_MANY;
    case DESCRIPTION_COMMENT_REFUSAL.NO_WORDS:
      return COMMENT_NOTE.NO_WORDS;
    case DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS:
      return COMMENT_NOTE.NOT_YOURS;
    case DESCRIPTION_COMMENT_REFUSAL.NO_ENTRY:
      return COMMENT_NOTE.GONE;
    case DESCRIPTION_COMMENT_REFUSAL.KEY_TAKEN:
      return COMMENT_NOTE.NOT_CHANGED;
    case DESCRIPTION_COMMENT_REFUSAL.TOO_MANY_FILES:
      return COMMENT_NOTE.TOO_MANY_FILES;
  }
}
