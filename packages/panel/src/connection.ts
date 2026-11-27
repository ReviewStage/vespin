/**
 * connection.ts -- whether this window reaches the service now, the one reading a surface goes quiet by while it does not.
 *
 * It is `@repo/host`'s `networkConnected` over the document's `network`
 * slice, which the Offline mark reads too, so every surface that holds its
 * failures back while the app is offline goes by the same answer the mark
 * says. It is taken as connected until the document is read.
 * `ServiceReachedByWindow` hands the same answer to `@repo/ui`'s
 * `ErrorState` under the window's stage, so no read failure is said beside
 * the mark while it stands.
 */

import { type AppStateSnapshot, networkConnected } from "@repo/host/app-state";
import { ServiceReached } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { appStateQuery } from "./use-app-state.js";

/** Whether the window reaches the service, which redraws its readers only as it turns. */
const selectConnected = (state: AppStateSnapshot): boolean => networkConnected(state.network);

/** Whether the window reaches the service now. */
export function useConnected(): boolean {
  return useQuery({ ...appStateQuery, select: selectConnected }).data ?? true;
}

/** Hands `children` whether the window reaches the service, which every `ErrorState` under them goes quiet by while it does not. */
export function ServiceReachedByWindow({ children }: { children: ReactNode }): React.JSX.Element {
  return createElement(ServiceReached, { value: useConnected() }, children);
}
