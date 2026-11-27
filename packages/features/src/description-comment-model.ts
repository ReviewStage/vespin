// description-comment-model.ts -- a description thread as a list's row and its page say it: its comments, the first one's writer and words as one line of plain words, how many replies follow, the lines of what happened to it after each comment, and what the reader may do to each comment.

import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
} from "./description-comment-wire.js";
import { markersAsNames } from "./file-marker.js";
import { plainWords } from "./plain-words.js";
import { IRREVERSIBLE_WORDS } from "./words.js";

/** What the reader may do to one comment of a thread, past copying it and its thread's link. */
export const COMMENT_ACT = {
  EDIT: "edit",
  DELETE: "delete",
  DELETE_THREAD: "delete-thread",
} as const;

export type CommentAct = (typeof COMMENT_ACT)[keyof typeof COMMENT_ACT];

/** A comment's acts in the panel's words, as its menu names them. */
export const COMMENT_ACT_WORDS = {
  [COMMENT_ACT.EDIT]: "Edit",
  [COMMENT_ACT.DELETE]: "Delete",
  [COMMENT_ACT.DELETE_THREAD]: "Delete thread",
} as const;

/** What a delete asks first, a comment's or a whole thread's, since neither comes back: the panel's question, what it costs, and its act's words. */
export const COMMENT_DELETE_QUESTION = {
  [COMMENT_ACT.DELETE]: {
    title: "Delete this comment?",
    message: `The comment is deleted for everyone. ${IRREVERSIBLE_WORDS}`,
    act: "Delete comment",
  },
  [COMMENT_ACT.DELETE_THREAD]: {
    title: "Delete this thread?",
    message: `Every comment in it is deleted with it. ${IRREVERSIBLE_WORDS}`,
    act: "Delete thread",
  },
} as const;

/** A thread as its row stands it: the comment that opened it, its words as plain words, and the replies after it. */
export interface CommentRowLines {
  /** The thread's first comment, whose writer leads the row; none where no comment stands, such as one whose every comment was deleted. */
  readonly first: DescriptionCommentEntry | undefined;
  /** The first comment's words on one line, a mention said by its name and a file's marker by the file's name, as a row too short to draw Markdown reads them. */
  readonly preview: string;
  /** How many comments follow the first. */
  readonly replies: number;
}

/** What a line of what happened to a thread says its writer did, the panel's words after their name. */
export const COMMENT_EVENT_WORDS = {
  [DESCRIPTION_COMMENT_ENTRY.RESOLVED]: "resolved this",
  [DESCRIPTION_COMMENT_ENTRY.REOPENED]: "reopened this",
} as const;

/** A line of what happened to a thread that its page draws: a resolve or a reopen. */
export type CommentEvent = DescriptionCommentEntry & {
  readonly kind: keyof typeof COMMENT_EVENT_WORDS;
};

/** One comment of a thread as its page draws it, with the lines of what happened to the thread after it, before the next comment. */
export interface CommentWithEvents {
  readonly comment: DescriptionCommentEntry;
  readonly after: readonly CommentEvent[];
}

/** A thread's entries as its page draws them: the lines of what happened before any comment, and each comment with the lines after it. */
export interface CommentThreadLines {
  readonly opening: readonly CommentEvent[];
  readonly comments: readonly CommentWithEvents[];
}

/** Whether an entry is a line of what happened that a thread's page draws. Note that who a thread was sent to is the mention in its words, so an ask's line is the service's to keep and none to draw, as the panel leaves it out. */
function drawnEvent(entry: DescriptionCommentEntry): entry is CommentEvent {
  return entry.kind in COMMENT_EVENT_WORDS;
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

/** A thread's entries in order as its page draws them (`CommentThreadLines`): each resolve and reopen after the comment it follows, or before every comment where none comes first, and an ask's line left out. */
export function commentThreadLines(thread: DescriptionCommentThread): CommentThreadLines {
  const opening: CommentEvent[] = [];
  const comments: { comment: DescriptionCommentEntry; after: CommentEvent[] }[] = [];

  for (const entry of thread.entries) {
    if (entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT) {
      comments.push({ comment: entry, after: [] });
      continue;
    }

    if (!drawnEvent(entry)) continue;
    (comments.at(-1)?.after ?? opening).push(entry);
  }

  return { opening, comments };
}

/**
 * What the reader may do to one comment of a thread, in its menu's order, as
 * the panel's comment offers it and the service holds it to: its writer edits
 * it, and deletes it where it is a reply; the thread's first comment deletes
 * the whole thread, offered to its writer, or to any member where the app or
 * an agent started it. None for a reader not yet known.
 */
export function commentActs(
  thread: DescriptionCommentThread,
  entry: DescriptionCommentEntry,
  readerId: string | undefined,
): readonly CommentAct[] {
  const mine =
    readerId !== undefined &&
    entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER &&
    entry.writer.by?.userId === readerId;

  const first = threadComments(thread)[0]?.id === entry.id;
  const acts: CommentAct[] = mine ? [COMMENT_ACT.EDIT] : [];

  if (
    first &&
    (mine || (readerId !== undefined && entry.writer.actor !== DESCRIPTION_COMMENT_ACTOR.MEMBER))
  ) {
    acts.push(COMMENT_ACT.DELETE_THREAD);
  } else if (!first && mine) {
    acts.push(COMMENT_ACT.DELETE);
  }

  return acts;
}
