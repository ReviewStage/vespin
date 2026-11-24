/**
 * app-state-query.ts -- the host's document as one TanStack Query query of the app's own, which a screen reads its slice of with `useQuery({ ...appStateQuery, select })`.
 *
 * The panel reads the document the same way (`@repo/panel`'s
 * `use-app-state.ts`), over the one follower both share
 * (`@repo/host/app-state-reads`); the query itself is declared here again
 * because it is bound to the app's own `@tanstack/react-query`, on the
 * app's React, which the panel's is not. Every reading is written into the
 * client as it arrives (`followAppStateInto`), the first before anything is
 * drawn, so it is never stale and never read again; its `queryFn` answers
 * what the client already holds, and stands only for a reader on a client
 * nothing follows into, which refuses.
 *
 * The task list's collections (`@repo/host/task-list-following`), the
 * panel's own, are fed beside it from the rows each delivery carries beside
 * the document (its `taskList`), handed on before the document is written,
 * so a list that reads its rows through a live query is told only the rows
 * that moved, and is never behind the document.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  type AppStateBridgeReads,
  type FollowedAppState,
  followAppStateOver,
  shareAppState,
} from "@repo/host/app-state-reads";
import { type TaskListCollections, taskListFollowing } from "@repo/host/task-list-following";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { noteDelivered } from "../launch-phases.js";

/** The one key the document is held under in the app's client. */
const APP_STATE_KEY = "app-state";

export const appStateQuery = queryOptions({
  queryKey: [APP_STATE_KEY],
  queryFn: ({ client }): Promise<AppStateSnapshot> => {
    const held: AppStateSnapshot | undefined = client.getQueryData([APP_STATE_KEY]);

    return held === undefined
      ? Promise.reject(new Error("The host's document is followed into the client, never fetched."))
      : Promise.resolve(held);
  },
  staleTime: Infinity,
  structuralSharing: shareAppState,
  retry: false,
});

/** The archived agents the task list keeps back while the launch draws its first screens (`deferArchivedAgents`), and the doors that write them. */
export interface DeferredAgents {
  /** Writes up to `count` of them in one commit, and answers how many still wait. */
  readonly write: (count: number) => number;
  /** Writes every one still waiting at once. */
  readonly flush: () => void;
}

/** The document followed into the client, and the task list's collections fed from the same readings. */
export interface FollowedAppStateInto extends FollowedAppState {
  readonly taskList: TaskListCollections;
  readonly deferredAgents: DeferredAgents;
}

/** No agent: what the Inbox names before its first read. */
const NO_AGENT_IDS: readonly string[] = [];

/** Every agent the Inbox's threads stand on, or are held by, in the document as it stands. */
function inboxAgentIdsOf(state: AppStateSnapshot): readonly string[] {
  const rows = state[LIVE_READ.INBOX_ITEMS].rows;

  if (rows === undefined) return NO_AGENT_IDS;
  const held = [...Object.values(rows.task), ...Object.values(rows.agents ?? {})];

  return [...Object.keys(rows.agents ?? {}), ...held.flat().map((item) => item.agentId)];
}

/**
 * Writes every reading of the document into `client`, from the moment it
 * is called until it is stopped, as the panel's root does for its window:
 * the first whole read, then each delivery laid over what is held. The task
 * list's collections take the lists the whole read answers beside the
 * document, and the rows each delivery carries beside it, heard from before
 * the read is asked.
 */
export function followAppStateInto(
  bridge: AppStateBridgeReads,
  client: QueryClient,
): FollowedAppStateInto {
  // Note that the archived agents on a task are kept back while the launch draws, since none of its first screens lists one, and the host provider writes them once the first frame stands; those the Inbox names are written at once, since its rows name their agents.
  const taskList = taskListFollowing({ deferArchivedAgents: true });
  let inboxRead: unknown;

  const followed = followAppStateOver(
    bridge,
    (state) => {
      client.setQueryData(appStateQuery.queryKey, state);

      if (state[LIVE_READ.INBOX_ITEMS] !== inboxRead) {
        inboxRead = state[LIVE_READ.INBOX_ITEMS];
        taskList.keepAgents(inboxAgentIdsOf(state));
      }

      noteDelivered();

      return undefined;
    },
    (message, cause) => {
      console.error(message, cause);
    },
    {
      heard: ({ taskList: rows }) => {
        if (rows !== undefined) taskList.deliver(rows);
      },
      read: (read, lists) => taskList.write(read.version, lists),
    },
  );

  return {
    ...followed,
    taskList: taskList.collections,
    deferredAgents: { write: taskList.writeDeferredAgents, flush: taskList.flushDeferredAgents },
    stop: () => {
      followed.stop();
      taskList.stop();
    },
  };
}
