import {
  PULL_REQUEST_ACTION,
  REVIEW_COMMENT_MODE,
  type ReviewCommentMode,
} from "@repo/features/pull-request-write-wire";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, CARD_CORNER, CARD_PADDING, Card } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useState } from "react";
import { type CommentLines, commentLinesLabel } from "./changes-model.js";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import { REPLY_VARIANT } from "./comment-variant.js";
import {
  PullRequestWriteNote,
  type ReadAgain,
  usePullRequestWrites,
  WRITE_NOTE,
} from "./pull-request-writes.js";

/**
 * line-comment.tsx -- the comment a member writes on lines of a changed file in Files changed, drawn under the last of them as GitHub's own line comment is.
 *
 * It opens where the gutter's + was pressed, on the line under the pointer
 * or the lines picked (`changes-model.ts`'s `commentLines`), and offers what
 * GitHub's own does: Add single comment, published at once as a review of
 * its own, and Start a review, which holds it in the member's pending
 * review until the Review panel submits it; where the member already holds
 * a pending review, Add review comment adds it there, as GitHub offers
 * nothing else then. Each is one change (`PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT`),
 * made on GitHub by the service as the member pressing it, on their own
 * sign-in, at the head the files were read at, so a comment lands on the
 * lines the member saw. Once GitHub took it the comment lets its words go
 * and closes, and the tab reads the conversation again, which draws the
 * comment on its line and counts the pending review; GitHub's refusal
 * stands under it in GitHub's words, beside Refresh changes, since a head
 * pushed since is the likeliest why. The words are the view's, kept by its
 * file and lines, so a comment scrolled out of the list and back loses
 * nothing, and several stand open at once across lines and files
 * (`comment-drafts.ts`). On lines of the head alone, the new side's, its `/` menu and a press over
 * its words offer a suggestion, GitHub's ```suggestion block holding those
 * lines as they read now (`comment-editor.tsx`).
 */

/** A quiet line under the words: why no comment can be sent yet, or GitHub's refusal of the last. */
const NOTE_CLASS = "line-comment-note m-0 text-caption-inline text-muted-foreground";

/** The comment's own words. */
const LINE_WORDS = {
  FIELD: "Comment",
  PLACEHOLDER: "Add a comment",
  CANCEL: "Cancel",
  SINGLE: "Add single comment",
  START: "Start a review",
  ADD: "Add review comment",
  SENDING: "Commenting",
  REFRESH: "Refresh changes",
  NO_HEAD: "Refresh changes to comment on these lines.",
  /** What the comment's head says of the lines it is on. */
  on: (lines: string) => `Comment on ${lines}`,
} as const;

/** The member's own pending review, as the conversation's read counts it: none held, or how many comments it holds; unknown before the read lands or where it could not be read as theirs. */
export type PendingReview = { readonly comments: number } | null | undefined;

/**
 * The comment under the lines it is on: its head naming them, the words
 * written as they are drawn, bare on the card as a thread's first comment is
 * on a page, GitHub's answer where it did not take it, and in the words'
 * foot Cancel, Start a review where no review is held, and the round send:
 * a single comment, or the review's next comment once one is held. Enter
 * sends it as the round send does, and
 * Escape lets it go unless it is on its way.
 */
export function LineComment({
  agentId,
  path,
  lines,
  headSha,
  pending,
  body,
  onBody,
  suggestion,
  onActive,
  onClose,
  onWritten,
  onRefresh,
}: {
  agentId: string;
  path: string;
  lines: CommentLines;
  /** The head the files were read at, which the comment is anchored to; none where it could not be read, which offers nothing but Refresh. */
  headSha: string | undefined;
  pending: PendingReview;
  body: string;
  onBody: (body: string) => void;
  /** The lines as they read at the head, which the comment offers to suggest a change to; none where they are not the head's own (`suggestedLines`). */
  suggestion: string | undefined;
  /** Told the comment took the keyboard, which lights its lines among the comments open. */
  onActive?: (() => void) | undefined;
  onClose: () => void;
  /** Reads the tab again once GitHub answered. */
  onWritten: ReadAgain;
  /** Reads the changes again. */
  onRefresh: () => void;
}): React.JSX.Element {
  const writes = usePullRequestWrites(agentId, onWritten);
  // Which offer sent the comment out, which alone wears the wait.
  const [sentAs, setSentAs] = useState<ReviewCommentMode | undefined>(undefined);
  const sending = writes.pending !== undefined;
  const blank = body.trim() === "" || overCommentBound(body);
  const holding = pending != null;

  const send = (mode: ReviewCommentMode) => {
    if (blank || sending || headSha === undefined) return;
    setSentAs(mode);
    writes.write(
      { action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT, mode, path, ...lines, body, headSha },
      () => {
        onBody("");
        onClose();
      },
    );
  };

  const first = holding ? REVIEW_COMMENT_MODE.REVIEW : REVIEW_COMMENT_MODE.SINGLE;

  return (
    // Note that Escape anywhere in the comment lets it go, as it does in GitHub's own.
    <Card
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="line-comment flex max-w-line-comment flex-col gap-control-gap px-list-inset pt-row-inset pb-list-inset"
      onFocus={onActive}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || sending) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <p className="line-comment-head m-0 text-caption-inline font-ui-semibold text-muted-foreground">
        {LINE_WORDS.on(commentLinesLabel(lines))}
      </p>
      <CommentEditor
        variant={REPLY_VARIANT.FIRST}
        label={LINE_WORDS.FIELD}
        placeholder={LINE_WORDS.PLACEHOLDER}
        value={body}
        onChange={onBody}
        busy={sending}
        focus
        onSubmit={() => send(first)}
        onCancel={() => {
          if (!sending) onClose();
        }}
        suggestion={suggestion}
        actions={
          <>
            {headSha === undefined || writes.note?.kind === WRITE_NOTE.WORDS ? (
              <Button size={BUTTON_SIZE.COMPACT} onClick={onRefresh}>
                <ReplayUnmask>{LINE_WORDS.REFRESH}</ReplayUnmask>
              </Button>
            ) : null}
            <Button
              variant={BUTTON_VARIANT.QUIET}
              size={BUTTON_SIZE.COMPACT}
              disabled={sending}
              onClick={onClose}
            >
              <ReplayUnmask>{LINE_WORDS.CANCEL}</ReplayUnmask>
            </Button>
            {holding ? null : (
              <Button
                size={BUTTON_SIZE.COMPACT}
                disabled={blank || sending || headSha === undefined}
                busy={sending && sentAs === REVIEW_COMMENT_MODE.REVIEW}
                busyLabel={LINE_WORDS.SENDING}
                onClick={() => send(REVIEW_COMMENT_MODE.REVIEW)}
              >
                <ReplayUnmask>{LINE_WORDS.START}</ReplayUnmask>
              </Button>
            )}
          </>
        }
        send={{
          label: holding ? LINE_WORDS.ADD : LINE_WORDS.SINGLE,
          empty: blank,
          held: headSha === undefined || (sending && sentAs !== first),
          onSend: () => send(first),
          busy: sending && sentAs === first,
          busyLabel: LINE_WORDS.SENDING,
        }}
      />
      {headSha === undefined ? <p className={NOTE_CLASS}>{LINE_WORDS.NO_HEAD}</p> : null}
      <PullRequestWriteNote writes={writes} className={NOTE_CLASS} />
    </Card>
  );
}
