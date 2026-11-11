import { BUTTON_SIZE, BUTTON_VARIANT, Button } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useState } from "react";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import { REPLY_VARIANT } from "./comment-variant.js";

/**
 * reply-form.tsx -- the words of a member's pending GitHub comment written again, with their Cancel and their save.
 *
 * An edit's form, standing as a description comment's edit does: the
 * Markdown field (`CommentEditor`) bare in the comment it edits, its words
 * where they were read, and under them the shared foot holding a quiet
 * Cancel before the round save. Enter
 * sends, Shift+Enter adds a line, Esc lets the form go keeping its
 * words, and Cancel lets them go too. The owner holds the words, through
 * `onWrite`, so what Esc closed is there when the form opens again; it
 * closes the form once GitHub took them.
 *
 * While a change to the comment's thread is out, this one or another, the
 * form stands still: the field and Cancel take no press and Esc closes
 * nothing, and the send is busy only where the change out is its own.
 */

/** The form's words: what its field is named, what it asks for, and what Cancel and the send say. */
export interface ReplyFormWords {
  readonly field: string;
  readonly placeholder: string;
  readonly cancel: string;
  /** What the send does, which is its name: "Reply", "Save". */
  readonly send: string;
  /** What the send is named while its change is out. */
  readonly sending: string;
}

/** The form over `start`, its words handed to `onWrite` as they change. */
export function ReplyForm({
  words,
  start,
  busy,
  sending,
  onWrite,
  onSend,
  onLeave,
  onDiscard,
}: {
  words: ReplyFormWords;
  /** The words it opens on. */
  start: string;
  /** Whether a change to the thread is out, this one or another. */
  busy: boolean;
  /** Whether the change out is this form's own. */
  sending: boolean;
  /** Hears the words as they change, for the owner that keeps them. */
  onWrite: (body: string) => void;
  onSend: (body: string) => void;
  /** Esc: the form goes, the owner keeping its words. */
  onLeave: () => void;
  /** Cancel: the form goes, and the owner lets its words go. */
  onDiscard: () => void;
}): React.JSX.Element {
  const [body, setBody] = useState(start);
  const blank = body.trim() === "" || overCommentBound(body);
  const send = () => {
    if (!blank && !busy) onSend(body);
  };
  return (
    <CommentEditor
      variant={REPLY_VARIANT.EDIT}
      label={words.field}
      placeholder={words.placeholder}
      value={body}
      onChange={(next) => {
        setBody(next);
        onWrite(next);
      }}
      busy={busy}
      focus
      onSubmit={send}
      onCancel={() => {
        if (!busy) onLeave();
      }}
      actions={
        <Button
          variant={BUTTON_VARIANT.QUIET}
          size={BUTTON_SIZE.COMPACT}
          disabled={busy}
          onClick={onDiscard}
        >
          <ReplayUnmask>{words.cancel}</ReplayUnmask>
        </Button>
      }
      send={{
        label: words.send,
        empty: blank,
        held: busy && !sending,
        onSend: send,
        busy: sending,
        busyLabel: words.sending,
      }}
    />
  );
}
