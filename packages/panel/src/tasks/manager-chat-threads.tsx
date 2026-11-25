/**
 * manager-chat-threads.tsx -- a Manager's chat's threads: Reply in thread on a message, the summary of its replies under it, and the door that opens the thread in a tab of the page's side panel.
 *
 * A Manager's chat is a team channel (`@repo/features/manager-chat-view`):
 * anyone may answer a message in its thread, the Manager with
 * `chat_send`'s `thread_ts` and a person from the thread's tab. Each
 * message of the chat offers Reply in thread beside its Copy, and one others
 * answered says so under its words with the faces of who answered
 * (`ThreadSummary`); either opens its thread in a Thread tab of the page's
 * side panel (`ThreadDoorsProvider`), the panel every page opens beside it,
 * resized and kept as it is, whose box, the chat's own composer, sends the
 * reader's words and files to the chat as a reply in that thread
 * (`threadRoot`). A reply also posted to the chat stands at its top too,
 * where both open the thread it stands in.
 */

import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import { CHAT_THREAD_WORDS, type ManagerChatLine } from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { ThreadReplies } from "@repo/ui";
import { MessageSquareReplyIcon } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { createContext, type ReactNode, use } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { MessageAction } from "../ai-elements/message.js";
import { usePerson } from "../member-directory.js";

/** The words of a thread's presses and its box, as every client says them. */
export const THREAD_WORDS = CHAT_THREAD_WORDS;

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

/** Where the chat opens its threads: the one its page's side panel shows, and the press that opens one there. */
export interface ThreadDoors {
  /** The thread the panel shows, by the message it stands on; none while it shows none. */
  readonly open: string | undefined;
  readonly onOpen: (root: string) => void;
}

const ThreadDoorsContext = createContext<ThreadDoors | undefined>(undefined);

/** Hands a Manager's chat the side panel its threads open in: its page's. */
export const ThreadDoorsProvider = ThreadDoorsContext.Provider;

/** Where the chat opens its threads; none where nothing beside it shows one, and its messages offer no thread. */
export function useThreadDoors(): ThreadDoors | undefined {
  return use(ThreadDoorsContext);
}
