// message-link.ts -- a message's address on vespin.dev under its agent, as its long press menu's Copy link copies it.

import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";

/**
 * A message's address on vespin.dev under its agent, as the panel's Copy
 * link names one (`agentMessagePlace`), by the message's id: a transcript's,
 * or one of a Manager's chat's, a reply in a thread among them; none before
 * the agent's workspace is known.
 */
export function useMessageLink(
  agentId: string,
  workspaceId: string | undefined,
): ((messageId: string) => string | undefined) | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);

  // Note that the link is made once a step, so the rows that copy it are drawn again only as it moves.
  return useMemo(
    () =>
      step === undefined
        ? undefined
        : (messageId: string) =>
            linkOf({ kind: LINK_DESTINATION.MESSAGE, agentId, messageId }, step),
    [agentId, step],
  );
}
