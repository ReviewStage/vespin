import { inboxReadRows } from "@repo/features/inbox-digest";
import {
  anyToMarkRead,
  EVERYONES,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxAnyHolder,
  type InboxGroup,
  type InboxListed,
  type InboxRun,
  inboxAtNow,
  inboxCounts,
  inboxGroups,
  inboxItemAtNow,
  inboxRunOf,
  inboxSearchWordsOf,
  listedItems,
  taskGroups,
} from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { searchTokens } from "@repo/features/search-tokens";
import type { TaskSummary } from "@repo/features/task-wire";
import type { AppInboxTaskHolding } from "@repo/host/app-state";
import { inboxHoldingsWithOlder } from "@repo/host/app-state-reads";
import { useMinute } from "@repo/ui";
import { afterPaint } from "@repo/ui/after-paint";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInboxViewChoices } from "../desktop/folded-groups.js";
import { useInboxView } from "../inbox-route.js";
import { inboxOlderQuery } from "../live-reads.js";
import { useAutomationsDoor, useInboxDoor } from "../places/routed-doors.js";
import {
  type TaskListRows,
  useNamedTask,
  useTaskListCollections,
  useTaskListRow,
  useTaskListRows,
} from "../task-list-collections.js";
import { AUTOMATIONS_PAGE } from "./automations-place.js";
import { useInboxResolver } from "./inbox-close.js";
import { wholeInboxItems } from "./inbox-whole-items.js";
import { useAgents, useTaskAgents } from "./use-agents.js";
import { useHeldInboxList } from "./use-held-inbox-list.js";
import { taskHoldings, useHolderInboxItems } from "./use-holder-inbox-items.js";
import { useInboxOlderPages } from "./use-inbox-older-pages.js";
import { useInboxReadMarks } from "./use-inbox-read-marks.js";
import { useInboxWaitingTasks, useListedInbox } from "./use-inbox-slices.js";
import { useHeldTaskInbox, useInboxDraftsLetGo } from "./use-task-inbox.js";
import { useTasklessInboxGroups } from "./use-taskless-inbox-groups.js";
import type { InboxChoice, TasksControl } from "./use-tasks-tab.js";

/**
 * use-inbox-listing.ts -- the window's Inbox read once: every item of every
 * task of the listed workspace that holds one, as its list lists them under
 * the view the developer chose, and the item chosen, read live through its
 * task's own read.
 *
 * The window's Inbox page reads it for its list and the item beside it
 * (`desktop-inbox.tsx`).
 *
 * Its search, the words typed in the list's head, is held here too, the item
 * the pane shows keeping its place among the steps, as it does under any
 * scope (`inboxList`); the field hands it on a render behind its own words
 * (`inbox-list.tsx`'s `ListSearch`), so a key lands in the field before the
 * list is ranked again for it.
 *
 * The chosen item's task's own read is held here without its cards'
 * drafts, which the pane that draws the box reads (`useInboxCardDrafts`),
 * so a word typed there draws nothing here; only where each draft stands
 * is read here, to let go of those the read no longer holds. What is read
 * across the whole feed, its groups, counts, and list, is read again only
 * as what it is read from moves.
 *
 * A row's press, and K and J, choose an item for the Inbox at once, drawn
 * in the frame the press lands in by the Inbox alone, and hand the choice
 * to the window once that frame has painted (`useChoiceFirst`), so the
 * sidebar, the side panel, and the window's history, which follow the
 * window's choice, draw it a frame later rather than holding up the thread.
 *
 * A thread on no task is listed under the agent that posted it
 * (`use-taskless-inbox-groups.ts`), and choosing it opens it beside the
 * list as a task's does, read from the account's feed, which alone holds
 * it, and answered on it, its agent standing in its task's place.
 *
 * Narrowed to a task, it lists and counts every item of that task alone
 * (`taskGroups`), open and settled, addressed to anyone, as the task's own
 * Inbox tab once listed them in one run, whatever view the Inbox keeps,
 * which it leaves as it stands (`TASK_LISTS`).
 */

/** No run folded. */
const NO_RUNS: readonly InboxRun[] = [];

