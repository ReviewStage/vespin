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
 * the document's would be, each as its row, its digest taken as its follow
 * wrote it. A fixture run's, whose items the document holds, reads them
 * there whole and as their rows (`inboxRowGroups`).
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
  inboxRowGroups,
  inboxWaitingAt,
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
  useState,
} from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections, useTaskListRowsOf } from "../host/host-provider.js";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";
import { useInboxRows } from "./inbox-rows.js";
import { useSendsDrawnOnRows } from "./use-thread-answer.js";

/** No holder grouped: what a read before the document lands answers. */
const NO_GROUPS: readonly InboxGroup<InboxAnyHolder>[] = [];

/** No holder grouped whole: what a read before the document lands answers, and what a phone whose items are kept on disk answers. */
const NO_WHOLE_GROUPS: readonly InboxGroup<InboxAnyHolder, InboxItem>[] = [];

/** No task holds items: what a read before the document lands names. */
const NO_HOLDERS: readonly string[] = [];

/** The holders the Inbox's items stand under, each item as its row, and whether they were read: the document landed and, where the phone keeps the items on disk, the query of them answered. */
interface InboxGroupsRead {
  readonly groups: readonly InboxGroup<InboxAnyHolder>[];
  readonly read: boolean;
}

/** None grouped, and none read yet. */
const NOT_READ: InboxGroupsRead = { groups: NO_GROUPS, read: false };

/** The tasks and agents `holdings` names as holding items, each read by its id from the task list's collections, as the grouping looks them up. */
function useHoldersListed(
  holdings:
    | { readonly tasks: readonly { readonly taskId: string }[]; readonly agents: object }
    | undefined,
) {
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
  return {
    listed: useTaskListRowsOf(tasks, holders),
    listedAgents: useTaskListRowsOf(agents, agentHolders),
  };
}

/**
 * The holders of the Inbox's items in the workspace `workspaceId` names, as
 * the list model groups them (`inboxGroupsIn`), each item as its row, as far
 * as `reach` reads where they are kept on disk; every workspace's where none
 * is named; none, and nothing read, where `reach` is none. Grouped again only
 * as the feed, what holds items, or a task holding items moves.
 */
function useGroupsOf(
  workspaceId: string | undefined,
  reach: InboxReach | undefined,
): InboxGroupsRead {
  const { data: told } = useQuery({ ...appStateQuery, select: selectInboxHoldings });
  const stored = told?.stored === true;
  const rows = useInboxRows(stored ? reach : undefined);

  // Note that a kept phone's items are its rows, and a fixture run's the document's whole, each grouped the same way.
  const kept = useMemo(
    () =>
      reach === undefined || told?.stored !== true || rows === undefined
        ? undefined
        : inboxHoldingsOfRows(rows, told),
    [reach, told, rows],
  );

  const whole = reach === undefined || stored ? undefined : told;
  const { listed, listedAgents } = useHoldersListed(kept ?? whole);
  const read = kept !== undefined || whole !== undefined;

  // Note that the launch notes when a screen first grouped the Inbox, so `app:ready` says how much of its wait came after.
  useEffect(() => {
    if (read) noteLaunchPhase(LAUNCH_PHASE.INBOX);
  }, [read]);

  return useMemo(() => {
    if (kept !== undefined)
      return { groups: inboxGroupsIn(kept, listed, workspaceId, listedAgents), read: true };

    if (whole === undefined) return NOT_READ;

    return {
      groups: inboxRowGroups(inboxGroupsIn(whole, listed, workspaceId, listedAgents)),
      read: true,
    };
  }, [kept, whole, listed, workspaceId, listedAgents]);
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
  const drawn = useSendsDrawnOnRows(all.groups);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  // Note that the counts are made again as the soonest reminder comes due, since an item it put away comes back with no write to say so.
  const [dueTurns, dueCame] = useReducer((turns: number) => turns + 1, 0);

  // Note that the store moves before the frame paints, so no screen draws a frame of the read before; and that the next count is set from the same moment this one was made at (`inboxWaitingAt`).
  useLayoutEffect(() => {
    const { waiting, nextReminderDue } = inboxWaitingAt(drawn, readerId, Date.now());

    store.set({
      all,
      waiting: inboxWaitingKept(store.read().waiting, waiting),
      inWorkspace: new Map(),
    });

    if (nextReminderDue === undefined) return;
    // Note that a reminder already due by now counts again at once.
    const timer = setTimeout(dueCame, Math.max(0, nextReminderDue - Date.now()));

    return () => clearTimeout(timer);
  }, [store, all, drawn, readerId, dueTurns]);

  return <InboxAttention.Provider value={store}>{children}</InboxAttention.Provider>;
}

/**
 * Every holder of Inbox items in the workspace `workspaceId` names, its
 * items open and settled alike, as the list model groups them
 * (`inboxGroupsIn`), as far as `reach` reads where they are kept on disk,
 * what Open, Questions, and Reminders can list unless it says otherwise;
 * every workspace's where none is named, and none before the document lands
 * or the kept items are read. Each group holds its items as the list reads
 * them, as their rows, which a screen draws the reader's sends on
 * (`useSendsDrawnOnRows`).
 */
export function useInboxGroupsIn(
  workspaceId: string | undefined,
  reach: InboxReach = INBOX_ATTENTION,
): readonly InboxGroup<InboxAnyHolder>[] {
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

/**
 * The same holders (`useInboxGroupsIn`) with their whole items, threads
 * and all, where the document holds them, as a fixture run's does; none
 * where the phone keeps them on disk, whose threads are read from their
 * messages as one opens (`useThreadMessages`).
 */
export function useInboxWholeGroupsIn(
  workspaceId: string | undefined,
): readonly InboxGroup<InboxAnyHolder, InboxItem>[] {
  const { data: told } = useQuery({ ...appStateQuery, select: selectInboxHoldings });
  const holdings = told?.stored === true ? undefined : told;
  const { listed, listedAgents } = useHoldersListed(holdings);

  return useMemo(
    () =>
      holdings === undefined
        ? NO_WHOLE_GROUPS
        : inboxGroupsIn(holdings, listed, workspaceId, listedAgents),
    [holdings, listed, workspaceId, listedAgents],
  );
}
