/**
 * inbox-rows.ts -- the Inbox as the host's document names it, in the collection the list, the detail, and the tab's badge draw.
 *
 * The rows themselves are the host's reading of the document
 * (`@repo/host/app-state-reads`' `inboxRowsOf`); this stands them in the
 * placeholder collection's frame, so the screens draw them as they draw the
 * stand-in rows, and the Inbox with nothing waiting lists nothing.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { inboxRowsOf, memoizedSelect } from "@repo/host/app-state-reads";
import { INBOX_PLACEHOLDER, type PlaceholderCollection } from "../placeholders.js";

/** The Inbox with nothing waiting: the placeholder's frame and no rows. */
export const EMPTY_INBOX: PlaceholderCollection = { ...INBOX_PLACEHOLDER, items: [] };

function inboxCollection(
  inbox: AppStateSnapshot["inbox"],
  feed: AppStateSnapshot[typeof LIVE_READ.INBOX_ITEMS],
): PlaceholderCollection {
  const items = inboxRowsOf(inbox, feed);
  return items.length === 0 ? EMPTY_INBOX : { ...INBOX_PLACEHOLDER, items };
}

/** The Inbox's rows as a `select` for `useQuery({ ...appStateQuery, select })`, made anew only as the inbox or the feed moves. */
export const selectInboxCollection = memoizedSelect(
  (state: AppStateSnapshot) => [state.inbox, state[LIVE_READ.INBOX_ITEMS]],
  inboxCollection,
);