/** No agent's items, as the taskless groups lay the older ones beside the feed's themselves (`use-taskless-inbox-groups.ts`). */
const NO_AGENTS: Readonly<Record<string, readonly InboxItem[]>> = {};

/** No task kept beside the Inbox, which only the phone's kept rows name. */
const NO_TASKS: readonly TaskSummary[] = [];

/** What an Inbox narrowed to a task lists: every item the task holds, open or settled, whoever it is addressed to, in one run. */
const TASK_LISTS = {
  show: INBOX_SHOW.ALL,
  whose: EVERYONES,
  pinnedFirst: false,
  folded: NO_RUNS,
} as const;

/**
 * The tasks the list holds items of, in main's order: each holding one that
 * the listed workspace's list given holds, so one not yet read, or another
 * workspace's, is listed nowhere. Note that a task's status never leaves
 * it out: a task done or canceled is listed, its items with it.
 */
function listedHoldings(
  holdings: readonly AppInboxTaskHolding[],
  listed: Pick<TaskListRows, "task">,
): readonly AppInboxTaskHolding[] {
  return holdings.filter((holding) => listed.task(holding.taskId) !== undefined);
}

/** The choice that opens a listed item: by its task, and its agent, which its link names. */
export function choiceOf({ holder, item }: InboxListed): InboxChoice {
  return { taskId: holder.task.id, itemAgentId: item.agentId, itemId: item.id };
}

/**
 * The choice that opens any listed item: one on a task by its task, and one
 * on no task by its id alone, opened, as a link to it stands it
 * (`inbox-route.ts`'s `choiceAt`), so the address names it the same way.
 */
export function anyChoiceOf(listed: InboxListed<InboxAnyHolder>): InboxChoice {
  const held = onTask(listed);

  return held === undefined ? { itemId: listed.item.id, opened: true } : choiceOf(held);
}

/** A listed item as held by a task, or none where an agent on no task holds it. */
export function onTask(listed: InboxListed<InboxAnyHolder>): InboxListed | undefined {
  const { holder, item } = listed;

  return "task" in holder ? { holder, item } : undefined;
}

/** A choice on its way to the window, and the window's choice it was made over. */
interface ChoiceOnItsWay {
  readonly choice: InboxChoice;
  readonly over: InboxChoice | undefined;
}

/** Whether the window's choice stands where a choice on its way found it, or on one this Inbox handed on since. */
function unmoved(
  way: ChoiceOnItsWay,
  now: InboxChoice | undefined,
  handed: WeakSet<InboxChoice>,
): boolean {
  return now === way.over || (now !== undefined && handed.has(now));
}

type UseChoiceFirstResult = {
  readonly chosen: InboxChoice | undefined;
  readonly settling: boolean;
  readonly choose: (chosen: InboxChoice) => void;
  readonly clear: () => void;
};

/**
 * The item the Inbox shows, as the reader chose it: a choice made here is
 * drawn at once, and handed to the window (`onChoose`) once the frame that
 * draws it has painted, in the order they were made, so every choice is a
 * step of the window's history as it was. Until the window holds it, the
 * newest choice made here stands for the window's (`chosen`), and
 * `settling` says so. Note that a choice the window made meanwhile, a
 * link's or Back's, stands over one still on its way, which is then
 * dropped rather than handed on, and that `clear`, the Inbox's own way to
 * choose nothing, drops every choice on its way before it clears the
 * window's.
 */
