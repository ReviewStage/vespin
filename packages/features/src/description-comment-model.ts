// description-comment-model.ts -- a description thread as a list's row says it: its comments, the first one's writer and words as one line of plain words, and how many replies follow.

import {
  DESCRIPTION_COMMENT_ENTRY,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
} from "./description-comment-wire.js";
import { markersAsNames } from "./file-marker.js";
import { plainWords } from "./plain-words.js";

/** A thread as its row stands it: the comment that opened it, its words as plain words, and the replies after it. */
export interface CommentRowLines {
  /** The thread's first comment, whose writer leads the row; none where no comment stands, such as one whose every comment was deleted. */
  readonly first: DescriptionCommentEntry | undefined;
  /** The first comment's words on one line, a mention said by its name and a file's marker by the file's name, as a row too short to draw Markdown reads them. */
  readonly preview: string;
  /** How many comments follow the first. */
  readonly replies: number;
}

/** A thread's comments, its words and the lines of what happened to it left out. */
export function threadComments(
  thread: DescriptionCommentThread,
): readonly DescriptionCommentEntry[] {
  return thread.entries.filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
}

/** A comment's words as one line of plain words: its Markdown's marks left out, each mention said by its name and each file's marker by the file's name. */
export function commentPreview(words: string): string {
  // Note that the markers are named before the Markdown is read, because reading it drops the brackets a marker is written in.
  return plainWords(markersAsNames(words));
}

/** What a thread's row says of it (`CommentRowLines`), its quote standing for the words where its first comment holds none. */
export function commentRowLines(thread: DescriptionCommentThread): CommentRowLines {
  const comments = threadComments(thread);
  const [first] = comments;
  const preview = commentPreview(first?.words ?? "");

  return {
    first,
    preview: preview === "" ? thread.quote.trim() : preview,
    replies: Math.max(comments.length - 1, 0),
  };
}
