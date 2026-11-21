/**
 * use-search.ts -- the Search tab as its screen reads it: the tasks, Inbox items, and agents a query finds, each kind best first, and before anything is typed, those last opened.
 *
 * Each kind is found by its own list's search over the host's document, so
 * a row found here is one its own tab would find: the Tasks tab's
 * (`useTasksListing`, every task of the workspace whatever its status), the
 * Inbox's under All (`useInboxListing`), and the agents the task list holds,
 * the workspace's Managers among them where it lists them (`use-managers.ts`).
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
import { type RecentRow, recentRows } from "@repo/features/search-recent-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import { isManager } from "@repo/features/workspace-managers-model";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { INBOX_FEED } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo } from "react";
import { useManagersListed } from "../agents/use-managers.js";
import { appStateQuery } from "../host/app-state-query.js";
import {
  useListedAgents,
  useListedTasks,
  useTaskListCollections,
  useTaskListRows,
} from "../host/host-provider.js";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useInboxListing } from "../inbox/use-inbox.js";
import {
  agentLine,
  type ReadListing,
  type TaskAgentLine,
  useTasksListing,
  useWaiting,
} from "../tasks/use-tasks.js";
import { useRecentOpened } from "./recent-opened.js";

/** Where a read of the task list stands. */
type TasksRead = (typeof TASKS_READ)[keyof typeof TASKS_READ];

/** Where the task list stands while its rows may still be coming: not yet asked, or asked and not yet answered. */
const TASKS_STILL_READING: ReadonlySet<TasksRead> = new Set([TASKS_READ.IDLE, TASKS_READ.READING]);

/** Where the task list's read stands, which says whether a task or an agent the query would find may not be held yet. */
function selectListStatus(state: AppStateSnapshot): TasksRead {
  return state.tasks.listStatus;
}

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
  /** Whether the task list, which holds the tasks and the agents on them, is not yet read, or the service is still searched for the tasks past it, so a task or an agent it would find may not be held yet. */
  readonly tasksReading: boolean;
  /** Every task the list holds, by its id, which an agent found is named by. */
  readonly tasksById: ReadonlyMap<string, TaskSummary>;
}

/**
 * The tasks, Inbox items, and agents of the chosen workspace that `typed`
 * finds; none of any while nothing is typed, and no Inbox item while the
 * member turned the Inbox off. Note that they are found for a
 * deferred copy of what is typed, as ⌘K ranks its rows, so a key typed
 * draws at once and the finding that follows gives way to the next key.
 */
export function useSearchFound(typed: string): SearchFound {
  const query = useDeferredValue(typed);
  const listing = useTasksListing(query);
  const inbox = useInboxListing({ show: INBOX_SHOW.ALL, search: query });
  const inboxShown = useInboxShown();
  const collections = useTaskListCollections();
  const listedTasks = useListedTasks();
  const listedAgents = useListedAgents();
  const pullRequests = useTaskListRows(collections.agentPullRequests);
  const { data: listStatus } = useQuery({ ...appStateQuery, select: selectListStatus });
  const workspace = listing.workspace;
  const waiting = useWaiting(workspace?.id);
  const managersListed = useManagersListed(workspace?.id);

  const ranked = useMemo(() => {
    const tasksById = new Map(listedTasks.map((task) => [task.id, task]));

    // Note that an archived agent is left out, as a task's page leaves it out of its Agents, and so is one on no task, but a Manager while the workspace lists its Managers, as the Tasks tab does.
    const agents = listedAgents.filter(
      (agent) =>
        agent.archivedAt === undefined &&
        (agent.taskId !== null || (managersListed && isManager(agent))) &&
        (workspace === undefined || agent.workspaceId === workspace.id),
    );

    return {
      tasks: rankedBySearch(listing.found, query, (task) =>
        taskSearchSubject(task, workspace?.name),
      ),
      // Note that a blank query ranks nothing, so the Inbox's every item, which it lists with nothing typed, stays out.
      inbox: inboxShown ? rankedBySearch(inbox.listed, query, inboxSearchSubject) : [],
      agents: rankedBySearch(agents, query, (agent) =>
        agentSearchSubject(
          agent,
          agent.taskId === null ? undefined : tasksById.get(agent.taskId)?.name,
        ),
      ).map((agent) => agentLine(agent, waiting.byAgent, pullRequests)),
      tasksById,
    };
  }, [
    listing.found,
    inbox.listed,
    inboxShown,
    listedTasks,
    listedAgents,
    managersListed,
    pullRequests,
    workspace,
    waiting,
    query,
  ]);

  const inboxReading = inboxShown && inbox.feed === INBOX_FEED.READING;

  // Note that a task or agent found past the list held comes only with the service's search, and one on a list not yet read with its first read.
  const tasksReading =
    listStatus === undefined || TASKS_STILL_READING.has(listStatus) || listing.searching;

  // Note that what the rows are read through and whether the finding has caught up are joined after the ranking, so neither a key typed nor a search answered ranks again.
  return useMemo(
    () => ({
      ...ranked,
      listing,
      readerId: inbox.readerId,
      inboxReading,
      tasksReading,
      current: query === typed,
    }),
    [ranked, listing, inbox.readerId, inboxReading, tasksReading, query, typed],
  );
}

/** A row Search's Recent lists: a task, an Inbox thread, or an agent's line. */
export type SearchRecentRow = RecentRow<TaskSummary, InboxListed, TaskAgentLine>;

/** What Search lists before anything is typed: the chosen workspace's openings its lists still hold, newest first, and what their rows are drawn and acted on through. */
export interface SearchRecent {
  readonly rows: readonly SearchRecentRow[];
  readonly listing: ReadListing;
  readonly readerId: string | undefined;
  /** Every task the list holds, by its id, which an agent's row is named by. */
  readonly tasksById: ReadonlyMap<string, TaskSummary>;
}

/**
 * The tasks, Inbox threads, and agents last opened on this phone in the
 * chosen workspace, each drawn from the list its own tab reads, so a row here
 * is the one that tab draws: a task from the task list, a thread from the
 * Inbox while the member keeps it on, and an agent not archived from the
 * agents the task list holds. One no list holds any longer is passed over.
 */
export function useSearchRecent(): SearchRecent {
  const kept = useRecentOpened();
  const listing = useTasksListing("");
  const inbox = useInboxListing({ show: INBOX_SHOW.ALL, search: "" });
  const inboxShown = useInboxShown();
  const listedTasks = useListedTasks();
  const listedAgents = useListedAgents();
  const pullRequests = useTaskListRows(useTaskListCollections().agentPullRequests);
  const workspace = listing.workspace;
  const waiting = useWaiting(workspace?.id);

  const found = useMemo(() => {
    const tasksById = new Map(listedTasks.map((task) => [task.id, task]));
    const threadsById = new Map(inbox.listed.map((listed) => [listed.item.id, listed]));
    const agentsById = new Map(listedAgents.map((agent) => [agent.id, agent]));

    const rows = recentRows(kept, workspace?.id, {
      task: (id) => tasksById.get(id),
      thread: (id) => (inboxShown ? threadsById.get(id) : undefined),
      agent: (id) => {
        const agent = agentsById.get(id);

        return agent === undefined || agent.archivedAt !== undefined
          ? undefined
          : agentLine(agent, waiting.byAgent, pullRequests);
      },
    });

    return { rows, tasksById };
  }, [kept, workspace, listedTasks, inbox.listed, inboxShown, listedAgents, waiting, pullRequests]);

  return useMemo(
    () => ({ ...found, listing, readerId: inbox.readerId }),
    [found, listing, inbox.readerId],
  );
}