function useChoiceFirst(
  chosen: InboxChoice | undefined,
  onChoose: (chosen: InboxChoice) => void,
  onClear: () => void,
): UseChoiceFirstResult {
  const [held, setHeld] = useState<readonly ChoiceOnItsWay[]>([]);
  const latest = useRef({ chosen, onChoose, onClear });
  latest.current = { chosen, onChoose, onClear };
  // The choices on their way, so one dropped by a clear is never handed on.
  const waiting = useRef(new Set<ChoiceOnItsWay>());
  // The choices handed to the window, so one handed on while another waits is known as this Inbox's own.
  const handed = useRef(new WeakSet<InboxChoice>());

  const choose = useCallback((choice: InboxChoice) => {
    const way: ChoiceOnItsWay = { choice, over: latest.current.chosen };
    waiting.current.add(way);
    setHeld((was) => [...was, way]);
    afterPaint(() => {
      if (!waiting.current.delete(way)) return;

      if (unmoved(way, latest.current.chosen, handed.current)) {
        handed.current.add(choice);
        latest.current.onChoose(choice);
      }

      setHeld((was) => was.filter((each) => each !== way));
    });
  }, []);

  const clear = useCallback(() => {
    waiting.current.clear();
    setHeld([]);
    latest.current.onClear();
  }, []);

  const newest = held.at(-1);
  const stands = newest !== undefined && unmoved(newest, chosen, handed.current);

  return { chosen: stands ? newest.choice : chosen, settling: stands, choose, clear };
}

/**
 * Opens the run a newly chosen item stands folded in, as a link, a
 * notification, or a search opens it, since a row's press and K and J reach
 * no item of a folded run. Note that an item is handled once while it stays
 * chosen, as it is found, so the reader folding the chosen item's run
 * afterwards keeps it folded.
 */
function useFoldOpensOnChoice(
  standing: readonly InboxGroup<InboxAnyHolder>[],
  chosenId: string | undefined,
  folded: ReadonlySet<InboxRun> | undefined,
  onFold: (run: InboxRun, folded: boolean) => void,
): void {
  const handled = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Note that letting the choice go forgets it, so the same item chosen again by a link opens its run again.
    if (chosenId === undefined) {
      handled.current = undefined;

      return;
    }

    if (chosenId === handled.current) return;

    const group = standing.find(({ items }) => items.some((item) => item.id === chosenId));
    const item = group?.items.find((each) => each.id === chosenId);

    if (group === undefined || item === undefined) return;

    handled.current = chosenId;
    const run = inboxRunOf({ holder: group.holder, item });

    if (folded?.has(run) === true) onFold(run, false);
  }, [standing, chosenId, folded, onFold]);
}

/**
 * The window's Inbox as it is read and listed, narrowed to `narrowedTask`
 * where one is given, and its chosen item; see the module's head, its list
 * held still while it is shown (`use-held-inbox-list.ts`).
 */
