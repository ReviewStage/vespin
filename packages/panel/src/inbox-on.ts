/**
 * inbox-on.ts -- whether the account keeps an Inbox, which every surface that draws or opens it asks before it does.
 *
 * An account that turned its Inbox off (`@repo/settings`'s `inbox`) has its
 * agents ask in their replies, so no window of it draws the Inbox: no
 * sidebar row, no phone bar item, no Home section, no ⌘K entry or chord, and
 * no route (`route-gates.ts`'s `inboxRouteStands`). An agent's own threads
 * still open from its card, since a teammate's agent may still post one.
 */

import { useQuery } from "@tanstack/react-query";
import { appStateQuery, selectInboxOn } from "./use-app-state.js";

/** Whether the account keeps an Inbox, redrawn as the choice moves; it stands while the settings are unread. */
export function useInboxOn(): boolean {
  return useQuery({ ...appStateQuery, select: selectInboxOn }).data !== false;
}
