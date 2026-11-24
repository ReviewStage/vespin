/**
 * manager-chat-threads.tsx -- a Manager's chat's threads: Reply in thread on a message, the summary of its replies under it, and the thread's pane beside the chat with its own reply box.
 *
 * A Manager's chat is a team channel (`@repo/features/manager-chat-view`):
 * anyone may answer a message in its thread, the Manager with
 * `send_to_user`'s `thread_ts` and a person from the thread's pane. Each
 * message of the chat offers Reply in thread beside its Copy, and one others
 * answered says so under its words with the faces of who answered
 * (`ThreadSummary`); either opens its thread in a pane at the chat's end
 * (`ManagerThreadPane`), whose box sends the reader's words to the chat as a
 * reply in that thread (`threadRoot`). A reply also posted to the chat
 * stands at its top too, where both open the thread it stands in.
 */

import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import type { ManagerChatLine } from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { ThreadPane, ThreadReplies } from "@repo/ui";
import { MessageSquareReplyIcon } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { type ReactNode, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { MessageAction } from "../ai-elements/message.js";
import { usePerson } from "../member-directory.js";
import { MessageBox, useMessageBox } from "./message-box.js";

/** The words of a thread's presses and its box. */
const THREAD_WORDS = {
  REPLY: "Reply in thread",
  BOX: "Reply…",
  SEND: "Reply",
} as const;

/** The most characters a reply's words may spell, as a message to the chat may. */
const THREAD_REPLY_CHARS = 8_000;

/** Reply in thread beside a message's Copy, which opens its thread (`onOpen`). */
export function ThreadReplyAction({ onOpen }: { onOpen: () => void }): ReactNode {
  return (
    <MessageAction label={THREAD_WORDS.REPLY} tooltip={THREAD_WORDS.REPLY} onClick={onOpen}>
      <MessageSquareReplyIcon />
    </MessageAction>
  );
}

/** A person's face beside a thread's summary, as their account stands. */
function PersonFace({ userId, name }: { userId: string | null; name: string }): ReactNode {
  const actor = usePerson(userId === null ? undefined : { userId, name });

  return <ActorMark actor={actor} size={ACTOR_SIZE.ROW} />;
}

/** One face to each replier, in the order they first answered: the Manager's, or each person's. */
function replierFaces(
  replies: readonly ManagerChatLine[],
  face: ManagerFaceValue | undefined,
): readonly ReactNode[] {
  const seen = new Set<string>();
  const faces: ReactNode[] = [];

  for (const { message } of replies) {
    const manager = message.authorKind === MANAGER_CHAT_AUTHOR.AGENT;
    const who = manager ? MANAGER_CHAT_AUTHOR.AGENT : (message.authorUserId ?? message.authorName);

    if (seen.has(who)) continue;
    seen.add(who);

    faces.push(
      manager ? (
        face === undefined ? null : (
          <ManagerFace face={face} size={MANAGER_FACE_SIZE.ROW} />
        )
      ) : (
        <PersonFace userId={message.authorUserId} name={message.authorName} />
      ),
    );
  }

  return faces;
}

/** The summary of a thread under the message it stands on, which opens it; none where no one answered it. */
export function ThreadSummary({
  replies,
  face,
  open,
  onOpen,
}: {
  replies: readonly ManagerChatLine[] | undefined;
  /** The Manager's face, beside its replies. */
  face: ManagerFaceValue | undefined;
  open: boolean;
  onOpen: () => void;
}): ReactNode {
  if (replies === undefined || replies.length === 0) return null;

  return (
    <ThreadReplies
      count={replies.length}
      faces={replierFaces(replies, face)}
      open={open}
      onOpen={onOpen}
    />
  );
}

/** A thread's box: the reader's words, sent through `onSend` as a reply in the thread. */
function ThreadBox({ onSend }: { onSend: (text: string) => void }): ReactNode {
  const [words, setWords] = useState("");

  const send = () => {
    const trimmed = words.trim();

    if (trimmed === "") return;
    setWords("");
    onSend(trimmed);
  };

  const box = useMessageBox({
    draft: words,
    setDraft: setWords,
    placeholder: THREAD_WORDS.BOX,
    label: THREAD_WORDS.BOX,
    maxLength: THREAD_REPLY_CHARS,
    onSubmit: send,
    focus: true,
    // Note that a reply goes as words alone, so the box offers no file it would drop.
    takesFiles: false,
  });

  return (
    <MessageBox
      box={box}
      send={{ label: THREAD_WORDS.SEND, empty: words.trim() === "", onSend: send }}
    />
  );
}

/**
 * The open thread's pane beside the chat: the message it stands on (`root`)
 * and its replies, each drawn as the chat draws its rows, and its box, which
 * sends through `onSend` where the chat takes words; closed by `onClose`.
 */
export function ManagerThreadPane({
  root,
  replies,
  count,
  onSend,
  onClose,
  rootKey,
}: {
  root: ReactNode;
  replies: ReactNode;
  count: number;
  /** The thread's root's id, under which its box keeps its words apart from another thread's. */
  rootKey: string;
  onSend: ((text: string) => void) | undefined;
  onClose: () => void;
}): ReactNode {
  return (
    <ThreadPane
      root={root}
      count={count}
      onClose={onClose}
      composer={onSend === undefined ? null : <ThreadBox key={rootKey} onSend={onSend} />}
    >
      {replies}
    </ThreadPane>
  );
}
