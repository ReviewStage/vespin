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
 * Every reading is handed on in the same breath to the task list's
 * collections (`@repo/host/task-list-following`), the panel's own, so a
 * list that reads its rows through a live query is told only the rows that
 * moved, and the two never disagree.
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  type AppStateBridgeReads,
  type FollowedAppState,
  followAppStateOver,
  selectTasks,
  shareAppState,
} from "@repo/host/app-state-reads";
import { type TaskListCollections, taskListFollowing } from "@repo/host/task-list-following";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

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

/** The document followed into the client, and the task list's collections fed from the same readings. */
export interface FollowedAppStateInto extends FollowedAppState {
  readonly taskList: TaskListCollections;
}

/**
 * Writes every reading of the document into `client`, from the moment it
 * is called until it is stopped, as the panel's root does for its window:
 * the first whole read, then each delivery laid over what is held. Each is
 * written into the task list's collections beside it, under its version.
 */
export function followAppStateInto(
  bridge: AppStateBridgeReads,
  client: QueryClient,
): FollowedAppStateInto {
  const taskList = taskListFollowing();

  const followed = followAppStateOver(
    bridge,
    (state) => {
      client.setQueryData(appStateQuery.queryKey, state);
      taskList.write(state.version, selectTasks(state));

      return undefined;
    },
    (message, cause) => {
      console.error(message, cause);
    },
  );

  return {
    ...followed,
    taskList: taskList.collections,
    stop: () => {
      followed.stop();
      taskList.stop();
    },
  };
}