export function useInboxListing(tasks: TasksControl, narrowedTask?: string) {
  const view = tasks.inboxView;
  const inbox = useInboxView(tasks);
  const { choose: onChoose } = useInboxDoor(tasks);
  const choices = useInboxViewChoices();
  const { open: onOpenAutomations } = useAutomationsDoor(tasks);

  // Note that the Inbox reads the automations whenever it stands, because an agent's card names the automation that started it.
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );

  const { inboxTasks } = useListedInbox(tasks);
  // The tasks the list holds, read by id, so only a move of a task holding an item lists them again.
  const listedTasks = useTaskListRows();
  const inboxWaiting = useInboxWaitingTasks();

  const holdings = useMemo(
    () => listedHoldings(inboxTasks, listedTasks),
    [inboxTasks, listedTasks],
  );

  const read = useHolderInboxItems(useMemo(() => taskHoldings(holdings), [holdings]));
  // Note that a task the feed holds nothing of is read for the list, but its own read may still hold an item a link names.
  const settlesTask = (id: string) => read.current.has(id) && !read.feedHoldsNothing.has(id);
  const { onClear } = view;

  // Note that the item chosen here is drawn before the window holds it (`useChoiceFirst`).
  const {
    chosen: asked,
    settling,
    choose: chooseFirst,
    clear,
  } = useChoiceFirst(inbox.chosen, onChoose, onClear);

  const chosenTask = useNamedTask(
    asked !== undefined && "taskId" in asked ? asked.taskId : undefined,
    tasks.typedNames,
  );

  const taskId = chosenTask?.id;

  // Note that All alone lists the account's older items, read a page at a time past the feed as its end comes into view, and never counts them (`use-inbox-older-pages.ts`).
  const listsOlder = narrowedTask === undefined && choices.show === INBOX_SHOW.ALL;
  const olderPages = useInboxOlderPages(tasks.me, listsOlder && inbox.open && tasks.shown);
  const { data: olderHeld } = useQuery(inboxOlderQuery());
  const older = listsOlder ? olderHeld : undefined;

  const {
    groups: taskless,
    listed: tasklessListed,
    listedWhole: tasklessListedWhole,
    ...tasklessFeed
  } = useTasklessInboxGroups(tasks.workspace?.id, tasks.agentsCarried, tasks.agents.models, older);

  // The agent on no task holding the item asked for, whose threads the feed alone holds.
  const askedItemId = asked?.itemId;

  const askedAgent = useMemo(
    () =>
      taskId !== undefined || askedItemId === undefined
        ? undefined
        : taskless.find(({ items }) => items.some((item) => item.id === askedItemId))?.holder.agent,
    [taskless, taskId, askedItemId],
  );

  // Note that the Inbox draws the chosen task's agents where it reads them, so their rows are read here.
  const agents = useTaskAgents(
    useAgents({
      taskId,
      repository: chosenTask?.repository ?? null,
      agentsFollowed: tasks.agentsCarried,
      list: { failed: tasks.listFailed, onRetry: tasks.onRetryList },
      // The Inbox draws no agent's composer, so nothing here opens Settings.
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onStarted: () => undefined,
      me: tasks.me,
    }).control,
  );

  const liveScope = { taskId };

  const live = useHeldTaskInbox({
    ...liveScope,
    agentId: askedAgent?.id,
    shown: tasks.shown,
    onScreen: taskId !== undefined && tasks.inboxShown === taskId,
    waiting: inboxWaiting.some((each) => each.taskId === taskId),
    readerId: tasks.me,
    agents,
  });

  // Note that the drafts the read no longer holds are let go here, where the read stands, rather than in the pane, which goes with its item.
  useInboxDraftsLetGo(live, liveScope);
  // Note that the models come from the open task's agents where this task's have not read them, so an agent is named alike in both.
  // An agent on no task stands as its own task's agents would, as its page draws it (`desktop-agent-page.tsx`), so its thread names it.
  const models = agents.models ?? tasks.agents.models;
  const askedAgentId = askedAgent?.id;

  // Note that the agent is read by its id alone, so a step of any other agent's turn draws the listing nothing.
  const askedRow = useTaskListRow(useTaskListCollections().agents, askedAgentId);
  const ownAgent = tasks.agentsCarried ? askedRow : undefined;

  const named = useMemo(() => {
    if (ownAgent === undefined) return { ...agents, models };
    const archived = ownAgent.archivedAt !== undefined;

    return {
      ...agents,
      models,
      agents: archived ? [] : [ownAgent],
      archived: archived ? [ownAgent] : [],
      agentIds: [ownAgent.id],
      heldIds: [ownAgent.id],
    };
  }, [agents, models, ownAgent]);

  // The chosen task's own held read stands in for the list's once it answered, so an answer shows
  // at once, and only while it holds, since one that failed stops hearing what changed.
  const liveBoard = live.board;

  const liveItems = useMemo(
    (): readonly InboxItem[] => [...liveBoard.open, ...liveBoard.settled],
    [liveBoard],
  );

  const holdsLive = live.read && !live.failed;
  const liveId = holdsLive ? taskId : undefined;
  const readItems = read.items;

  const held = useMemo(
    () => (liveId === undefined ? readItems : new Map(readItems).set(liveId, liveItems)),
    [readItems, liveId, liveItems],
  );

  // Note that every read here draws the window's own marks, answers, and messages already, as the host draws them into each (`@repo/host`'s `inbox-collections.ts`).
  // Note that only the tasks holding items are read, each by its id with its name as it is being typed, which is all the grouping looks up, so a task that holds none moving, as each turn of its agents does, groups nothing again.
  const holderRows = useTaskListRows(tasks.typedNames);

  const everyItem: readonly InboxGroup<InboxAnyHolder>[] = useMemo(() => {
    const holders = holdings.flatMap(({ taskId }) => {
      const task = holderRows.task(taskId);

      return task === undefined ? [] : [task];
    });

    return [...inboxGroups(inboxReadRows(held), { tasks: holdings, listed: holders }), ...taskless];
  }, [held, holdings, holderRows, taskless]);

  // Note that the older items are laid beside the reads the rows are made from, an item a read holds its own alone, so every count above stands on the feed's alone.
  const withOlder = useMemo(
    () =>
      older === undefined
        ? undefined
        : inboxHoldingsWithOlder(
            { read: held, tasks: holdings, agents: NO_AGENTS, keptHolders: NO_TASKS },
            older,
          ),
    [held, holdings, older],
  );

  const everyListed: readonly InboxGroup<InboxAnyHolder>[] = useMemo(() => {
    if (withOlder === undefined) return everyItem;

    const holders = withOlder.tasks.flatMap(({ taskId }) => {
      const task = holderRows.task(taskId);

      return task === undefined ? [] : [task];
    });

    return [
      ...inboxGroups(inboxReadRows(withOlder.read), { tasks: withOlder.tasks, listed: holders }),
      ...tasklessListed,
    ];
  }, [withOlder, everyItem, holderRows, tasklessListed]);

  // Note that the list draws rows, and the pane and the search read each item whole, found by its id in the reads the rows are made from.
  const whole = useMemo(
    () => wholeInboxItems(withOlder?.read ?? held, tasklessListedWhole),
    [withOlder, held, tasklessListedWhole],
  );

  // Note that a reminder is weighed on the window's clock, since no read of the service's may read one, so an item comes back within the minute its reminder comes due.
  const now = useMinute();

  const standing = useMemo(
    () =>
      inboxAtNow(narrowedTask === undefined ? everyItem : taskGroups(everyItem, narrowedTask), now),
    [everyItem, narrowedTask, now],
  );

  // What the list lists: what stands, and under All the older items beside it, which nothing counts.
  const listedStanding = useMemo(
    () => (everyListed === everyItem ? standing : inboxAtNow(everyListed, now)),
    [everyListed, everyItem, standing, now],
  );

  // Note that every item marked read is pushed with each followed inbox, its marker among its rows, so nothing is read again.
  const marks = useInboxReadMarks({ workspaceId: tasks.workspace?.id, readerId: tasks.me });
  // The list's search, which narrows what it lists, never what it counts.
  const [query, setQuery] = useState("");
  const tokens = useMemo(() => searchTokens(query), [query]);

  const search = useMemo(
    () => ({ tokens, wordsOf: inboxSearchWordsOf((itemId) => whole.get(itemId)) }),
    [tokens, whole],
  );

  const me = tasks.me;
  // Note that a task's items are listed whole, under no view (`TASK_LISTS`).
  const { show, whose, pinnedFirst, folded } = narrowedTask === undefined ? choices : TASK_LISTS;
  const foldedRuns = useMemo(() => new Set(folded), [folded]);
  const counts = useMemo(() => inboxCounts(standing, me, whose), [standing, me, whose]);
  // Note that Mark all as read stands while a notice waits on the reader, read or not, since it acknowledges each (`settledOnRead`).
  const markable = useMemo(() => anyToMarkRead(standing, me, now), [standing, me, now]);

  const filter = useMemo(
    () => ({ show, whose, search, readerId: me, pinnedFirst, folded: foldedRuns }),
    [show, whose, search, me, pinnedFirst, foldedRuns],
  );

  useFoldOpensOnChoice(
    listedStanding,
    asked?.itemId,
    pinnedFirst ? foldedRuns : undefined,
    choices.onFold,
  );

  // The rows hold what the filter lists and the chosen row they drew, while the steps keep the item the pane shows in its place,
  // both held still while the page stands: every row while the pointer is over the list, and the chosen row while it stays chosen.
  const { list, steps, onPointing } = useHeldInboxList(
    listedStanding,
    filter,
    asked?.itemId,
    inbox.open && tasks.shown,
  );

  const listedRows = useMemo(() => listedItems(list), [list]);

  const askedListed = useMemo(
    () => listedItems(steps).find(({ item }) => item.id === askedItemId),
    [steps, askedItemId],
  );

  // Note that a thread on no task stands beside the list as a task's does.
  const chosen = askedListed;
  const chosenWhole = chosen === undefined ? undefined : whole.get(chosen.item.id);

  // Note that the pane draws the whole item as the list stood its row at the minute (`inboxAtNow`), a reminder come due let go.
  const chosenItem = useMemo(
    () => (chosenWhole === undefined ? undefined : inboxItemAtNow(chosenWhole, now)),
    [chosenWhole, now],
  );

  // Note that a scope leaving out every item listed is said apart from an Inbox holding none.
  const searched = tokens.length > 0 ? query : undefined;

  const filteredOut =
    searched === undefined &&
    listedRows.length === 0 &&
    (show !== INBOX_SHOW.ALL || whose.kind !== INBOX_WHOSE.EVERYONE) &&
    listedStanding.some(({ items }) => items.length > 0);

  // Note that a chosen item whose task is listed but not read yet keeps its place, because
  // it may be listed once the read lands; one whose task left the list, deleted elsewhere, gives way.
  // A task whose agents' read answered none holds no Inbox to read; one whose agents are not
  // read yet may still hold the item, until its Inbox's own read answers.
  const holderEmpty = agents.heldIds?.length === 0;
  const agentsUnread = agents.heldIds === undefined;

  // Note that a plan's items read before main's latest word of it may lack the item asked for, so only a current read settles it.
  const chosenWaits =
    taskId !== undefined &&
    !settlesTask(taskId) &&
    !live.read &&
    (holdings.some((holding) => holding.taskId === taskId) || agentsUnread);

  // Note that the holdings are filtered against the task list, so until it is read they hold nothing and prove nothing.
  const listUnread = !tasks.listRead && !tasks.listFailed;
  // Note that the account's feed is waited on though no task holds an item, since it may hold threads on no task, while an account is signed in to read it.
  const feedUnread = tasks.signedIn && tasklessFeed.pending;

  const reading =
    listUnread || feedUnread || holdings.some((holding) => !read.items.has(holding.taskId));

  // An item asked for by a link or a notification that no read holds once every read has landed is
  // not there for the reader, whether it was deleted or is of a task they cannot read, and its pane
  // says so rather than standing empty.
  // Note that only the asked task's own reads are waited on, since another's that failed says nothing of this item.
  const holderRead = taskId === undefined || settlesTask(taskId) || live.read || holderEmpty;

  // Note that a thread on no task is held by the feed alone, so it is waited on until the feed and its agent are read.
  const missing =
    asked?.opened === true &&
    chosen === undefined &&
    !chosenWaits &&
    holderRead &&
    !listUnread &&
    !(taskId === undefined && tasklessFeed.pending);

  // An item opened whose holder's own read failed says so, with a way to read it again, rather than waiting on it for good,
  // since nothing reads a failed holder again by itself.
  const chosenFailed = asked?.opened === true && chosen === undefined && !missing && live.failed;
  const { onRetry: retryLive } = live;
  const { onRetryList: retryAgents } = agents;

  const onRetryChosen = useCallback(() => {
    retryLive();
    retryAgents();
  }, [retryLive, retryAgents]);

  const choose = useCallback(
    (listed: InboxListed<InboxAnyHolder>) => chooseFirst(anyChoiceOf(listed)),
    [chooseFirst],
  );

  const resolveItems = useInboxResolver();
  // Note that a task list that failed leaves the Inbox holding nothing to read, which would otherwise say it was empty, and so does a feed refused where no task holds an item.
  const failed = read.failed || tasks.listFailed || tasklessFeed.failed;

  const onRetry = () => {
    read.onRetry();

    if (tasks.listFailed) tasks.onRetryList();
  };

  return {
    view,
    choices,
    openAutomation,
    read,
    asked,
    settling,
    chosenTask,
    taskId,
    agents,
    live,
    liveScope,
    named,
    marks,
    standing,
    listedStanding,
    markable,
    counts,
    list,
    listedRows,
    olderPages: listsOlder ? olderPages : undefined,
    steps,
    onPointing,
    chosen,
    chosenItem,
    filteredOut,
    search: { query, onQuery: setQuery },
    searched,
    missing,
    chosenFailed,
    onRetryChosen,
    reading,
    failed,
    choose,
    clear,
    resolveItems,
    onRetry,
  };
}
