/**
 * manager-chat-looks.ts -- the reader's looks at a Manager's chat, which move their own read mark of it while its page stands open.
 *
 * A Manager's row in the sidebar stands unread while its chat said
 * something after the reader's mark (`agent-list-row.tsx`). The page moves
 * the mark as a task's page moves a task's (`use-task-looks.ts`): read
 * through as it opens, seen as it closes, and seen again whenever the chat
 * says something while it stands open, since the reader sees it land. Each
 * look goes quietly, since no person pressed for it.
 */

import { READ_MARK, type ReadMark } from "@repo/features/read-mark";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { actMutation } from "../act-mutations.js";

/** Moves the reader's mark of the Manager's chat while its page stands open; nothing for an agent that is no Manager (`agentId` none). */
export function useManagerChatLooks(agentId: string | undefined, saidAt: number | undefined): void {
  const { mutate: markAgentRead } = useMutation(actMutation(ACT_KIND.AGENTS_MARK_READ));

  const look = useCallback(
    (agentId: string, readMark: ReadMark) => markAgentRead({ agentId, readMark }),
    [markAgentRead],
  );

  useEffect(() => {
    if (agentId === undefined) return;
    look(agentId, READ_MARK.READ);

    return () => look(agentId, READ_MARK.SEEN);
  }, [agentId, look]);

  // Note that what the chat said as the page opened is read by the look opening it, so only a message during the stay is a look of its own.
  const seen = useRef<{ agentId: string; saidAt: number | undefined } | undefined>(undefined);

  useEffect(() => {
    const was = seen.current;
    seen.current = agentId === undefined ? undefined : { agentId, saidAt };

    if (agentId === undefined || was?.agentId !== agentId || was.saidAt === saidAt) return;
    look(agentId, READ_MARK.SEEN);
  }, [agentId, saidAt, look]);
}
