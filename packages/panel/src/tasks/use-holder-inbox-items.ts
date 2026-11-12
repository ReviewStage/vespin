import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { InboxReads } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { AppInboxItems, AppInboxTaskHolding } from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { inboxItemsQuery, inboxItemsRetryMutation } from "../live-reads.js";

/**
 * use-holder-inbox-items.ts -- every task's inbox items for the window's Inbox, its search, and a person's page, drawn from the account's feed of every item the host holds for the session.
 *
 * The window's Inbox lists the items of every task holding one, settled as
 * well as waiting, and main's read of the account carries only what waits,
 * in brief. So every task is drawn from the account's feed of whole items
 * (`inboxItemsQuery`), which stands for every task whole: one it holds
 * nothing of holds nothing now. The task whose item is chosen is followed
 * by its own control besides (`use-task-inbox.ts`), which reads its settled
 * items past the feed's bound and is drawn in this one's place.
 */

/** One task holding inbox items as the Inbox follows it: by its id, and when main says the latest of its items, settled ones included, changed. */
export interface InboxHolding {
  readonly id: string;
  readonly updatedAt: number;
}

/** What the window's Inbox lists from. */
export interface HolderInboxItems {
  /** Each task's items as last pushed, the window's own answers laid over them, by id; a task not yet pushed is absent. */
  readonly items: InboxReads;
  /** Whether a task handed here could not be read, so the list offers to try again. */
  readonly failed: boolean;
  /** Whether a task handed here has not been pushed as main says it now stands, and was not refused: its items are on their way. */
  readonly pending: boolean;
  /** The tasks pushed as main says they now stand, or pushed and handed here no more, which stand for them whole, so an item they do not hold is not theirs. */
  readonly current: ReadonlySet<string>;
  /** The tasks current only because the account's feed holds nothing of them, whose own read may still hold an item a link names. */
  readonly feedHoldsNothing: ReadonlySet<string>;
  readonly onRetry: () => void;
}

/** No task at all, for a surface that follows nothing until it is asked. */
export const NO_HOLDINGS: readonly InboxHolding[] = [];

/** Each task main lists as holding items, as a holding to follow. */
export function taskHoldings(holdings: readonly AppInboxTaskHolding[]): readonly InboxHolding[] {
  return holdings.map(({ taskId, updatedAt }) => ({ id: taskId, updatedAt }));
}

/** When the latest of the items changed; nothing for none. */
function newest(items: readonly InboxItem[]): number {
  return items.reduce((latest, item) => Math.max(latest, item.updatedAt), Number.NEGATIVE_INFINITY);
}

/** No task held, as the feed stands before it first answers. */
const NOTHING_HELD: InboxReads = new Map();

/** The tasks the feed holds, by id; none until it first answers. */
type Fed = AppInboxItems[typeof INBOX_SCOPE_KIND.PLAN] | undefined;

/**
 * The tasks as the account's feed stands: each it holds with its items, and
 * each handed here that it holds nothing of with none, since the feed
 * stands for every task whole; nothing until it first answers.
 */
function feedStanding(fed: Fed, holdings: readonly InboxHolding[]): InboxReads {
  if (fed === undefined) return NOTHING_HELD;
  const standing = new Map(Object.entries(fed));

  for (const holding of holdings) {
    if (!standing.has(holding.id)) standing.set(holding.id, []);
  }

  return standing;
}

/**
 * The tasks pushed as main says they now stand, or pushed and handed here
 * no more. Note that a task main says changed later than its push is not
 * current yet, because its push may land a moment after main's own word of
 * the change.
 */
function currentOf(
  pushed: InboxReads,
  holdings: readonly InboxHolding[],
  /** The account's feed: a task it holds nothing of is current. */
  fed: Fed,
): ReadonlySet<string> {
  // Note that the holdings are found by id rather than searched for each task, as a long Inbox follows hundreds of them.
  const byId = new Map<string, InboxHolding>();

  for (const holding of holdings) {
    if (!byId.has(holding.id)) byId.set(holding.id, holding);
  }

  return new Set(
    [...pushed].flatMap(([id, held]) => {
      const holding = byId.get(id);
      const absentFromFeed = fed !== undefined && !Object.hasOwn(fed, id);

      return holding === undefined || absentFromFeed || newest(held) >= holding.updatedAt
        ? [id]
        : [];
    }),
  );
}

export function useHolderInboxItems(holdings: readonly InboxHolding[]): HolderInboxItems {
  const feed = useQuery(inboxItemsQuery());
  const { mutate: retry } = useMutation(inboxItemsRetryMutation());
  const onRetry = useCallback(() => retry(), [retry]);
  const fed = feed.data?.[INBOX_SCOPE_KIND.PLAN];

  // Note that a task the feed holds nothing of is current with none, since the feed stands for every task whole.
  const read = useMemo(() => {
    const items = feedStanding(fed, holdings);

    return {
      items,
      current: currentOf(items, holdings, fed),
      feedHoldsNothing: new Set(
        fed === undefined
          ? []
          : holdings.flatMap((each) => (Object.hasOwn(fed, each.id) ? [] : [each.id])),
      ),
    };
  }, [fed, holdings]);

  const failed = holdings.length > 0 && feed.isError;

  return {
    ...read,
    failed,
    pending: !failed && holdings.some((holding) => !read.current.has(holding.id)),
    onRetry,
  };
}
