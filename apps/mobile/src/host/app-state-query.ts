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
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  type AppStateBridgeReads,
  type FollowedAppState,
  followAppStateOver,
} from "@repo/host/app-state-reads";
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
  retry: false,
});

/**
 * Writes every reading of the document into `client`, from the moment it
 * is called until it is stopped, as the panel's root does for its window:
 * the first whole read, then each delivery laid over what is held.
 */
export function followAppStateInto(
  bridge: AppStateBridgeReads,
  client: QueryClient,
): FollowedAppState {
  return followAppStateOver(
    bridge,
    (state) => {
      client.setQueryData(appStateQuery.queryKey, state);
      return undefined;
    },
    (message, cause) => {
      console.error(message, cause);
    },
  );
}
