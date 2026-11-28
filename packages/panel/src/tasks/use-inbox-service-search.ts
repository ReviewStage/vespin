/**
 * use-inbox-service-search.ts -- a search field's ask of the service for the Inbox items its words find past what the host holds: the shared pause-then-ask mounted for one place, and the items that place found.
 *
 * The field's own filter finds the items the host holds at once. The words
 * are asked of the host too, once typing pauses, through the one search
 * every client mounts (`@repo/features/inbox-service-search`), which keeps a
 * search out at a time for its place; the host reads what the service finds
 * and holds it for the place (`LIVE_READ.INBOX_FOUND`), which is read back
 * here only while the field's words ask, for the surface to lay beside the
 * items it holds, under the scope it shows. A field that stops asking, its
 * screen gone or ⌘K closed, leaves its place's search (`leave`) rather than
 * letting it go, so an item opened from what it found stays drawn.
 */

import {
  type InboxSearchPlace,
  inboxServiceSearch,
  serviceInboxSearchQuery,
} from "@repo/features/inbox-service-search";
import { ACT_KIND } from "@repo/host/acts";
import type { AppInboxItems } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { askAct } from "../act.js";
import { inboxFoundQuery } from "../live-reads.js";

/** What a field reads of its place's search of the service: the items it found, none while its words ask nothing, and whether the answer to its words is still to come. */
export interface InboxServiceSearchRead {
  readonly found: AppInboxItems | undefined;
  readonly searching: boolean;
}

/** The service asked for the items `typed` finds at `place` while `asked`; see the module's head. */
export function useInboxServiceSearch(
  place: InboxSearchPlace,
  typed: string,
  asked: boolean,
): InboxServiceSearchRead {
  const [search] = useState(() =>
    inboxServiceSearch({ place, ask: (params) => askAct(ACT_KIND.AGENTS_INBOX_SEARCH, params) }),
  );

  const words = asked ? typed : "";

  const asks = serviceInboxSearchQuery(words) !== undefined;

  // Note that a field asking nothing more, ⌘K closed or its words cleared, leaves its place's found items standing in the host, where an item opened from them is still read (`selectInboxHeldBeyondFeed`), until the place's next search or a sign-out.
  useEffect(() => {
    if (asks) search.type(words);
    else search.leave();
  }, [search, words, asks]);

  useEffect(() => () => search.leave(), [search]);

  const searching = useSyncExternalStore(search.subscribe, search.searching);
  const { data } = useQuery(inboxFoundQuery(asks ? place : undefined));

  return { found: asks ? data?.items : undefined, searching };
}
