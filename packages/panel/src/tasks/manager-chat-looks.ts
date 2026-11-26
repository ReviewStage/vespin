/**
 * manager-chat-looks.ts -- the reader's looks at a Manager's chat, which move their own read mark of it while its page stands open, and their Mark unread from one of its messages.
 *
 * A Manager's row in the sidebar stands unread while its chat said
 * something after the reader's mark (`agent-list-row.tsx`). The page moves
 * the mark as a task's page moves a task's (`use-task-looks.ts`): read
 * through as it opens, seen as it closes, and seen again whenever the chat
 * says something while it stands open, since the reader sees it land. Each
 * look goes quietly, since no person pressed for it.
 *
 * Mark unread, as Slack's, moves the mark back to just before a message,
 * and the page then moves it no more for the rest of the stay, so the chat
 * stays unread until the reader opens it again, and its sidebar row reads
 * unread at once, though its page stands open (`useChatMarkedUnread`). The page draws New over
 * the first message after the mark it found as it opened, where the chat
 * then read unread, or after the one Mark unread left.
 */

import type { ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { READ_MARK, type ReadMark, unreadThroughOf } from "@repo/features/read-mark";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation, pressMutation } from "../act-mutations.js";

/** What the page reads of the reader's mark: where New stands, and Mark unread from a message. */
export interface ManagerChatMark {
  /** The instant New stands after: the mark the page found as it opened where the chat then read unread, or the one Mark unread left; none where nothing stood unread. */
  readonly newAfter: number | undefined;
  /** Moves the reader's mark back to just before the message, and holds it there for the rest of the stay; none for an agent that is no Manager. */
  readonly markUnread: ((message: ManagerChatLiveMessage) => void) | undefined;
}

/** One stay on a Manager's page: the agent, and where New stands. */
interface ChatStay {
  readonly agentId: string | undefined;
  readonly newAfter: number | undefined;
}

/** The Manager whose chat the reader marked unread while its page stands open, none otherwise. */
const markedUnreadStore = createStore<string | undefined>(undefined);

/** Whether the reader marked the Manager's chat unread while its page stands open, so its row reads unread though it is the page on screen. */
export function useChatMarkedUnread(agentId: string): boolean {
  return useSelector(markedUnreadStore, (marked) => marked === agentId);
}

/** A stay as the page opens on the agent: New after the mark it finds, where the chat said something after it. */
function openedStay(
  agentId: string | undefined,
  saidAt: number | undefined,
  readThrough: number | undefined,
): ChatStay {
  const unread = saidAt !== undefined && readThrough !== undefined && saidAt > readThrough;

  return { agentId, newAfter: unread ? readThrough : undefined };
}

/** Moves the reader's mark of the Manager's chat while its page stands open, and offers Mark unread; nothing for an agent that is no Manager (`agentId` none). */
export function useManagerChatLooks(
  agentId: string | undefined,
  saidAt: number | undefined,
  readThrough: number | undefined,
): ManagerChatMark {
  const { mutate: markAgentRead } = useMutation(actMutation(ACT_KIND.AGENTS_MARK_READ));
  const { mutate: markAgentUnread } = useMutation(pressMutation(ACT_KIND.AGENTS_MARK_READ));
  const [stay, setStay] = useState(() => openedStay(agentId, saidAt, readThrough));

  // Note that a page opening on another agent is a stay of its own, found before its first look moves the mark.
  if (stay.agentId !== agentId) setStay(openedStay(agentId, saidAt, readThrough));

  // Note that the closing look reads whether the reader marked the chat unread as it runs, after the stay's last render.
  const markedUnread = useRef(false);

  const look = useCallback(
    (agentId: string, readMark: ReadMark) => {
      if (!markedUnread.current) markAgentRead({ agentId, readMark });
    },
    [markAgentRead],
  );

  useEffect(() => {
    if (agentId === undefined) return;
    markedUnread.current = false;
    look(agentId, READ_MARK.READ);

    return () => {
      look(agentId, READ_MARK.SEEN);
      markedUnreadStore.setState((marked) => (marked === agentId ? undefined : marked));
    };
  }, [agentId, look]);

  // Note that what the chat said as the page opened is read by the look opening it, so only a message during the stay is a look of its own.
  const seen = useRef<{ agentId: string; saidAt: number | undefined } | undefined>(undefined);

  useEffect(() => {
    const was = seen.current;
    seen.current = agentId === undefined ? undefined : { agentId, saidAt };

    if (agentId === undefined || was?.agentId !== agentId || was.saidAt === saidAt) return;
    look(agentId, READ_MARK.SEEN);
  }, [agentId, saidAt, look]);

  const markUnread = useCallback(
    (message: ManagerChatLiveMessage) => {
      if (agentId === undefined) return;
      markedUnread.current = true;
      markedUnreadStore.setState(() => agentId);
      setStay({ agentId, newAfter: unreadThroughOf(message.createdAt) });

      markAgentUnread({
        agentId,
        readMark: READ_MARK.UNREAD,
        unreadFrom: { messageId: message.id, sentAt: message.createdAt },
      });
    },
    [agentId, markAgentUnread],
  );

  return {
    newAfter: stay.agentId === agentId ? stay.newAfter : undefined,
    markUnread: agentId === undefined ? undefined : markUnread,
  };
}
