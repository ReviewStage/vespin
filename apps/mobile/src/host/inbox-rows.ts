/**
 * inbox-rows.ts -- the Inbox as the host's document names it: each item waiting on the developer as a row of the list screen, in the shape the placeholder rows have.
 *
 * The host's read of the account names the tasks holding items and each
 * item waiting (`inbox.waiting`), and the account's feed holds each task's
 * items whole, from which a row's summary is the first line of its latest
 * message. The rows stand in the placeholder collection's shape, so the
 * list and detail screens draw them as they draw the stand-in rows, and
 * the Inbox with nothing waiting lists nothing.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { memoizedSelect } from "@repo/host/app-state-reads";
import {
  INBOX_PLACEHOLDER,
  type PlaceholderCollection,
  type PlaceholderItem,
} from "../placeholders.js";

/** What a row says under its title where its thread holds no words yet. */
const ROW_WORDS = {
  ASKING: "An agent is waiting on your answer.",
  NOTICE: "An agent posted a notice.",
} as const;

/** The symbol a row stands behind: a question for an ask, the tray for a notice. */
const ROW_SYMBOL = {
  ASKING: "questionmark.circle",
  NOTICE: "tray",
} as const satisfies Record<string, PlaceholderItem["symbol"]>;

/** The Inbox with nothing waiting: the placeholder's frame and no rows. */
export const EMPTY_INBOX: PlaceholderCollection = { ...INBOX_PLACEHOLDER, items: [] };

/** The first line of a thread's latest message, or none where the thread holds no words. */
function latestWords(item: InboxItem | undefined): string | undefined {
  const text = item?.thread?.at(-1)?.text ?? "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
}

/** The Inbox's rows from the document: every item waiting, in the order the host lists them. */
function inboxRows(
  inbox: AppStateSnapshot["inbox"],
  feed: AppStateSnapshot[typeof LIVE_READ.INBOX_ITEMS],
): PlaceholderCollection {
  const items = inbox.waiting.flatMap(({ taskId, items }) =>
    items.map((waiting): PlaceholderItem => {
      const held = feed.rows?.[INBOX_SCOPE_KIND.PLAN][taskId]?.find(({ id }) => id === waiting.id);
      // Note that an item from a service before `asking` was said counts as asking, as the host counts it.
      const asking = waiting.asking !== false;
      return {
        id: waiting.id,
        title: waiting.title,
        summary: latestWords(held) ?? (asking ? ROW_WORDS.ASKING : ROW_WORDS.NOTICE),
        symbol: asking ? ROW_SYMBOL.ASKING : ROW_SYMBOL.NOTICE,
      };
    }),
  );
  return items.length === 0 ? EMPTY_INBOX : { ...INBOX_PLACEHOLDER, items };
}

/** The Inbox's rows as a `select` for `useQuery({ ...appStateQuery, select })`, made anew only as the inbox or the feed moves. */
export const selectInboxCollection = memoizedSelect(
  (state: AppStateSnapshot) => [state.inbox, state[LIVE_READ.INBOX_ITEMS]],
  inboxRows,
);
