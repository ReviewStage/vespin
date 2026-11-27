/**
 * inbox-groups.tsx -- the holders of the Inbox's items in one workspace, as the app's screens group them: the host's document's feed and what it says holds items, over the task list's collections; and the one read of what asks for the reader's attention that every screen shares.
 *
 * The feed and the tasks holding items are the document's
 * (`@repo/host/app-state-reads`' `selectInboxHoldings`), and the tasks
 * themselves the task list's collections', each read by its id
 * (`useTaskListRowsOf`), so the grouping reads no list of the document's
 * own, and none of the account's other tasks. A thread on no task, a
 * Manager's, is grouped under the agent that posted it, read from the
 * list's agents by its id the same way, as the panel's Inbox lists it.
 *
 * Where the account's database keeps the Inbox's items (`InboxHoldings`'
 * `stored`), as a signed-in phone's does, the document holds none of them:
 * they are read through a live query over the pool's kept collection, as
 * far as the screen's reach reads (`@repo/host/inbox-rows`), and grouped as
 * the document's would be. A fixture run's, whose items the document holds,
 * reads them there as before.
 *
 * What Open, Questions, and Reminders can list (`INBOX_ATTENTION`) is read
 * and grouped once for the whole app, under `InboxAttentionProvider`, and
 * held in a store beside React, so the Inbox, its badge, the widget,
 * Spotlight, and every count of what waits read that one read, each only
 * the slice it draws (`useHeldValue`), and draw again only as that slice
 * moves. A read of another reach, every item or one agent's, is the
 * screen's own.
 */

import {
  holderWorkspaceId,
  type InboxAnyHolder,
  type InboxGroup,
  type InboxWaiting,
  inboxNextReminderDue,
  inboxRowGroups,
  inboxWaitingIn,
  inboxWaitingKept,
  NO_INBOX_WAITING,
} from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { inboxGroupsIn, selectInboxHoldings, selectInboxReader } from "@repo/host/app-state-reads";
import { INBOX_ATTENTION, type InboxReach, inboxHoldingsOfRows } from "@repo/host/inbox-rows";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections, useTaskListRowsOf } from "../host/host-provider.js";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";
import { useInboxRows } from "./inbox-rows.js";
import { useSendsDrawn } from "./use-thread-answer.js";

/** No holder grouped: what a read before the document lands answers. */
const NO_GROUPS: readonly InboxGroup<InboxAnyHolder, InboxItem>[] = [];

/** No task holds items: what a read before the document lands names. */
const NO_HOLDERS: readonly string[] = [];

/** The holders the Inbox's items stand under, and whether they were read: the document landed and, where the phone keeps the items on disk, the query of them answered. */
interface InboxGroupsRead {
  readonly groups: readonly InboxGroup<InboxAnyHolder, InboxItem>[];
  readonly read: boolean;
}

/** None grouped, and none read yet. */
const NOT_READ: InboxGroupsRead = { groups: NO_GROUPS, read: false };

/**
 * The holders of the Inbox's items in the workspace `workspaceId` names, as
 * the list model groups them (`inboxGroupsIn`), as far as `reach` reads
 * where they are kept on disk; every workspace's where none is named; none,
 * and nothing read, where `reach` is none. Grouped again only as the feed,
 * what holds items, or a task holding items moves.
 */
function useGroupsOf(
  workspaceId: string | undefined,
  reach: InboxReach | undefined,
): InboxGroupsRead {
  const { data: told } = useQuery({ ...appStateQuery, select: selectInboxHoldings });
  const rows = useInboxRows(told?.stored === true ? reach : undefined);

  const holdings = useMemo(() => {
    if (reach === undefined || told?.stored !== true) return reach === undefined ? undefined : told;

    return rows === undefined ? undefined : inboxHoldingsOfRows(rows, told);
  }, [reach, told, rows]);

  const { tasks, agents } = useTaskListCollections();

  const holders = useMemo(
    () => holdings?.tasks.map(({ taskId }) => taskId) ?? NO_HOLDERS,
    [holdings],
  );

  const agentHolders = useMemo(
    () => (holdings === undefined ? NO_HOLDERS : Object.keys(holdings.agents)),
    [holdings],
  );

  // Note that only the tasks holding items are read, which is all the grouping looks up, so a task that holds none moving, as a working agent's turn moves its task, groups nothing again.
  const listed = useTaskListRowsOf(tasks, holders);
  const listedAgents = useTaskListRowsOf(agents, agentHolders);
  const read = holdings !== undefined;

  // Note that the launch notes when a screen first grouped the Inbox, so `app:ready` says how much of its wait came after.
  useEffect(() => {
    if (read) noteLaunchPhase(LAUNCH_PHASE.INBOX);
  }, [read]);

  return useMemo(
    () =>
      holdings === undefined
        ? NOT_READ
        : { groups: inboxGroupsIn(holdings, listed, workspaceId, listedAgents), read: true },
    [holdings, listed, workspaceId, listedAgents],
  );
}

/** What the app's one read of the Inbox's attention holds: every workspace's holders, what waits on the reader in each, and each workspace's share of the holders, made as first asked. */
interface AttentionHeld {
  readonly all: InboxGroupsRead;
  readonly waiting: ReadonlyMap<string | undefined, InboxWaiting>;
  readonly inWorkspace: Map<string, InboxGroupsRead>;
}

/** Nothing read yet. */
const ATTENTION_UNREAD: AttentionHeld = {
  all: NOT_READ,
  waiting: new Map(),
  inWorkspace: new Map(),
};

