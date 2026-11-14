/**
 * use-search.ts -- the Search tab as its screen reads it: the tasks, Inbox items, and agents a query finds, each kind best first.
 *
 * Each kind is found by its own list's search over the host's document, so
 * a row found here is one its own tab would find: the Tasks tab's
 * (`useTasksListing`, every task of the workspace whatever its status), the
 * Inbox's under All (`useInboxListing`), and the agents the task list holds.
 * Each is then ranked by what its row says (`@repo/features/search-found-model`),
 * as ⌘K ranks its rows. The Tasks listing also asks the service for the
 * tasks the query finds past the list the host holds, which the host draws
 * into that list, so a finished or older task is found here too.
 */

import { INBOX_SHOW, type InboxListed } from "@repo/features/inbox-list-model";
import {
  agentSearchSubject,
  inboxSearchSubject,
  rankedBySearch,
  taskSearchSubject,
} from "@repo/features/search-found-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import { INBOX_FEED, selectTasks } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxListing } from "../inbox/use-inbox.js";
import {
  agentLine,
  type ReadListing,
  type TaskAgentLine,
  useTasksListing,
  useWaiting,
} from "../tasks/use-tasks.js";

/** Where a read of the task list stands. */
type TasksRead = (typeof TASKS_READ)[keyof typeof TASKS_READ];

/** Where the task list stands while its rows may still be coming: not yet asked, or asked and not yet answered. */
const TASKS_STILL_READING: ReadonlySet<TasksRead> = new Set([TASKS_READ.IDLE, TASKS_READ.READING]);

/** What a query finds: each kind's rows best first, the Tasks listing their rows are drawn and acted on through, and the reader the Inbox's rows are read for. */
export interface SearchFound {
  readonly tasks: readonly TaskSummary[];
  readonly inbox: readonly InboxListed[];
  readonly agents: readonly TaskAgentLine[];
  readonly listing: ReadListing;
  readonly readerId: string | undefined;
  /** Whether the rows were found for what is typed now, the deferred finding caught up. */
  readonly current: boolean;
  /** Whether the Inbox's first read is still out, so an Inbox item it would find may not be held yet. */
  readonly inboxReading: boolean;
  /** Whether the task list, which holds the tasks and the agents on them, is still being read, or the service still searched for the tasks past it, so a task or an agent it would find may not be held yet. */
  readonly tasksReading: boolean;
}

/**
 * The tasks, Inbox items, and agents of the chosen workspace that `typed`
 * finds; none of any while nothing is typed. Note that they are found for a
 * deferred copy of what is typed, as ⌘K ranks its rows, so a key typed
 * draws at once and the finding that follows gives way to the next key.
 */
export function useSearchFound(typed: string): SearchFound {
  const query = useDeferredValue(typed);
  const listing = useTasksListing(query);
  const inbox = useInboxListing({ show: INBOX_SHOW.ALL, search: query });
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const workspace = listing.workspace;
  const waiting = useWaiting(workspace?.id);

  const ranked = useMemo(() => {
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
      inboxReading: inbox.feed === INBOX_FEED.READING,
      // Note that a list read from the phone's disk is still being read again, and a task or agent it would find may only come with that read.
      tasksReading:
        view === undefined || TASKS_STILL_READING.has(view.listStatus) || listing.searching,
    };
  }, [listing, inbox, view, workspace, waiting, query]);

  // Note that whether the finding has caught up is joined after the ranking, so a key typed, which only moves `typed`, never ranks again.
  return useMemo(() => ({ ...ranked, current: query === typed }), [ranked, query, typed]);
}
