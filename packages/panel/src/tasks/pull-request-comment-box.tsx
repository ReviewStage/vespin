import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
import { useRef, useState } from "react";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import { REPLY_VARIANT } from "./comment-variant.js";
import {
  PullRequestWriteNote,
  type PullRequestWrites,
  type ReadAgain,
  usePullRequestWrites,
} from "./pull-request-writes.js";

/**
 * pull-request-comment-box.tsx -- the comment box at the foot of an agent's pull request's Conversation, as GitHub's own: a new comment on the pull request itself, in Markdown.
 *
 * The comment is one change (`PULL_REQUEST_ACTION.COMMENT`), made on GitHub
 * by the service as the member pressing Comment, on their own GitHub
 * sign-in and never our GitHub App's. Once GitHub took it the box lets
 * its words go and the tab reads the conversation again, so the comment
 * stands in it; GitHub's refusal stands under the box in its own words,
 * with the sign-in offered where GitHub would not take the member's, and
 * the words written stay for another try. The box stands as a thread's
 * reply does, its round Comment in its foot. The words are held by the tab
 * (`usePullRequestComment`) rather than the box, so a read of the
 * conversation that fails, which takes the box away until Retry, loses
 * nothing written.
 */

/** The box's own words. */
const COMMENT_WORDS = {
  TITLE: "Add a comment",
  FIELD: "Comment",
  PLACEHOLDER: "Add a comment",
  SEND: "Comment",
  SENDING: "Commenting",
} as const;

/** The comment being written, held for as long as the tab stands, and its own change. */
export interface PullRequestComment {
  readonly writes: PullRequestWrites;
  readonly body: string;
  readonly setBody: (body: string) => void;
}

/** The comment box's words and change, for the tab to hold across the box coming and going. */
export function usePullRequestComment(agentId: string, onWritten: ReadAgain): PullRequestComment {
  const writes = usePullRequestWrites(agentId, onWritten);
  const [body, setBody] = useState("");
  return { writes, body, setBody };
}

/** The box: its heading, the words written as they are drawn, with Comment in their foot, which Enter in the words presses too, and GitHub's answer where it did not take the last one. */
export function PullRequestCommentBox({
  comment,
}: {
  comment: PullRequestComment;
}): React.JSX.Element {
  const { writes, body, setBody } = comment;
  const sending = writes.pending !== undefined;
  const field = useRef<HTMLElement>(null);
  const blank = body.trim() === "" || overCommentBound(body);
  const send = () => {
    if (blank || sending) return;
    writes.write({ action: PULL_REQUEST_ACTION.COMMENT, body }, () => setBody(""));
  };
  return (
    <section
      className="pull-request-section pull-request-comment-box flex flex-col gap-control-gap"
      aria-label={COMMENT_WORDS.TITLE}
    >
      <Text
        as={TEXT_ELEMENT.H3}
        variant={TEXT_VARIANT.GROUP}
        truncate
        className="pull-request-heading mx-0 mt-0 mb-item-gap flex items-baseline gap-item-gap px-row-inset"
      >
        {COMMENT_WORDS.TITLE}
      </Text>
      <CommentEditor
        variant={REPLY_VARIANT.REPLY}
        label={COMMENT_WORDS.FIELD}
        placeholder={COMMENT_WORDS.PLACEHOLDER}
        value={body}
        onChange={setBody}
        busy={sending}
        onSubmit={send}
        // Note that Esc lets go of the box and keeps its words, so it never reaches the window, which would leave the task.
        onCancel={() => field.current?.blur()}
        fieldRef={field}
        send={{
          label: COMMENT_WORDS.SEND,
          empty: blank,
          held: false,
          onSend: send,
          busy: sending,
          busyLabel: COMMENT_WORDS.SENDING,
        }}
      />
      <PullRequestWriteNote writes={writes} className="pull-request-comment-note" />
    </section>
  );
}
