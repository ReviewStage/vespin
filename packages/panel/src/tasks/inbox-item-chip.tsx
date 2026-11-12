import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { type InboxListed, NEEDS_YOU, taskHolder } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { AppInboxItems, AppInboxSlice, AppInboxWaitingItem } from "@repo/host/app-state";
import { HoverCard, HoverCardHead, HoverCardNote, Time, useMinute } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { inboxItemsQuery } from "../live-reads.js";
import { appStateQuery, selectInbox, selectTasks } from "../use-app-state.js";
import { InboxItemCard, inboxItemGlyph } from "./inbox-item-parts.js";
import { useMentionedPlace } from "./mentioned-place.js";

/**
 * inbox-item-chip.tsx -- a chip of an Inbox item: what it asks as its glyph and its Inbox row's own card, whatever the item's standing.
 *
 * A link to an item names the task that holds it and the item, or, as an
 * older link does, the agent that posted it, or the item alone. Main's
 * document holds only what waits, in brief, so the item is drawn from the
 * account's feed of every item (`live-reads.ts`), which the host holds for
 * the session, as the Inbox draws it: the glyph its row's second line leads
 * with for what it asks (`inboxLineGlyph`), never its agent's tile, which
 * would draw it as a chip of the agent, and the card its row hangs
 * (`InboxItemCard`), waiting or answered. Until the feed is read, where it
 * holds nothing of the item, as of one settled past its bound, or where the
 * window does not hold its task, the chip draws the thread's glyph, and the
 * card main's brief makes of an item still waiting, else its own card.
 */

/** Where a link to an item says it stands: under a task, under the agent that posted it, or nowhere, by its id alone. */
type InboxItemPlace =
  | { readonly planId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string }
  | { readonly itemId: string };

/** The task main's brief says holds an item still waiting, by the item's id; none for one settled or unknown. */
function waitingTaskOf(inbox: AppInboxSlice | undefined, itemId: string): string | undefined {
  return inbox?.waiting.find((task) => task.items.some((each) => each.id === itemId))?.taskId;
}

/** An item the feed holds, and the plan it holds it under. */
interface FedItem {
  readonly item: InboxItem;
  readonly planId: string;
}

/** The item a link names as the feed holds it, and the plan the feed holds it under; none where the feed holds no such item. Note that a link under its agent, or by the item alone, leaves the plan to be found among every plan's. */
function fedItemOf(fed: AppInboxItems | undefined, place: InboxItemPlace): FedItem | undefined {
  if (fed === undefined) return undefined;
  const plans = fed[INBOX_SCOPE_KIND.PLAN];

  const named = (item: InboxItem) =>
    item.id === place.itemId && (!("agentId" in place) || item.agentId === place.agentId);

  if ("planId" in place) {
    const item = plans[place.planId]?.find(named);

    return item === undefined ? undefined : { item, planId: place.planId };
  }

  for (const [planId, items] of Object.entries(plans)) {
    const item = items.find(named);

    if (item !== undefined) return { item, planId };
  }

  return undefined;
}

/**
 * The item a link names as the Inbox lists it, its task named as its
 * group's header is; none until the feed is read, where it holds no such
 * item, or where the window does not hold its task. Note that a link under
 * its agent, or by the item's id alone, leaves its task to be found: by the
 * plan the feed holds the item under, else by main's brief while it waits.
 */
function useLinkedItem(place: InboxItemPlace): InboxListed | undefined {
  const planId = "planId" in place ? place.planId : undefined;
  const namedAgent = "agentId" in place ? place.agentId : undefined;
  const { itemId } = place;
  const fed = useQuery(inboxItemsQuery()).data;
  const tasks = useQuery({ ...appStateQuery, select: selectTasks }).data;
  const inbox = useQuery({ ...appStateQuery, select: selectInbox }).data;

  const found = useMemo(() => {
    if (planId !== undefined) return fedItemOf(fed, { planId, itemId });

    return fedItemOf(fed, namedAgent === undefined ? { itemId } : { agentId: namedAgent, itemId });
  }, [fed, planId, namedAgent, itemId]);

  const item = found?.item;
  const taskId = planId ?? found?.planId ?? waitingTaskOf(inbox, itemId);

  return useMemo(() => {
    if (item === undefined || taskId === undefined) return undefined;
    const task = tasks?.tasks.find((each) => each.id === taskId);

    return task === undefined ? undefined : { holder: taskHolder(task), item };
  }, [item, taskId, tasks]);
}

/** The brief main holds of an item that waits on the reader, by its id; none for one settled or unknown. */
function useWaitingBrief(itemId: string): AppInboxWaitingItem | undefined {
  const inbox = useQuery({ ...appStateQuery, select: selectInbox }).data;

  return (inbox?.waiting ?? []).flatMap((task) => task.items).find((each) => each.id === itemId);
}

/** An item's card from main's brief alone, wearing no glyph, as its read card wears none: its question, that it needs the reader, since main's brief lists only what waits on them, as its read card says, and when it was asked. */
function WaitingItemCard({
  item,
  now,
}: {
  item: AppInboxWaitingItem;
  now: number;
}): React.JSX.Element {
  return (
    <HoverCard data-inbox-item-card="">
      <HoverCardHead
        name={item.title}
        corner={<Time at={item.postedAt} now={now} hint={false} />}
      />
      <HoverCardNote>{NEEDS_YOU.LABEL}</HoverCardNote>
    </HoverCard>
  );
}

/** An item's title as its Inbox row names it, waiting or settled; main's brief's while its inbox is read; none where neither holds the item. */
export function useInboxItemTitle(place: InboxItemPlace): string | undefined {
  const listed = useLinkedItem(place);
  const waiting = useWaitingBrief(place.itemId);

  return listed?.item.title ?? waiting?.title;
}

/**
 * An item's glyph on its chip: what it asks, as its row's second line leads
 * with it (`inboxLineGlyph`), so the chip reads as a thread rather than as
 * the agent that posted it, whose tile its card still wears; the thread's
 * glyph where it asks nothing, and until the item is read.
 */
export function InboxItemChipGlyph({ place }: { place: InboxItemPlace }): ReactNode {
  const listed = useLinkedItem(place);

  return listed === undefined ? <GLYPH.THREAD /> : inboxItemGlyph(listed.item);
}

/** An item's card on its chip: the card its Inbox row hangs, whether it waits or not; while its inbox is read, or where that failed, the brief card of an item still waiting; else `fallback`. */
export function InboxItemChipCard({
  place,
  fallback,
}: {
  place: InboxItemPlace;
  fallback: ReactNode;
}): ReactNode {
  const listed = useLinkedItem(place);
  const { models, me } = useMentionedPlace();
  const now = useMinute();
  const waiting = useWaitingBrief(place.itemId);

  if (listed === undefined) {
    return waiting === undefined ? fallback : <WaitingItemCard item={waiting} now={now} />;
  }

  return <InboxItemCard listed={listed} now={now} models={models} readerId={me} />;
}
