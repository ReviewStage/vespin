// pending-review.ts -- the member's own pending review comments, which nobody else sees until they submit the review, placed among a pull request's review threads as every client draws them: a reply on a published thread as its last comment, and every other as a thread of its own.

import type { PendingReviewComment, ReviewThread } from "./agent-wire.js";

/** What a pending comment, and a thread it starts, say of themselves, as GitHub says it. */
export const PENDING_WORD = "Pending";

/** A pending comment as the comment of a thread it is drawn as: keyed by its own id, which no published comment's page is. */
function commentOf(draft: PendingReviewComment): ReviewThread["comments"][number] {
  return { by: draft.by, html: draft.html, body: draft.body, at: draft.at, url: draft.id };
}

/** A pending comment that starts a thread, as a thread of its own on its lines, open and current, with no id a reply or a resolve could name. */
function threadOf(draft: PendingReviewComment): ReviewThread {
  return {
    path: draft.path,
    line: draft.line,
    startLine: draft.startLine,
    originalLine: draft.line,
    originalStartLine: draft.startLine,
    side: draft.side,
    startSide: draft.startSide,
    diffHunk: "",
    resolved: false,
    outdated: false,
    comments: [commentOf(draft)],
    more: 0,
  };
}

/** A published thread with the member's pending replies on it as its last comments, oldest first; the thread as it is where none replies on it. */
export function withPendingReplies(
  thread: ReviewThread,
  drafts: readonly PendingReviewComment[],
): ReviewThread {
  const own = thread.id === undefined ? [] : drafts.filter((draft) => draft.threadId === thread.id);

  return own.length === 0
    ? thread
    : { ...thread, comments: [...thread.comments, ...own.map(commentOf)] };
}

/** The member's pending comments that start threads of their own, each as its thread, oldest first: every one replying on no thread among `threads`. */
export function pendingStarts(
  threads: readonly ReviewThread[],
  drafts: readonly PendingReviewComment[],
): readonly ReviewThread[] {
  const known = new Set(threads.flatMap((thread) => (thread.id === undefined ? [] : [thread.id])));

  return drafts.flatMap((draft) =>
    draft.threadId === undefined || !known.has(draft.threadId) ? [threadOf(draft)] : [],
  );
}

/**
 * The review threads with the member's pending comments among them: a reply
 * on a published thread as that thread's last comment, and every other
 * comment as a thread of its own after them, oldest first. The threads are
 * handed back as they are where no comment is pending.
 */
export function pendingThreadsOf(
  threads: readonly ReviewThread[],
  drafts: readonly PendingReviewComment[],
): readonly ReviewThread[] {
  if (drafts.length === 0) return threads;

  return [
    ...threads.map((thread) => withPendingReplies(thread, drafts)),
    ...pendingStarts(threads, drafts),
  ];
}
