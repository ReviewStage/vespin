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
 * Mark unread, as Slack's, from any message of the chat, moves the mark
 * back to just before it and marks the chat unread by hand, so it reads
 * unread whoever wrote what follows, until the reader opens it again. The
 * page then moves the mark no more for the rest of the stay, so New stands
 * over that message when the reader comes back, and its sidebar row reads
 * unread at once, though its page stands open (`useChatMarkedUnread`). The
 * page draws New over the first message after the mark it found as it
 * opened, where the chat then read unread, skipping the reader's own unless
 * they marked it unread, or over the message Mark unread was pressed on.
 */

import type { AgentSummary } from "@repo/features/agent-wire";
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
  /** Whether New may stand over the reader's own message, as it does where they marked the chat unread from it; else it skips their own. */
  readonly newOverOwn: boolean;
  /** Moves the reader's mark back to just before the message, and holds it there for the rest of the stay; none for an agent that is no Manager. */
  readonly markUnread: ((message: ManagerChatLiveMessage) => void) | undefined;
}

/** The reader's mark of the chat as its row carries it, and when the Manager last said something. */
type ChatMarkRead = Pick<AgentSummary, "saidAt" | "readThrough" | "markedUnread">;

/** One stay on a Manager's page: the agent, where New stands, and whether it may stand over the reader's own message. */
interface ChatStay {
  readonly agentId: string | undefined;
  readonly newAfter: number | undefined;
  readonly newOverOwn: boolean;
}

/** The Manager whose chat the reader marked unread while its page stands open, none otherwise. */
const markedUnreadStore = createStore<string | undefined>(undefined);

/** Whether the reader marked the Manager's chat unread while its page stands open, so its row reads unread though it is the page on screen. */
export function useChatMarkedUnread(agentId: string): boolean {
  return useSelector(markedUnreadStore, (marked) => marked === agentId);
}

/** A stay as the page opens on the agent: New after the mark it finds, where the reader marked the chat unread, over their own message too, or where it said something after the mark. */
function openedStay(agentId: string | undefined, mark: ChatMarkRead): ChatStay {
  const { saidAt, readThrough, markedUnread } = mark;
  const said = saidAt !== undefined && readThrough !== undefined && saidAt > readThrough;
  const unread = markedUnread === true || said;

  return { agentId, newAfter: unread ? readThrough : undefined, newOverOwn: markedUnread === true };
}

/** Moves the reader's mark of the Manager's chat while its page stands open, and offers Mark unread; nothing for an agent that is no Manager (`agentId` none). */
export function useManagerChatLooks(
  agentId: string | undefined,
  mark: ChatMarkRead,
): ManagerChatMark {
  const { saidAt } = mark;
  const { mutate: markAgentRead } = useMutation(actMutation(ACT_KIND.AGENTS_MARK_READ));
  const { mutate: markAgentUnread } = useMutation(pressMutation(ACT_KIND.AGENTS_MARK_READ));
  const [stay, setStay] = useState(() => openedStay(agentId, mark));

  // Note that a page opening on another agent is a stay of its own, found before its first look moves the mark.
  if (stay.agentId !== agentId) setStay(openedStay(agentId, mark));

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
      const before = stay;
      markedUnread.current = true;
      markedUnreadStore.setState(() => agentId);
      setStay({ agentId, newAfter: unreadThroughOf(message.createdAt), newOverOwn: true });

      // Note that a mark the service did not take is let go, as the host lets its drawn mark go, and the looks held meanwhile are caught up by one.
      const refused = () => {
        markedUnread.current = false;
        markedUnreadStore.setState((marked) => (marked === agentId ? undefined : marked));
        setStay((standing) => (standing.agentId === agentId ? before : standing));
        markAgentRead({ agentId, readMark: READ_MARK.SEEN });
      };

      markAgentUnread(
        {
          agentId,
          readMark: READ_MARK.UNREAD,
          unreadFrom: { messageId: message.id, sentAt: message.createdAt },
        },
        {
          onError: refused,
          onSuccess: (answer) => {
            if ("failure" in answer) refused();
          },
        },
      );
    },
    [agentId, stay, markAgentRead, markAgentUnread],
  );

  const current = stay.agentId === agentId;

  return {
    newAfter: current ? stay.newAfter : undefined,
    newOverOwn: current && stay.newOverOwn,
    markUnread: agentId === undefined ? undefined : markUnread,
  };
}
