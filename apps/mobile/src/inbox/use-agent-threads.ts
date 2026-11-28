/**
 * use-agent-threads.ts -- the line over an agent's box while it has posted threads, as the panel's threads dock reads it: what waits on the reader, or, quiet, how many there are, and the thread a press opens.
 *
 * The agent's threads are read from the account's feed, the one every
 * Inbox screen reads (`useInboxGroupsIn`), with the sends still out drawn
 * over it, so the line moves as the Inbox does; which of them waits on the
 * reader, and what the line says, is `@repo/features`' `agentThreadsLine`,
 * the panel's own rule. While the member turned the Inbox off, no Inbox
 * stands to open, so no line stands either.
 */

import {
  type AgentThreadsLine,
  agentThreadsLine,
  inboxRowGroups,
} from "@repo/features/inbox-list-model";
import { selectInboxReader } from "@repo/host/app-state-reads";
import { INBOX_REACH, type InboxReach } from "@repo/host/inbox-rows";
import { useMinute } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxGroupsIn } from "./inbox-groups.js";
import { useInboxShown } from "./inbox-shown.js";
import { useSendsDrawn } from "./use-thread-answer.js";

/** The line over the box of the agent `agentId`; none while it posted no thread the feed holds, or the Inbox is off. */
export function useAgentThreadsLine(agentId: string): AgentThreadsLine | undefined {
  // Note that the line counts every thread the agent posted, so only that agent's are read, settled ones too.
  const reach = useMemo((): InboxReach => ({ kind: INBOX_REACH.AGENT, agentId }), [agentId]);
  const groups = useSendsDrawn(useInboxGroupsIn(undefined, reach));
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const shown = useInboxShown();
  // Note that the minute's tick lets a reminder that came due count the thread as waiting again, as the Inbox's own count does.
  const now = useMinute();

  return useMemo(
    () =>
      shown
        ? agentThreadsLine(
            inboxRowGroups(groups).flatMap((group) => group.items),
            agentId,
            readerId,
            now,
          )
        : undefined,
    [shown, groups, agentId, readerId, now],
  );
}