/** The store a screen reads where no provider stands, as a screen drawn outside the app's root never is: never read. */
const UNSHARED = heldValue(ATTENTION_UNREAD);

/** The app's one read of what asks for the reader's attention, as `InboxAttentionProvider` holds it. */
const InboxAttention = createContext(UNSHARED);

/**
 * `held`'s holders in the workspace `workspaceId` names, every workspace's
 * where none is named: the same object for as long as `held` stands, so a
 * screen reading it draws again only as the read moves.
 */
function inWorkspaceOf(held: AttentionHeld, workspaceId: string | undefined): InboxGroupsRead {
  if (workspaceId === undefined) return held.all;
  const kept = held.inWorkspace.get(workspaceId);

  if (kept !== undefined) return kept;

  const groups = held.all.groups.filter((group) => holderWorkspaceId(group.holder) === workspaceId);

  const read = { groups, read: held.all.read };
  // Note that a workspace's share is made once, the first time a screen asks, and held beside the read it was made from.
  held.inWorkspace.set(workspaceId, read);

  return read;
}

/**
 * Reads what Open, Questions, and Reminders can list once, for every
 * screen under it, and holds it in a store each reads its own slice of.
 * Note that the store is the context's value, which never changes, so a
 * new read draws again only the screens whose slice moved; and that what
 * waits in a workspace is held as it stood where it did not move
 * (`inboxWaitingKept`), so a write that moves no count draws no count again.
 */
export function InboxAttentionProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState(() => heldValue(ATTENTION_UNREAD));
  const all = useGroupsOf(undefined, INBOX_ATTENTION);
  // Note that what waits is counted over the reader's sends standing too, so a reply out takes its thread off the counts at once, as the Inbox's own rows draw it.
  const drawn = useSendsDrawn(all.groups);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  // Note that the counts are made again as the soonest reminder comes due, since an item it put away comes back with no write to say so.
  const [dueTurns, dueCame] = useReducer((turns: number) => turns + 1, 0);
  // The moment the counts standing were made at, which the next reminder is looked for after, so one that comes due between the count and the timer is never passed over.
  const countedAt = useRef(0);

  // Note that the store moves before the frame paints, so no screen draws a frame of the read before.
  useLayoutEffect(() => {
    countedAt.current = Date.now();
    const counted = inboxWaitingIn(inboxRowGroups(drawn), readerId, countedAt.current);

    store.set({
      all,
      waiting: inboxWaitingKept(store.read().waiting, counted),
      inWorkspace: new Map(),
    });
  }, [store, all, drawn, readerId, dueTurns]);

  useEffect(() => {
    const due = inboxNextReminderDue(inboxRowGroups(drawn), countedAt.current);

    if (due === undefined) return;
    // Note that a reminder already due by now counts again at once.
    const timer = setTimeout(dueCame, Math.max(0, due - Date.now()));

    return () => clearTimeout(timer);
  }, [drawn, dueTurns]);

  return <InboxAttention.Provider value={store}>{children}</InboxAttention.Provider>;
}

/**
 * Every holder of Inbox items in the workspace `workspaceId` names, its
 * items open and settled alike, as the list model groups them
 * (`inboxGroupsIn`), as far as `reach` reads where they are kept on disk,
 * what Open, Questions, and Reminders can list unless it says otherwise;
 * every workspace's where none is named, and none before the document lands
 * or the kept items are read. Each group holds its whole items, which a
 * screen reads as the list's rows (`inboxRowGroups`) once it has drawn the
 * reader's sends on them (`useSendsDrawn`).
 */
export function useInboxGroupsIn(
  workspaceId: string | undefined,
  reach: InboxReach = INBOX_ATTENTION,
): readonly InboxGroup<InboxAnyHolder, InboxItem>[] {
  return useInboxGroupsRead(workspaceId, reach).groups;
}

/**
 * The same holders (`useInboxGroupsIn`), with whether they were read, so a
 * screen tells none read yet from none held, as a thread opened by its id
 * must before it says the thread is missing. What asks for attention is the
 * app's one read (`InboxAttentionProvider`); any other reach the screen's own.
 */
export function useInboxGroupsRead(
  workspaceId: string | undefined,
  reach: InboxReach = INBOX_ATTENTION,
): InboxGroupsRead {
  const store = useContext(InboxAttention);
  const shared = reach === INBOX_ATTENTION && store !== UNSHARED;
  const own = useGroupsOf(workspaceId, shared ? undefined : reach);

  const held = useHeldValue(store, (attention) =>
    shared ? inWorkspaceOf(attention, workspaceId) : undefined,
  );

  return held ?? own;
}

/** How many of the reader's threads wait on them in the workspace `workspaceId` names, every workspace's where none is named, read from the app's one read, drawn again only as those counts move. */
export function useInboxWaiting(workspaceId: string | undefined): InboxWaiting {
  return useHeldValue(
    useContext(InboxAttention),
    (attention) => attention.waiting.get(workspaceId) ?? NO_INBOX_WAITING,
  );
}

/** The same holders (`useInboxGroupsIn`) as the list reads them, each item as its row (`inboxRowGroups`), for a screen that draws no send of the reader's on them. */
export function useInboxRowGroupsIn(
  workspaceId: string | undefined,
  reach: InboxReach = INBOX_ATTENTION,
): readonly InboxGroup<InboxAnyHolder>[] {
  const groups = useInboxGroupsIn(workspaceId, reach);

  return useMemo(() => inboxRowGroups(groups), [groups]);
}
