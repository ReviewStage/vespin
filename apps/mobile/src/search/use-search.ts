/**
 * use-search.ts -- the Search tab as its screen reads it: the tasks, Inbox items, and agents a query finds, each kind best first.
 *
 * Each kind is found by its own list's search over the host's document, so
 * a row found here is one its own tab would find: the Tasks tab's
 * (`useTasksListing`, every task of the workspace whatever its status), the
 * Inbox's under All (`useInboxListing`), and the agents the task list holds.
 * Each is then ranked by what its row says (`@repo/features/search-found-model`),
 * as ⌘K ranks its rows; no act and no read of the service is added.
 */

import { INBOX_SHOW, type InboxListed } from "@repo/features/inbox-list-model";
import {
  agentSearchSubject,
  inboxSearchSubject,
  rankedBySearch,
  taskSearchSubject,
} from "@repo/features/search-found-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { selectTasks } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxListing } from "../inbox/use-inbox.js";
import {
  agentLine,
  type ReadListing,
  type TaskAgentLine,
  useTasksListing,
  useWaiting,
} from "../tasks/use-tasks.js";

/** What a query finds: each kind's rows best first, the Tasks listing their rows are drawn and acted on through, and the reader the Inbox's rows are read for. */
export interface SearchFound {
  readonly tasks: readonly TaskSummary[];
  readonly inbox: readonly InboxListed[];
  readonly agents: readonly TaskAgentLine[];
  readonly listing: ReadListing;
  readonly readerId: string | undefined;
}

/** The tasks, Inbox items, and agents of the chosen workspace that `query` finds; none of any while nothing is typed. */
export function useSearchFound(query: string): SearchFound {
  const listing = useTasksListing(query);
  const inbox = useInboxListing({ show: INBOX_SHOW.ALL, search: query });
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const workspace = listing.workspace;
  const waiting = useWaiting(workspace?.id);
  return useMemo(() => {
    const names = new Map((view?.tasks ?? []).map((task) => [task.id, task.name]));
    // Note that an archived agent is left out, as a task's page leaves it out of its Agents.
    const agents = (view?.taskAgents ?? []).filter(
      (agent) =>
        agent.archivedAt === undefined &&
        (workspace === undefined || agent.workspaceId === workspace.id),
    );
    return {
      tasks: rankedBySearch(listing.found, query, (task) =>
        taskSearchSubject(task, workspace?.name),
      ),
      // Note that a blank query ranks nothing, so the Inbox's every item, which it lists with nothing typed, stays out.
      inbox: rankedBySearch(inbox.listed, query, inboxSearchSubject),
      agents: rankedBySearch(agents, query, (agent) =>
        agentSearchSubject(agent, names.get(agent.planId)),
      ).map((agent) => agentLine(agent, waiting.byAgent, view)),
      listing,
      readerId: inbox.readerId,
    };
  }, [listing, inbox, view, workspace, waiting, query]);
}
