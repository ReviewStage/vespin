/**
 * use-inbox-service-search.ts -- an Inbox search's ask of the service for the items its words find past what the phone holds: the shared pause-then-ask mounted for one place, on the host's act port.
 *
 * The listing's own filter finds the items the phone holds at once. The
 * words are asked of the host too, once typing pauses, through the one
 * search every client mounts (`@repo/features/inbox-service-search`), which
 * keeps one search out at a time for its place, as the panel's field mounts
 * it (`use-inbox-service-search.ts` there). The host reads what the service
 * finds and holds it for the place (`LIVE_READ.INBOX_FOUND`), which the
 * Inbox is grouped with under All (`inbox-groups.tsx`), never here. A screen
 * gone stops asking but leaves what its place found standing, where a thread
 * opened from it is still read, until the place's next search.
 */

import {
  type InboxSearchPlace,
  inboxServiceSearch,
  serviceInboxSearchQuery,
} from "@repo/features/inbox-service-search";
import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useHostActs } from "../host/host-provider.js";

/** What a listing reads of its place's search of the service: whether its words ask it anything, and whether the answer to them is still to come. */
export interface InboxServiceSearchRead {
  readonly asks: boolean;
  readonly searching: boolean;
}

/** The service asked for the items `typed` finds at `place` while `asked`; see the module's head. Note that `place` is read once, as the screen's search is made, since each screen searches from one place. */
export function useInboxServiceSearch(
  place: InboxSearchPlace,
  typed: string,
  asked: boolean,
): InboxServiceSearchRead {
  const acts = useHostActs();

  // Note that the search is made once for the screen, so its place keeps one search out however often the screen draws.
  const [search] = useState(() =>
    inboxServiceSearch({ place, ask: (params) => acts[ACT_KIND.AGENTS_INBOX_SEARCH](params) }),
  );

  const words = asked ? typed : "";
  const asks = serviceInboxSearchQuery(words) !== undefined;

  // Note that words too few to ask leave the search rather than let it go, for the same reason as the screen going below: the listing lists what the place found only while it asks (`use-inbox.ts`).
  useEffect(() => {
    if (asks) search.type(words);
    else search.leave();
  }, [search, words, asks]);

  // Note that the search is left as the screen goes but what it found is not let go, because a thread opened from it may stand on another screen, as an iPad opens a Search row on the Inbox tab, which takes the Search column away, and a thread on no task, a Manager's, has no task's inbox to be read from in its place; the place's next search replaces them, and nothing lists them while it asks nothing.
  useEffect(() => () => search.leave(), [search]);

  const searching = useSyncExternalStore(search.subscribe, search.searching);

  return { asks, searching };
}
